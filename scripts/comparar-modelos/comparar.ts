// Repite turnos reales del agente comercial con otro modelo (o con un prompt
// editado) sin escribir en producción: las RPC que crean o cancelan citas y
// solicitudes, y el insert de tareas, devuelven un éxito simulado.
//
// Desde scripts/comparar-modelos/:
//   node --import ./registrar.mjs comparar.ts elegir 30 [desde] [hasta]   → casos.json
//   AGENTE_COMERCIAL_MODELO=gpt-6-luna AGENTE_COMERCIAL_RAZONAMIENTO=none \
//     node --import ./registrar.mjs comparar.ts correr <etiqueta>          → res-<etiqueta>.json
//   node lado.mjs <carpeta> <etiqueta>...      respuestas lado a lado con las reales
//   node puntaje.mjs <carpeta> <etiqueta>...   escalamientos, apto, horarios por código
// Opcional: PROMPT_ARCHIVO=<ruta> prueba un prompt editado sin tocar agentes_config.
//
// ⚠️ Con el modelo que está en producción NO se corre: comparte el límite de
// tokens por minuto con el bot y les causaría 429 a clientes reales. La
// referencia es la respuesta que el bot de verdad dio (casos.json).
//
// Los casos traen mensajes y teléfonos reales de clientes: se guardan FUERA
// del repo (SALIDA, por defecto el directorio temporal del sistema).
// entorno primero: carga .env.local antes de que costos.ts lea el modelo.
import { AQUI, INMO, supabase, supabaseSimulado, envolverConFecha } from './entorno';
import fs from 'node:fs';
import path from 'node:path';
import { HumanMessage } from '@langchain/core/messages';
import { construirHistorial, type MensajeGuardado } from '../../lib/agente-comercial/historial';
import { cargarPromptSistema, contextoVariable } from '../../lib/agente-comercial/prompt';
import { correrAgenteComercial, type HerramientaUsada } from '../../lib/agente-comercial/graph';
import { calcularCostoUSD, MODELO_PRINCIPAL, RAZONAMIENTO_PRINCIPAL } from '../../lib/agente-comercial/costos';

interface Caso {
  id: string;
  conversacion_id: string;
  telefono: string;
  cliente_nombre: string | null;
  fecha: string; // del mensaje del usuario
  mensaje: string;
  previos: MensajeGuardado[]; // del más nuevo al más viejo
  original: string;
  herramientas_original: string[];
}

interface MensajeAgente {
  id: string;
  conversacion_id: string;
  contenido: string | null;
  herramientas_usadas: { nombre: string }[] | null;
  created_at: string;
  wa_phone_number_id: string | null;
}

interface Resultado {
  id: string;
  segundos: number;
  costo?: number;
  uso?: unknown;
  output?: string; // borrador crudo (con [ESCALAR] si aplica)
  partes?: string[]; // lo que de verdad recibe el cliente, ya formateado
  etapa?: string;
  escalado?: boolean;
  herramientas?: string[];
  // Qué pidió y qué devolvió cada herramienta (recortado): para verificar
  // que la respuesta no inventa datos.
  detalle?: { nombre: string; entrada: unknown; salida: string }[];
  error?: string;
}

const modo = process.argv[2];

if (modo === 'elegir') {
  const n = Number(process.argv[3] ?? 30);
  // Por defecto, los dos últimos días: con casos viejos, las herramientas de
  // agenda consultan fechas que ya pasaron.
  const hasta = process.argv[5] ?? new Date().toISOString();
  const desde = process.argv[4] ?? new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from('agente_comercial_mensajes')
    .select('id,conversacion_id,contenido,herramientas_usadas,created_at,wa_phone_number_id')
    .eq('rol', 'agente')
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .order('created_at', { ascending: true })
    .limit(3000);
  if (error) throw error;
  const agentes = (data ?? []) as MensajeAgente[];
  const nombres = (a: MensajeAgente) => (a.herramientas_usadas ?? []).map((h) => h.nombre);
  const utiles = agentes.filter(
    (a) => a.contenido && !/asesor está atendiendo|problema técnico|Necesito confirmar unos datos/i.test(a.contenido)
  );

  // Estratos: agenda (lo más delicado), búsqueda, otras herramientas, sin
  // herramientas. Un caso por conversación, barajado determinista.
  type Estrato = 'agenda' | 'busqueda' | 'otras' | 'sin';
  const estratos: Record<Estrato, MensajeAgente[]> = { agenda: [], busqueda: [], otras: [], sin: [] };
  const vistas = new Set<string>();
  const barajados = utiles
    .map((a, i) => ({ a, k: (i * 2654435761) % 4294967296 }))
    .sort((x, y) => x.k - y.k)
    .map((x) => x.a);
  for (const a of barajados) {
    if (vistas.has(a.conversacion_id)) continue;
    const h = nombres(a);
    const e: Estrato = h.some((x) => /agendar_cita|verificar_horarios|solicitar_apertura|cancelar/.test(x))
      ? 'agenda'
      : h.some((x) => /buscar_inmueble/.test(x))
        ? 'busqueda'
        : h.length
          ? 'otras'
          : 'sin';
    estratos[e].push(a);
    vistas.add(a.conversacion_id);
  }
  const cupo: Record<Estrato, number> = {
    agenda: Math.round(n * 0.4),
    busqueda: Math.round(n * 0.3),
    otras: Math.round(n * 0.1),
    sin: 0,
  };
  cupo.sin = n - cupo.agenda - cupo.busqueda - cupo.otras;
  const elegidos = (Object.keys(cupo) as Estrato[]).flatMap((e) => estratos[e].slice(0, cupo[e]));

  const casos: Caso[] = [];
  for (const a of elegidos) {
    const { data: conv } = await supabase
      .from('agente_comercial_conversaciones')
      .select('telefono,cliente_nombre')
      .eq('id', a.conversacion_id)
      .single();
    const linea = a.wa_phone_number_id;
    const { data: antes } = await supabase
      .from('agente_comercial_mensajes')
      .select('rol,contenido,created_at')
      .eq('conversacion_id', a.conversacion_id)
      .or(linea ? `wa_phone_number_id.is.null,wa_phone_number_id.eq.${linea}` : 'wa_phone_number_id.is.null')
      .lt('created_at', a.created_at)
      .order('created_at', { ascending: false })
      .limit(16);
    const lista = (antes ?? []) as MensajeGuardado[];
    const nuevo = lista[0];
    if (!nuevo || nuevo.rol !== 'usuario') continue;
    casos.push({
      id: a.id,
      conversacion_id: a.conversacion_id,
      telefono: conv?.telefono ?? '',
      cliente_nombre: conv?.cliente_nombre ?? null,
      fecha: nuevo.created_at,
      mensaje: nuevo.contenido,
      previos: lista.slice(1, 16),
      original: a.contenido ?? '',
      herramientas_original: nombres(a),
    });
  }
  fs.writeFileSync(path.join(AQUI, 'casos.json'), JSON.stringify(casos, null, 2));
  const tamanos = Object.fromEntries(Object.entries(estratos).map(([k, v]) => [k, v.length]));
  console.log(`casos ${casos.length} en ${AQUI}`, tamanos);
} else if (modo === 'correr') {
  const etiqueta = process.argv[3];
  if (!etiqueta) throw new Error('Falta la etiqueta: comparar.ts correr <etiqueta>');

  const prompt = process.env.PROMPT_ARCHIVO
    ? fs.readFileSync(process.env.PROMPT_ARCHIVO, 'utf8')
    : await cargarPromptSistema(INMO);
  const casos: Caso[] = JSON.parse(fs.readFileSync(path.join(AQUI, 'casos.json'), 'utf8'));
  const salida: Resultado[] = [];
  const PARALELO = Number(process.env.PARALELO ?? 4);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < casos.length) {
      const c = casos[siguiente++];
      const historial = construirHistorial(c.previos, { max: 15 });
      historial.push(new HumanMessage(envolverConFecha(c.mensaje, new Date(c.fecha))));
      const t0 = Date.now();
      try {
        const r = await correrAgenteComercial({
          supabase: supabaseSimulado,
          inmobiliariaId: INMO,
          promptSistema: prompt + contextoVariable({ telefono: c.telefono, clienteNombre: c.cliente_nombre }),
          historial,
          telefono: c.telefono,
        });
        salida.push({
          id: c.id,
          segundos: (Date.now() - t0) / 1000,
          costo: r.uso.reduce((s, u) => s + calcularCostoUSD(u.modelo, u), 0),
          uso: r.uso,
          output: r.output,
          partes: Object.values(r.response ?? {}).filter((p): p is string => typeof p === 'string' && p.trim() !== ''),
          etapa: r.etapa,
          escalado: r.escalado,
          herramientas: r.herramientasUsadas.map((h: HerramientaUsada) => h.nombre),
          detalle: r.herramientasUsadas.map((h: HerramientaUsada) => ({
            nombre: h.nombre,
            entrada: h.entrada,
            salida: (typeof h.salida === 'string' ? h.salida : JSON.stringify(h.salida)).slice(0, 2500),
          })),
        });
        process.stdout.write('.');
      } catch (e) {
        salida.push({ id: c.id, error: String(e), segundos: (Date.now() - t0) / 1000 });
        process.stdout.write('x');
      }
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabajador));
  fs.writeFileSync(path.join(AQUI, `res-${etiqueta}.json`), JSON.stringify(salida, null, 2));
  const ok = salida.filter((s) => !s.error);
  const prom = (f: (s: Resultado) => number) => ok.reduce((a, s) => a + f(s), 0) / Math.max(1, ok.length);
  console.log(
    `\n${etiqueta} (${MODELO_PRINCIPAL}, razonamiento ${RAZONAMIENTO_PRINCIPAL}): ${ok.length}/${salida.length} ok, ` +
      `costo/turno ${prom((s) => s.costo ?? 0).toFixed(5)} USD, demora prom ${prom((s) => s.segundos).toFixed(1)} s, ` +
      `máx ${Math.max(0, ...ok.map((s) => s.segundos)).toFixed(1)} s`
  );
} else {
  console.log('uso: comparar.ts elegir <n> [desde] [hasta] | comparar.ts correr <etiqueta>');
}
