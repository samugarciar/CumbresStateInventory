// Persistencia del consumo LLM del agente de captaciones.
//
// El grafo devuelve el uso por nodo (calificar + redactar) pero no escribe: se
// guarda desde el caller (server action o route). Reutiliza la tabla de precios
// de lib/agente-comercial/costos.ts — es la ÚNICA fuente de precios de OpenAI
// del repo, y ya cubre gpt-4.1-mini / gpt-4.1.
//
// Best-effort a propósito: si falla el registro del uso NO se pierde el
// prospecto (medir es secundario frente a captar).

import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularCostoUSD } from '@/lib/agente-comercial/costos';
import type { UsoRegistrado } from './tipos';

export async function registrarUso(
  supabase: SupabaseClient,
  inmobiliariaId: string,
  prospectoId: string | null,
  uso: UsoRegistrado[]
): Promise<void> {
  if (!uso || uso.length === 0) return;
  const filas = uso.map((u) => ({
    inmobiliaria_id: inmobiliariaId,
    prospecto_id: prospectoId,
    modelo: u.modelo,
    tokens_entrada: u.entrada,
    tokens_salida: u.salida,
    tokens_cache: u.cache,
    costo_usd: calcularCostoUSD(u.modelo, { entrada: u.entrada, salida: u.salida, cache: u.cache }),
  }));
  const { error } = await supabase.from('captacion_uso').insert(filas);
  if (error) console.warn('[Captaciones] No se pudo registrar el uso:', error.message);
}
