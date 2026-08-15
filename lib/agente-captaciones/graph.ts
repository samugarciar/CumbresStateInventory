// Grafo LangGraph del agente de captaciones.
//
// AGNÓSTICO A LA FUENTE: recibe un ListingCrudo (venga de Mercado Libre, de
// Facebook, de un portal o pegado a mano) y lo lleva de anuncio crudo a
// prospecto calificado con mensaje redactado, listo para que un humano apruebe
// el contacto.
//
//   normalizar → calificar ─┬─ descartar ──────────────► persistir_descartado → END
//                           └─ calificado/revisar ─► deduplicar ─┬─ duplicado ─► END
//                                                                └─ nuevo ─► redactar → persistir → END
//
// El ENVÍO nunca ocurre aquí: el grafo deja el prospecto en estado
// 'por_aprobar'. Un humano aprueba y envía (human-in-the-loop).

import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { SystemMessage, HumanMessage, type BaseMessage, type AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MODELO_CALIFICAR, MODELO_REDACTAR, BASE_TRATAMIENTO, UMBRAL_DUENO_DIRECTO } from './config';
import { PROMPT_CALIFICAR, cargarPromptRedaccion, fichaInmueble, bloqueIdentidad } from './prompt';
import type { Calificacion, ListingCrudo, SalidaCaptacion, UsoRegistrado } from './tipos';

// OJO: los structured outputs estrictos de OpenAI exigen que TODAS las
// propiedades figuren en `required` — un campo "opcional" se modela como
// nullable, NO con .optional() (con .optional() OpenAI responde 400). Misma
// lección ya aprendida en lib/agente-comercial/graph.ts.
const EsquemaCalificacion = z.object({
  es_dueno_directo: z.boolean(),
  probabilidad_dueno_directo: z.number(),
  tipo_inmueble: z.enum(['casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro']).nullable(),
  tipo_transaccion: z.enum(['venta', 'arriendo']).nullable(),
  en_zona_objetivo: z.boolean(),
  score: z.number(),
  decision: z.enum(['calificado', 'revisar', 'descartar']),
  motivos: z.string(),
});

const TIPOS_INMUEBLE = ['casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro'];

// La BD tiene CHECK en tipo_inmueble/tipo_transaccion: cualquier valor fuera de
// la lista rompería el insert, así que se normaliza antes de persistir.
function tipoInmuebleValido(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase().trim();
  if (TIPOS_INMUEBLE.includes(t)) return t;
  if (t.startsWith('apart') || t === 'apto') return 'apartamento';
  if (t.startsWith('cas')) return 'casa';
  return 'otro';
}

function tipoTransaccionValido(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase().trim();
  if (t === 'venta' || t === 'sell' || t === 'sale') return 'venta';
  if (t === 'arriendo' || t === 'rent' || t === 'alquiler') return 'arriendo';
  return null;
}

function usoDeMensaje(modelo: string, mensaje: BaseMessage | undefined): UsoRegistrado | null {
  const um = (mensaje as AIMessage | undefined)?.usage_metadata;
  if (!um) return null;
  const cache = um.input_token_details?.cache_read ?? 0;
  return {
    modelo,
    entrada: Math.max(0, (um.input_tokens ?? 0) - cache),
    salida: um.output_tokens ?? 0,
    cache,
  };
}

function elegirCanal(l: ListingCrudo): string {
  if (l.contacto_telefono) return 'whatsapp';
  if (l.contacto_perfil) return 'messenger';
  return 'revisar_manual';
}

const EstadoCaptacion = Annotation.Root({
  listing: Annotation<ListingCrudo>({ reducer: (_a, b) => b }),
  calificacion: Annotation<Calificacion | null>({ reducer: (_a, b) => b, default: () => null }),
  canal: Annotation<string>({ reducer: (_a, b) => b, default: () => 'revisar_manual' }),
  duplicadoDe: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  /** El propietario pidió no ser contactado (Habeas Data). */
  optOut: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  mensaje: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  prospectoId: Annotation<string | null>({ reducer: (_a, b) => b, default: () => null }),
  resultado: Annotation<SalidaCaptacion['resultado'] | null>({ reducer: (_a, b) => b, default: () => null }),
  uso: Annotation<UsoRegistrado[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

type Estado = typeof EstadoCaptacion.State;

export async function correrCaptacion(params: {
  supabase: SupabaseClient; // cliente admin (service role)
  inmobiliariaId: string;
  listing: ListingCrudo;
}): Promise<SalidaCaptacion> {
  const { supabase, inmobiliariaId, listing } = params;

  const modeloCalificar = new ChatOpenAI({ model: MODELO_CALIFICAR, temperature: 0, maxRetries: 3 });
  const calificador = modeloCalificar.withStructuredOutput(EsquemaCalificacion, { includeRaw: true });
  const modeloRedactar = new ChatOpenAI({ model: MODELO_REDACTAR, temperature: 0.4, maxRetries: 3, maxTokens: 400 });

  // ---- nodos ----
  function normalizar(estado: Estado): Partial<Estado> {
    return { canal: elegirCanal(estado.listing) };
  }

  async function calificar(estado: Estado): Promise<Partial<Estado>> {
    const l = estado.listing;
    const ficha = [
      `Título: ${l.titulo}`,
      `Descripción: ${l.descripcion || '(sin descripción)'}`,
      `Ubicación: ${[l.barrio, l.ciudad, l.direccion].filter(Boolean).join(', ') || 'no especificada'}`,
      l.precio != null ? `Precio: ${l.precio}` : 'Precio: no publicado',
      l.area_m2 != null ? `Área: ${l.area_m2} m2` : null,
      l.habitaciones != null ? `Habitaciones: ${l.habitaciones}` : null,
      l.tipo_inmueble ? `Tipo declarado por la fuente: ${l.tipo_inmueble}` : null,
      l.tipo_transaccion ? `Operación declarada por la fuente: ${l.tipo_transaccion}` : null,
      l.contacto_nombre ? `Publica: ${l.contacto_nombre}` : null,
      l.fuente_marca_dueno_directo === true
        ? 'CLASIFICACIÓN DE LA PROPIA PLATAFORMA: este anuncio aparece bajo su filtro oficial de "dueño directo" (lo publicó el propietario, no una inmobiliaria).'
        : null,
      `Fuente: ${l.fuente}`,
    ]
      .filter(Boolean)
      .join('\n');

    const r = await calificador.invoke([
      new SystemMessage(PROMPT_CALIFICAR),
      new HumanMessage(`Anuncio a clasificar:\n${ficha}`),
    ]);
    const uso = usoDeMensaje(MODELO_CALIFICAR, r.raw);
    return { calificacion: r.parsed as Calificacion, uso: uso ? [uso] : [] };
  }

  async function deduplicar(estado: Estado): Promise<Partial<Estado>> {
    const l = estado.listing;
    // 1) mismo anuncio de la misma fuente
    if (l.fuente_id) {
      const { data } = await supabase
        .from('captacion_prospectos')
        .select('id, opt_out')
        .eq('inmobiliaria_id', inmobiliariaId)
        .eq('fuente', l.fuente)
        .eq('fuente_id', l.fuente_id)
        .maybeSingle();
      if (data?.id) return { duplicadoDe: data.id, optOut: Boolean(data.opt_out) };
    }
    // 2) mismo teléfono (el mismo dueño republicando en otra fuente). Es lo que
    // hace efectivo el opt-out: si pidió no ser contactado, no vuelve a entrar
    // aunque publique otro inmueble.
    if (l.contacto_telefono) {
      const { data } = await supabase
        .from('captacion_prospectos')
        .select('id, opt_out')
        .eq('inmobiliaria_id', inmobiliariaId)
        .eq('contacto_telefono', l.contacto_telefono)
        .maybeSingle();
      if (data?.id) return { duplicadoDe: data.id, optOut: Boolean(data.opt_out) };
    }
    return { duplicadoDe: null };
  }

  async function redactar(estado: Estado): Promise<Partial<Estado>> {
    const l = estado.listing;
    const c = estado.calificacion;
    const promptSistema = await cargarPromptRedaccion(inmobiliariaId);

    // Identidad REAL: sin esto el modelo inventa nombre de asesor y de
    // inmobiliaria, y le mandaríamos a un propietario un mensaje falso.
    const { data: inmo } = await supabase
      .from('inmobiliarias')
      .select('nombre')
      .eq('id', inmobiliariaId)
      .maybeSingle();
    const identidad = bloqueIdentidad({
      agencia: inmo?.nombre ?? 'la inmobiliaria',
      asesor: process.env.CAPTACIONES_ASESOR_NOMBRE ?? null,
    });

    const ficha = fichaInmueble({
      tipo_inmueble: c?.tipo_inmueble ?? l.tipo_inmueble,
      tipo_transaccion: c?.tipo_transaccion ?? l.tipo_transaccion,
      barrio: l.barrio,
      ciudad: l.ciudad,
      precio: l.precio,
      area_m2: l.area_m2,
      habitaciones: l.habitaciones,
      contacto_nombre: l.contacto_nombre,
      titulo: l.titulo,
    });
    const r = await modeloRedactar.invoke([
      new SystemMessage(`${promptSistema}\n\n${identidad}`),
      new HumanMessage(`Ficha del inmueble:\n${ficha}`),
    ]);
    const uso = usoDeMensaje(MODELO_REDACTAR, r);
    const texto = typeof r.content === 'string' ? r.content : '';
    return { mensaje: texto.trim(), uso: uso ? [uso] : [] };
  }

  async function persistir(estado: Estado): Promise<Partial<Estado>> {
    const l = estado.listing;
    const c = estado.calificacion;
    // Se descarta por criterio (zona/tipo) o por no alcanzar el umbral de
    // dueño directo. Igual se guarda la fila, para trazabilidad y para que el
    // dedup no lo vuelva a procesar.
    const noPasaUmbral = c?.decision !== 'descartar' && !pasaFiltroDueno(c);
    const descartado = c?.decision === 'descartar' || noPasaUmbral;
    const pct = c?.probabilidad_dueno_directo != null
      ? `${Math.round(c.probabilidad_dueno_directo * 100)}%`
      : 'sin dato';
    const motivoUmbral = `Probabilidad de dueño directo ${pct}, por debajo del mínimo de ${Math.round(UMBRAL_DUENO_DIRECTO * 100)}%. ${c?.motivos ?? ''}`.trim();

    const fila = {
      inmobiliaria_id: inmobiliariaId,
      fuente: l.fuente,
      fuente_id: l.fuente_id,
      url: l.url,
      titulo: l.titulo || null,
      descripcion: l.descripcion || null,
      tipo_inmueble: tipoInmuebleValido(c?.tipo_inmueble ?? l.tipo_inmueble),
      tipo_transaccion: tipoTransaccionValido(c?.tipo_transaccion ?? l.tipo_transaccion),
      ciudad: l.ciudad,
      barrio: l.barrio,
      precio: l.precio,
      area_m2: l.area_m2,
      habitaciones: l.habitaciones,
      banos: l.banos,
      es_dueno_directo: c?.es_dueno_directo ?? null,
      // Probabilidad (0-1) de que sea el dueño directo — 1 = seguro dueño,
      // 0 = seguro agencia. Distinto del score, que mide la calidad global.
      confianza_particular: c?.probabilidad_dueno_directo ?? null,
      score: c?.score ?? null,
      motivos: noPasaUmbral ? motivoUmbral : (c?.motivos ?? null),
      contacto_nombre: l.contacto_nombre,
      contacto_telefono: l.contacto_telefono,
      contacto_perfil: l.contacto_perfil,
      canal: descartado ? null : estado.canal,
      mensaje_borrador: descartado ? null : estado.mensaje || null,
      estado: descartado ? 'descartado' : 'por_aprobar',
      base_tratamiento: BASE_TRATAMIENTO,
      origen_dato: l.url,
    };

    const { data, error } = await supabase
      .from('captacion_prospectos')
      .insert(fila)
      .select('id')
      .single();

    if (error) {
      console.error('[Captaciones] No se pudo guardar el prospecto:', error.message);
      throw new Error(`No se pudo guardar el prospecto: ${error.message}`);
    }
    return { prospectoId: data.id, resultado: descartado ? 'descartado' : 'creado' };
  }

  function marcarDuplicado(): Partial<Estado> {
    return { resultado: 'duplicado' };
  }

  // ---- ruteo ----
  /**
   * Solo entran a la bandeja los anuncios con probabilidad suficiente de ser de
   * dueño directo.
   *
   * El filtro mira SOLO la probabilidad, no el booleano. Exigir además
   * `es_dueno_directo === true` metía una segunda compuerta que se contradecía
   * con la primera: un anuncio sin descripción queda en ~0.5 (incertidumbre
   * legítima) pero el modelo tendía a marcar el booleano en false, y así se
   * descartaba todo lo capturado desde una lista aunque superara el umbral.
   */
  function pasaFiltroDueno(c: Calificacion | null): boolean {
    if (!c) return false;
    const p = typeof c.probabilidad_dueno_directo === 'number' ? c.probabilidad_dueno_directo : 0;
    return p >= UMBRAL_DUENO_DIRECTO;
  }

  function trasCalificar(estado: Estado): 'descartar' | 'seguir' {
    if (estado.calificacion?.decision === 'descartar') return 'descartar';
    return pasaFiltroDueno(estado.calificacion) ? 'seguir' : 'descartar';
  }
  function trasDeduplicar(estado: Estado): 'duplicado' | 'nuevo' {
    return estado.duplicadoDe ? 'duplicado' : 'nuevo';
  }

  const grafo = new StateGraph(EstadoCaptacion)
    .addNode('normalizar', normalizar)
    .addNode('calificar', calificar)
    .addNode('deduplicar', deduplicar)
    .addNode('redactar', redactar)
    .addNode('persistir', persistir)
    .addNode('marcar_duplicado', marcarDuplicado)
    .addEdge(START, 'normalizar')
    .addEdge('normalizar', 'calificar')
    .addConditionalEdges('calificar', trasCalificar, {
      descartar: 'persistir', // se guarda con estado 'descartado' (trazabilidad)
      seguir: 'deduplicar',
    })
    .addConditionalEdges('deduplicar', trasDeduplicar, {
      duplicado: 'marcar_duplicado',
      nuevo: 'redactar',
    })
    .addEdge('redactar', 'persistir')
    .addEdge('persistir', END)
    .addEdge('marcar_duplicado', END)
    .compile();

  const final = await grafo.invoke({ listing });

  return {
    resultado: final.resultado ?? 'creado',
    prospecto_id: final.prospectoId,
    calificacion: final.calificacion,
    mensaje_borrador: final.mensaje || null,
    canal: final.canal,
    motivo:
      final.resultado === 'duplicado'
        ? final.optOut
          ? 'Este propietario pidió no ser contactado; no vuelve a la bandeja.'
          : `Ya existe el prospecto ${final.duplicadoDe}`
        : final.calificacion?.motivos ?? null,
    uso: final.uso,
  };
}
