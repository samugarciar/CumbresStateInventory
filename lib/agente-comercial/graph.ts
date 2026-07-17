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
  output: string; // borrador crudo del agente principal, CON el prefijo [ESCALAR] intacto si aplica
  response: { part_1: string; part_2?: string; part_3?: string; part_4?: string; part_5?: string };
  etapa: Etapa;
  escalado: boolean;
  respuesta: string; // conveniencia: las partes unidas, para el log de mensajes y pruebas directas
  herramientasUsadas: HerramientaUsada[];
  uso: UsoRegistrado[];
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
}): Promise<ResultadoAgenteComercial> {
  const { supabase, inmobiliariaId, promptSistema, historial } = params;

  const bitacora: HerramientaUsada[] = [];
  const tools = crearToolsAgenteComercial(supabase, inmobiliariaId, bitacora);

  const modeloPrincipal = new ChatOpenAI({ model: MODELO_PRINCIPAL, temperature: 0, maxRetries: 3 });
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
  const escalado = /^\s*\[ESCALAR\]/i.test(resultado.borrador);

  return {
    output: resultado.borrador,
    response,
    etapa: resultado.etapa,
    escalado,
    respuesta: Object.values(response).filter(Boolean).join('\n\n'),
    herramientasUsadas: bitacora,
    uso: resultado.usoTokens,
  };
}
