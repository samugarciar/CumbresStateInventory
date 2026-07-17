// Cálculo del costo en USD de las peticiones del agente comercial de
// WhatsApp, a partir del uso de tokens que reporta la API de OpenAI.
// Precios oficiales por millón de tokens (platform.openai.com/docs/pricing,
// verificado jul 2026 — a diferencia de Anthropic, OpenAI reporta el
// descuento de cache como un solo "cached_tokens" ya con descuento aplicado
// en el precio de entrada, no como lectura/escritura separadas).
//
// OJO: estos precios cambian con cierta frecuencia — antes de confiar en
// esta tabla para una decisión de negocio (ej. la auditoría de costos),
// verificar contra la página oficial.

// ÚNICA fuente del modelo principal y del verificador. GPT-4.1 por defecto
// para el principal (paridad con el nodo "GPT 4.1" de n8n); el verificador
// arranca en GPT-4o (paridad con "GPT 4o Verificador") pero es el candidato
// explícito a bajar de modelo en la auditoría de costos — ver Fase 7 del plan.
export const MODELO_PRINCIPAL = process.env.AGENTE_COMERCIAL_MODELO || 'gpt-4.1';
export const MODELO_VERIFICADOR = process.env.AGENTE_COMERCIAL_MODELO_VERIFICADOR || 'gpt-4o';

interface PrecioModelo {
  entrada: number; // USD por millón de tokens de entrada
  salida: number;  // USD por millón de tokens de salida
}

const PRECIOS: Record<string, PrecioModelo> = {
  'gpt-4.1-nano': { entrada: 0.10, salida: 0.40 },
  'gpt-4.1-mini': { entrada: 0.40, salida: 1.60 },
  'gpt-4.1': { entrada: 2.00, salida: 8.00 },
  'gpt-4o-mini': { entrada: 0.15, salida: 0.60 },
  'gpt-4o': { entrada: 2.50, salida: 10.00 },
};

// Descuento publicado de OpenAI para tokens de entrada servidos desde cache
// (prompt automático, sin cache_control explícito como en Anthropic).
// Verificar contra platform.openai.com/docs/pricing — puede variar por modelo.
const FACTOR_CACHE = 0.5;

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
    (uso.cache / 1_000_000) * precio.entrada * FACTOR_CACHE +
    (uso.salida / 1_000_000) * precio.salida;
  // numeric(12,6) en agente_comercial_uso
  return Math.round(costo * 1_000_000) / 1_000_000;
}
