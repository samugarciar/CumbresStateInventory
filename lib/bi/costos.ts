// Cálculo del costo en USD de las peticiones del Asesor BI, a partir del
// uso de tokens que reporta la API de Anthropic. Precios oficiales por
// millón de tokens (platform.claude.com/docs/en/pricing, jul 2026).
//
// Prompt caching: la lectura de cache cuesta 0.1x el precio de entrada y la
// escritura 1.25x (TTL de 5 minutos — el que usa el route con
// cache_control: {type: 'ephemeral'}).

interface PrecioModelo {
  entrada: number; // USD por millón de tokens de entrada
  salida: number;  // USD por millón de tokens de salida
}

const PRECIOS: Record<string, PrecioModelo> = {
  'claude-opus-4-8': { entrada: 5, salida: 25 },
  'claude-opus-4-7': { entrada: 5, salida: 25 },
  'claude-opus-4-6': { entrada: 5, salida: 25 },
  'claude-sonnet-5': { entrada: 3, salida: 15 },
  'claude-sonnet-4-6': { entrada: 3, salida: 15 },
  'claude-haiku-4-5': { entrada: 1, salida: 5 },
};

const FACTOR_CACHE_LECTURA = 0.1;
const FACTOR_CACHE_ESCRITURA = 1.25;

// Precio del modelo por prefijo (tolera IDs con sufijo de fecha). Si el
// modelo no está en la tabla, asume precio Opus (el peor caso: nunca
// subestimar el gasto frente a un límite mensual).
export function precioModelo(modelo: string): PrecioModelo {
  for (const [clave, precio] of Object.entries(PRECIOS)) {
    if (modelo.startsWith(clave)) return precio;
  }
  return { entrada: 5, salida: 25 };
}

export interface UsoTokens {
  entrada: number;        // tokens de entrada SIN cache
  salida: number;
  cacheLectura: number;   // tokens leídos del prompt cache
  cacheEscritura: number; // tokens escritos al prompt cache
}

export function calcularCostoUSD(modelo: string, uso: UsoTokens): number {
  const precio = precioModelo(modelo);
  const costo =
    (uso.entrada / 1_000_000) * precio.entrada +
    (uso.cacheLectura / 1_000_000) * precio.entrada * FACTOR_CACHE_LECTURA +
    (uso.cacheEscritura / 1_000_000) * precio.entrada * FACTOR_CACHE_ESCRITURA +
    (uso.salida / 1_000_000) * precio.salida;
  // numeric(12,6) en bi_uso
  return Math.round(costo * 1_000_000) / 1_000_000;
}
