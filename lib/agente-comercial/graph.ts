// Grafo LangGraph del agente comercial de WhatsApp — reemplaza el nodo
// langchain de n8n (workflow 3bihDRvaLKEDcQdw): "GPT 4.1" + tools +
// "GPT 4o Verificador"/"Verificador de Respuesta". Dos nodos:
//   1) agente_principal: createReactAgent (mismo mecanismo ya probado en
//      app/api/inteligencia/route.ts) — el bucle ReAct con las tools de
//      ./tools.ts.
//   2) formateador: pese al nombre "Verificador" en n8n, este paso NO
//      valida/corrige errores de negocio — formatea el borrador para
//      WhatsApp (lo parte en 1-5 mensajes con un tono/estilo específico) y
//      clasifica la etapa de la conversación (CONTACTO INICIAL / CONSULTA /
//      BELLO / MEDELLIN / CITA AGENDADA) para que n8n mueva el lead de
//      etapa en Kommo. Confirmado leyendo el prompt y el código reales del
//      nodo "Verificador de Respuesta" + "Prepare Update Payload" en el
//      workflow en vivo (17/jul/2026) — no es una suposición.
//
// Protocolo de escalamiento: si el agente principal antepone literalmente
// "[ESCALAR]" a su respuesta, hay que (a) exponerlo intacto en `output` para
// que el nodo n8n "Escalar?" (startsWith '[ESCALAR]') y el correo de
// "Notificar Escalamiento" sigan funcionando sin cambios, apuntando solo a
// este endpoint en vez del nodo viejo, y (b) quitar el prefijo ANTES de
// pasar el texto al formateador — así nunca se filtra "[ESCALAR]" al
// cliente. Mismo orden que hace n8n hoy (nodo "Limpiar Tag Escalar").

import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { crearToolsAgenteComercial } from './tools';
import { MODELO_PRINCIPAL, MODELO_VERIFICADOR } from './costos';

// Cada iteración del agente son ~2 pasos del grafo interno (modelo + tool).
// Menos tools que el Asesor BI (35) — el comercial tiene 7 tools simples.
const LIMITE_RECURSION = 18;

const ETAPAS = ['CONTACTO INICIAL', 'CONSULTA', 'BELLO', 'MEDELLIN', 'CITA AGENDADA'] as const;
export type Etapa = (typeof ETAPAS)[number];

export interface UsoRegistrado {
  modelo: string;
  entrada: number;
  salida: number;
  cache: number;
}

export interface HerramientaUsada {
  nombre: string;
  entrada: unknown;
  salida: unknown;
}

export interface ResultadoAgenteComercial {
  output: string; // borrador del agente, SIEMPRE con el prefijo [ESCALAR] cuando escalado=true
  response: { part_1: string; part_2?: string; part_3?: string; part_4?: string; part_5?: string };
  etapa: Etapa;
  escalado: boolean;
  prioridad: 'urgente' | 'normal';
  leadCaliente: boolean; // quiso visitar y no había agenda que ofrecerle
  contexto: string; // resumen para el asesor (NUNCA se le manda al cliente)
  respuesta: string; // conveniencia: las partes unidas, para el log de mensajes y pruebas directas
  herramientasUsadas: HerramientaUsada[];
  uso: UsoRegistrado[];
}

// El escalamiento NO puede depender de que el modelo recuerde escribir
// "[ESCALAR]": si lo olvida, el asesor nunca se entera y el lead muere en
// silencio (visto en pruebas 10/ago). Estos disparadores se derivan de lo que
// las herramientas REALMENTE hicieron, así que son deterministas.
//
// Solo se auto-escala en puntos TERMINALES de la conversación (ya se capturó
// todo lo que el agente necesitaba). Importante: escalar mueve el lead a
// "Escalado a asesor", etapa que el filtro "Etapa permitida?" de n8n NO
// admite → el agente queda MUDO para ese cliente. Por eso NO se auto-escala
// al solo detectar `sin_disponibilidad`: ahí el agente todavía tiene que
// recibir el día/hora que prefiere el cliente.
function evaluarEscalamiento(bitacora: HerramientaUsada[]): {
  autoEscalar: boolean;
  prioridad: 'urgente' | 'normal';
} {
  const exito = (nombre: string) =>
    bitacora.some((h) => {
      if (h.nombre !== nombre) return false;
      const s = typeof h.salida === 'string' ? safeParse(h.salida) : h.salida;
      return !!(s && typeof s === 'object' && (s as { success?: boolean }).success === true);
    });

  // Se registró una solicitud de apertura → un asesor tiene que abrir ese
  // espacio cuanto antes. Es la señal de compra más fuerte que existe.
  const aperturaRegistrada = exito('solicitar_apertura_de_agenda');
  const citaAgendada = exito('agendar_cita');

  return {
    autoEscalar: aperturaRegistrada || citaAgendada,
    prioridad: aperturaRegistrada ? 'urgente' : 'normal',
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// "Lead caliente": el cliente pidió ver un inmueble y no teníamos ninguna
// franja que ofrecerle. Es la señal de compra más fuerte del negocio (86% del
// inventario no tiene agenda publicada, así que pasa seguido) y hoy se atendía
// sola: si el cliente no volvía a escribir, nadie se enteraba de que existió.
// Va aparte de `escalado` a propósito: se avisa al asesor SIN mover la etapa de
// Kommo, porque moverla dejaría al agente mudo justo cuando todavía tiene que
// recibir el día y la hora que prefiere el cliente.
function detectarLeadCaliente(bitacora: HerramientaUsada[]): boolean {
  const modos: string[] = [];
  for (const h of bitacora) {
    if (h.nombre !== 'verificar_horarios_disponibles') continue;
    const s = typeof h.salida === 'string' ? safeParse(h.salida) : h.salida;
    for (const f of Array.isArray(s) ? s : [s]) {
      if (f && typeof f === 'object') modos.push((f as { modo?: string }).modo ?? '');
    }
  }
  if (modos.length === 0) return false;
  // Si ALGUNA consulta encontró horarios, no es un lead sin agenda aunque otra
  // haya fallado. El agente suele reintentar con un texto más corto cuando el
  // primero no resuelve (ej. "Montiara 2026195" → sin_resultados, luego
  // "Montiara" → disponibilidad_unidad con 3 franjas reales): mirar solo si
  // hubo algún fallo disparaba la alerta de "quiere visitar y no hay agenda"
  // aunque el cliente ya tuviera horarios en pantalla.
  if (modos.some((m) => m === 'disponibilidad' || m === 'disponibilidad_unidad')) return false;
  return modos.some((m) => m === 'sin_disponibilidad' || m === 'sin_resultados');
}

// Resumen accionable para el correo del asesor. Se arma con los datos REALES
// que pasaron por las herramientas, no con lo que el modelo escribió — así el
// asesor ve exactamente qué inmueble pidió el cliente y con qué flexibilidad,
// y el mensaje al cliente queda limpio de notas internas.
function armarContexto(bitacora: HerramientaUsada[], telefono: string): string {
  const lineas: string[] = [`Teléfono del cliente: ${telefono}`];
  for (const h of bitacora) {
    const ent = h.entrada as Record<string, unknown> | null;
    if (!ent) continue;
    if (h.nombre === 'verificar_horarios_disponibles') {
      lineas.push(`Preguntó por: "${ent.texto}"${ent.tipo_transaccion ? ` (${ent.tipo_transaccion})` : ''}`);
    }
    if (h.nombre === 'solicitar_apertura_de_agenda') {
      lineas.push(
        `Quiere visitar "${ent.texto}" el ${ent.fecha} de ${ent.hora_inicio} a ${ent.hora_fin}` +
          `${ent.cliente_nombre ? ` · ${ent.cliente_nombre}` : ''}` +
          `${ent.notas ? `\nFlexibilidad: ${ent.notas}` : ''}`
      );
    }
    if (h.nombre === 'agendar_cita') {
      const sal = (typeof h.salida === 'string' ? safeParse(h.salida) : h.salida) as Record<string, unknown> | null;
      if (sal && sal.success === true) {
        lineas.push(
          `CITA AGENDADA: ${sal.inmueble}${sal.aptos_count ? ` (${sal.aptos_count} aptos, visita a la unidad)` : ''}\n` +
            `Fecha: ${sal.fecha} de ${String(sal.hora_inicio).substring(0, 5)} a ${String(sal.hora_fin).substring(0, 5)}\n` +
            `Cliente: ${ent.cliente_nombre} · ${ent.cliente_telefono}\n` +
            `Asesor: ${sal.asesor}`
        );
      }
    }
  }
  return lineas.join('\n');
}

// Datos de la cita recién agendada, para el correo de aviso y la tarea de
// confirmación. Devuelve null si en este turno no se agendó nada.
export function extraerCitaAgendada(bitacora: HerramientaUsada[]): {
  cita_id: string;
  inmueble: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  asesor: string | null;
  cliente_nombre: string;
  cliente_telefono: string;
} | null {
  for (const h of bitacora) {
    if (h.nombre !== 'agendar_cita') continue;
    const s = (typeof h.salida === 'string' ? safeParse(h.salida) : h.salida) as Record<string, unknown> | null;
    if (!s || s.success !== true || !s.cita_id) continue;
    const ent = (h.entrada ?? {}) as Record<string, unknown>;
    return {
      cita_id: String(s.cita_id),
      inmueble: String(s.inmueble ?? ''),
      fecha: String(s.fecha ?? ''),
      hora_inicio: String(s.hora_inicio ?? '').substring(0, 5),
      hora_fin: String(s.hora_fin ?? '').substring(0, 5),
      asesor: s.asesor ? String(s.asesor) : null,
      cliente_nombre: String(ent.cliente_nombre ?? ''),
      cliente_telefono: String(ent.cliente_telefono ?? ''),
    };
  }
  return null;
}

// Mismo esquema que "Structured Output Parser" en n8n (jsonSchemaExample).
// OJO: los "structured outputs" estrictos de OpenAI exigen que TODAS las
// propiedades figuren en `required` — un campo "opcional" se modela como
// nullable, no con .optional() (con .optional() OpenAI responde 400:
// "'required' is required... Missing 'part_2'"). Se normalizan a
// undefined al leer el resultado (ver nodoFormateador).
const EsquemaFormateo = z.object({
  response: z.object({
    part_1: z.string(),
    part_2: z.string().nullable(),
    part_3: z.string().nullable(),
    part_4: z.string().nullable(),
    part_5: z.string().nullable(),
  }),
  etapa: z.enum(ETAPAS),
});

// Prompt EXACTO del nodo "Verificador de Respuesta" en n8n (workflow
// 3bihDRvaLKEDcQdw, extraído en vivo 17/jul/2026) — no reescribir de memoria.
const PROMPT_FORMATEADOR = `# Formatea el texto de entrada de acuerdo a las instrucciones.

## Instrucciones
- Devuelve un mensaje de salida dividido en 1, 2, 3, 4 o 5 partes, dependiendo de la longitud del texto de entrada.
- El mensaje de salida debe sonar relajado y amigable.
- Elimina estos caractéres: "*", "¿", "¡", "#"
- **Remplaza los saltos de línea por "\\n-"**. Por ejemplo, si recibes un mensaje que es:
"- 10:00\\n- 11:00\\n- 12:00"
Rempázalo por: "- 10:00\\n- 11:00\\n- 12:00"
**IMPORTANTE: Es indispensable que utilices el término "\\n-" de forma textual, sin espacios en el medio.
- Utiliza signos de interrogación "?" **solo en el final de las frases que sean preguntas.**
- **No** es necesario que las 5 partes contengan un mensaje.
- Si el texto de entrada contiene una lista, déjala sola en una parte, remplazando los saltos de línea por "\\n-".
- **IMPORTANTE: No añadas ni elimines información esencial del texto de entrada. Respeta fielmente el contenido original. Solamente ajusta la forma para cumplir las instrucciones dadas.**
## **IMPORTANTE**
- **SIEMPRE debes completar al menos una parte con texto**.
- NUNCA incliquas en las preguntas y exclamaciones el primer signo de pregunta o exclamacion "¿","¡"

## Clasificación de Etapa (etapa)
Analiza el contexto de la conversación (mensaje del usuario, respuesta del asistente) y clasifica la etapa de la conversación actual en una de las siguientes opciones (exactamente):
- 'CONTACTO INICIAL': Si la conversación está empezando, saludos, primeros intercambios.
- 'CONSULTA': Si el cliente hace preguntas sobre catálogo, servicios o busca propiedades en zonas distintas (excepto Bello y Medellín).
- 'BELLO': Si el cliente muestra interés específico en alquilar o comprar propiedades en el municipio de Bello.
- 'MEDELLIN': Si el cliente muestra interés específico en alquilar o comprar propiedades en el municipio de Medellín.
- 'CITA AGENDADA': Si en esta conversación se confirma el agendamiento de una cita (se usó la herramienta de agendar o se confirmó fecha y hora).`;

function extraerTexto(contenido: unknown): string {
  if (typeof contenido === 'string') return contenido;
  if (Array.isArray(contenido)) {
    return contenido
      .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
      .map((b) => (b as { text?: string }).text ?? '')
      .join('');
  }
  return '';
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

const EstadoAgente = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (actual, nuevo) => actual.concat(nuevo),
    default: () => [],
  }),
  borrador: Annotation<string>({ reducer: (_a, b) => b, default: () => '' }),
  respuestaFormateada: Annotation<ResultadoAgenteComercial['response'] | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  etapa: Annotation<Etapa>({ reducer: (_a, b) => b, default: () => 'CONTACTO INICIAL' }),
  usoTokens: Annotation<UsoRegistrado[]>({
    reducer: (actual, nuevo) => actual.concat(nuevo),
    default: () => [],
  }),
});

type Estado = typeof EstadoAgente.State;

export async function correrAgenteComercial(params: {
  supabase: SupabaseClient;
  inmobiliariaId: string;
  promptSistema: string;
  historial: BaseMessage[]; // turnos previos + el mensaje nuevo del usuario al final (sin system)
  telefono: string;
}): Promise<ResultadoAgenteComercial> {
  const { supabase, inmobiliariaId, promptSistema, historial, telefono } = params;

  const bitacora: HerramientaUsada[] = [];
  const tools = crearToolsAgenteComercial(supabase, inmobiliariaId, bitacora);

  // El límite real de la cuenta es 30.000 tokens POR MINUTO en gpt-4.1 y cada
  // llamada gasta ~9.900 (el 87% es el prompt del sistema), así que un turno
  // con 2 herramientas consume el minuto entero por sí solo. Los 429 que ven
  // los clientes ("Rate limit reached... try again in 2.9s / 16.4s") son eso.
  // Con 6 reintentos y backoff exponencial se cubren esperas de ~30s, muy por
  // debajo del maxDuration de 300s del endpoint: la conversación tarda un poco
  // más pero el cliente recibe su respuesta en vez de un mensaje de disculpa.
  // Esto es una MITIGACIÓN, no la solución: el arreglo real es subir el tier
  // de la cuenta en OpenAI.
  const modeloPrincipal = new ChatOpenAI({ model: MODELO_PRINCIPAL, temperature: 0, maxRetries: 6 });
  const agentePrincipal = createReactAgent({
    llm: modeloPrincipal,
    tools,
    prompt: new SystemMessage(promptSistema),
  });

  const modeloFormateador = new ChatOpenAI({ model: MODELO_VERIFICADOR, temperature: 0, maxRetries: 3 });
  const formateadorConSchema = modeloFormateador.withStructuredOutput(EsquemaFormateo, { includeRaw: true });

  async function nodoAgentePrincipal(estado: Estado): Promise<Partial<Estado>> {
    const resultado = await agentePrincipal.invoke(
      { messages: estado.messages },
      { recursionLimit: LIMITE_RECURSION }
    );
    const mensajesNuevos = (resultado.messages as BaseMessage[]).slice(estado.messages.length);
    const uso = mensajesNuevos
      .map((m) => usoDeMensaje(MODELO_PRINCIPAL, m))
      .filter((u): u is UsoRegistrado => u !== null);
    const ultimo = mensajesNuevos[mensajesNuevos.length - 1];
    return {
      messages: mensajesNuevos,
      borrador: extraerTexto(ultimo?.content),
      usoTokens: uso,
    };
  }

  async function nodoFormateador(estado: Estado): Promise<Partial<Estado>> {
    // El prefijo [ESCALAR] (si está) nunca debe llegar al formateador ni al
    // cliente — se limpia acá, igual que "Limpiar Tag Escalar" en n8n. El
    // borrador CRUDO (con el prefijo intacto) se preserva en estado.borrador
    // para que el caller pueda exponerlo tal cual a n8n.
    const textoLimpio = estado.borrador.replace(/^\s*\[ESCALAR\]\s*/i, '').trim();

    try {
      const resultado = await formateadorConSchema.invoke([
        new SystemMessage(PROMPT_FORMATEADOR),
        new HumanMessage(`Texto de entrada:\n${textoLimpio}`),
      ]);
      const uso = usoDeMensaje(MODELO_VERIFICADOR, resultado.raw);
      const r = resultado.parsed.response;
      return {
        respuestaFormateada: {
          part_1: r.part_1,
          part_2: r.part_2 ?? undefined,
          part_3: r.part_3 ?? undefined,
          part_4: r.part_4 ?? undefined,
          part_5: r.part_5 ?? undefined,
        },
        etapa: resultado.parsed.etapa,
        usoTokens: uso ? [uso] : [],
      };
    } catch (error) {
      // El formateador es un paso de presentación, no la única vía de
      // respuesta: si falla, se manda el texto crudo como part_1 en vez de
      // dejar al cliente sin respuesta. La clasificación de etapa cae a
      // CONTACTO INICIAL (el default más neutro) — n8n queda con lo mismo
      // que hoy pasa si el auto-fixing parser tampoco logra corregir.
      console.error('[AgenteComercial] Formateador falló, se envía el texto sin formatear:', error);
      return { respuestaFormateada: { part_1: textoLimpio || 'Un asesor va a continuar la conversación contigo.' }, etapa: 'CONTACTO INICIAL', usoTokens: [] };
    }
  }

  const grafo = new StateGraph(EstadoAgente)
    .addNode('agente_principal', nodoAgentePrincipal)
    .addNode('formateador', nodoFormateador)
    .addEdge(START, 'agente_principal')
    .addEdge('agente_principal', 'formateador')
    .addEdge('formateador', END)
    .compile();

  const resultado = await grafo.invoke({ messages: historial });

  const response = resultado.respuestaFormateada ?? { part_1: resultado.borrador };

  const tagPresente = /^\s*\[ESCALAR\]/i.test(resultado.borrador);
  const { autoEscalar, prioridad } = evaluarEscalamiento(bitacora);
  const escalado = tagPresente || autoEscalar;

  // n8n decide la etapa de Kommo leyendo si `output` empieza con [ESCALAR]
  // (nodo "Escalar?" y "Prepare Update Payload"). Se normaliza acá para que
  // el escalamiento derivado por código llegue igual que el del modelo.
  // `response` (lo que ve el cliente) nunca lleva la etiqueta.
  const output = escalado && !tagPresente ? `[ESCALAR] ${resultado.borrador}` : resultado.borrador;

  // Una solicitud de apertura pendiente NO es una cita agendada: dejar que el
  // clasificador la mande a "CITA AGENDADA" movería el lead a una etapa falsa
  // (y podría disparar el salesbot de confirmación de citas). Cuando el
  // escalamiento es urgente, la etapa la manda n8n a "Escalado a asesor", pero
  // se corrige igual para que el dato que registramos no mienta.
  const citaReal = bitacora.some((h) => {
    if (h.nombre !== 'agendar_cita') return false;
    const s = typeof h.salida === 'string' ? safeParse(h.salida) : h.salida;
    return !!(s && typeof s === 'object' && (s as { success?: boolean }).success === true);
  });
  // La etapa la manda el hecho, no la interpretación del formateador: si hubo
  // cita, es CITA AGENDADA (n8n la usa para NO mandar el lead a "Escalado a
  // asesor", que dejaría al agente mudo con un cliente que acaba de convertir
  // y todavía puede querer reprogramar o preguntar cómo llegar); si no la
  // hubo, nunca puede decir que sí.
  const etapa: Etapa = citaReal
    ? 'CITA AGENDADA'
    : resultado.etapa === 'CITA AGENDADA'
      ? 'CONSULTA'
      : resultado.etapa;

  const leadCaliente = detectarLeadCaliente(bitacora);

  return {
    output,
    response,
    etapa,
    escalado,
    prioridad: leadCaliente && prioridad === 'normal' ? 'urgente' : prioridad,
    leadCaliente,
    contexto: armarContexto(bitacora, telefono),
    respuesta: Object.values(response).filter(Boolean).join('\n\n'),
    herramientasUsadas: bitacora,
    uso: resultado.usoTokens,
  };
}
