// Cálculo del costo en USD de las peticiones del agente comercial de
// WhatsApp, a partir del uso de tokens que reporta la API de OpenAI.
// Precios oficiales por millón de tokens (platform.openai.com/docs/pricing,
// verificado jul 2026, cache y gpt-5 nov 2026 — a diferencia de Anthropic, OpenAI reporta el
// descuento de cache como un solo "cached_tokens" ya con descuento aplicado
// en el precio de entrada, no como lectura/escritura separadas).
//
// OJO: estos precios cambian con cierta frecuencia — antes de confiar en
// esta tabla para una decisión de negocio (ej. la auditoría de costos),
// verificar contra la página oficial.

// ÚNICA fuente del modelo principal y del verificador. gpt-6-luna para los dos
// desde el 19 nov 2026: OpenAI apaga gpt-4.1, gpt-4o y sus mini el 14 ene 2027
// (`shutdown_date` en GET /v1/models) y gpt-5-mini el 11 dic 2026. Probado con
// scripts/comparar-modelos/ sobre 96 turnos reales y 24 conversaciones: igual
// o mejor que gpt-4.1 en 86 de 96, unas 10 veces más barato. Antes de cambiar
// de modelo, repetir esa prueba.
export const MODELO_PRINCIPAL = process.env.AGENTE_COMERCIAL_MODELO || 'gpt-6-luna';
export const MODELO_VERIFICADOR = process.env.AGENTE_COMERCIAL_MODELO_VERIFICADOR || 'gpt-6-luna';

// Esfuerzo de razonamiento para los modelos que razonan (gpt-5*, gpt-6*).
// Más esfuerzo = más tokens de salida y más demora. Los valores válidos
// dependen del modelo: gpt-6-luna acepta none/low/medium/high/xhigh (no
// 'minimal'); gpt-5 acepta minimal/low/medium/high. No aplica a gpt-4.x.
// ⚠️ gpt-6-luna en /v1/chat/completions SOLO acepta herramientas con 'none':
// con cualquier otro valor cada llamada del agente devuelve 400. Subirlo pide
// pasar a la Responses API (useResponsesApi en ChatOpenAI) y volver a probar.
export const RAZONAMIENTO_PRINCIPAL = process.env.AGENTE_COMERCIAL_RAZONAMIENTO || 'none';
// El formateador solo parte el texto y clasifica la etapa: no necesita pensar.
export const RAZONAMIENTO_VERIFICADOR = process.env.AGENTE_COMERCIAL_RAZONAMIENTO_VERIFICADOR || 'none';

// Los modelos que razonan rechazan `temperature` distinta de 1: hay que
// omitirla y pasar el esfuerzo en su lugar. Ojo: @langchain/openai 1.5 solo
// reconoce gpt-5* y o*, así que el esfuerzo se manda por modelKwargs (ver
// graph.ts) y no por su opción `reasoning`, que descarta para gpt-6.
export function esModeloQueRazona(modelo: string): boolean {
  return (
    /^o\d/.test(modelo) ||
    (modelo.startsWith('gpt-5') && !modelo.startsWith('gpt-5-chat')) ||
    /^gpt-([6-9]|\d{2,})/.test(modelo)
  );
}

// Opciones de ChatOpenAI según el modelo: temperatura 0 en los que la
// aceptan, esfuerzo de razonamiento en los que razonan.
export function opcionesDeModelo(
  modelo: string,
  esfuerzo: string
): { temperature: number } | { modelKwargs: { reasoning_effort: string } } {
  return esModeloQueRazona(modelo) ? { modelKwargs: { reasoning_effort: esfuerzo } } : { temperature: 0 };
}

interface PrecioModelo {
  entrada: number; // USD por millón de tokens de entrada
  cache: number;   // USD por millón de tokens de entrada servidos desde cache
  salida: number;  // USD por millón de tokens de salida (en gpt-5* incluye el razonamiento)
}

// El descuento de cache NO es parejo: 50 % en gpt-4o, 75 % en gpt-4.1,
// 90 % en gpt-5 y gpt-6. Hasta nov/2026 se usaba un 50 % fijo y el panel de
// /agentes mostraba ~60 % más gasto del real con gpt-4.1.
const PRECIOS: Record<string, PrecioModelo> = {
  // gpt-6-luna: precio de trackers de terceros (nov 2026), confirmar contra
  // platform.openai.com/docs/pricing.
  'gpt-6-luna': { entrada: 0.10, cache: 0.01, salida: 0.50 },
  'gpt-5-nano': { entrada: 0.05, cache: 0.005, salida: 0.40 },
  'gpt-5-mini': { entrada: 0.25, cache: 0.025, salida: 2.00 },
  'gpt-4.1-nano': { entrada: 0.10, cache: 0.025, salida: 0.40 },
  'gpt-4.1-mini': { entrada: 0.40, cache: 0.10, salida: 1.60 },
  'gpt-4.1': { entrada: 2.00, cache: 0.50, salida: 8.00 },
  'gpt-4o-mini': { entrada: 0.15, cache: 0.075, salida: 0.60 },
  'gpt-4o': { entrada: 2.50, cache: 1.25, salida: 10.00 },
};

// Precio del modelo por prefijo más largo que matchee (para que 'gpt-4o-mini'
// no caiga en la entrada 'gpt-4o'). Si el modelo no está en la tabla, asume
// precio de gpt-4o (peor caso razonable: nunca subestimar el gasto).
export function precioModelo(modelo: string): PrecioModelo {
  const claves = Object.keys(PRECIOS).sort((a, b) => b.length - a.length);
  for (const clave of claves) {
    if (modelo.startsWith(clave)) return PRECIOS[clave];
  }
  return PRECIOS['gpt-4o'];
}

export interface UsoTokens {
  entrada: number; // tokens de entrada SIN cache
  salida: number;
  cache: number;   // cached_tokens reportado por OpenAI (ya implica descuento)
}

export function calcularCostoUSD(modelo: string, uso: UsoTokens): number {
  const precio = precioModelo(modelo);
  const costo =
    (uso.entrada / 1_000_000) * precio.entrada +
    (uso.cache / 1_000_000) * precio.cache +
    (uso.salida / 1_000_000) * precio.salida;
  // numeric(12,6) en agente_comercial_uso
  return Math.round(costo * 1_000_000) / 1_000_000;
}
