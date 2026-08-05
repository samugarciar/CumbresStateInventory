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

/** Inicio del mes actual en Bogotá, como instante UTC (Colombia es UTC-5 fijo). */
function inicioMesBogotaISO(): string {
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  return `${ym}-01T05:00:00.000Z`;
}

export interface EstadoPresupuesto {
  agotado: boolean;
  gastadoUsd: number;
  limiteUsd: number | null;
}

/**
 * ¿El agente ya gastó su presupuesto del mes?
 *
 * Un agente que corre solo (las alertas por correo entran sin que nadie mire)
 * necesita un techo: sin esto, un digest enorme o un bucle de reintentos podría
 * disparar el gasto sin que nadie se entere hasta la factura. Sin límite
 * configurado no se bloquea nada.
 */
export async function estadoPresupuesto(
  supabase: SupabaseClient,
  inmobiliariaId: string
): Promise<EstadoPresupuesto> {
  const { data: config } = await supabase
    .from('agentes_config')
    .select('limite_mensual_usd')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();

  const limiteUsd = config?.limite_mensual_usd != null ? Number(config.limite_mensual_usd) : null;
  if (!limiteUsd || limiteUsd <= 0) return { agotado: false, gastadoUsd: 0, limiteUsd: null };

  const { data: filas } = await supabase
    .from('captacion_uso')
    .select('costo_usd')
    .eq('inmobiliaria_id', inmobiliariaId)
    .gte('created_at', inicioMesBogotaISO());

  const gastadoUsd = (filas ?? []).reduce((a, f) => a + Number(f.costo_usd || 0), 0);
  return { agotado: gastadoUsd >= limiteUsd, gastadoUsd, limiteUsd };
}

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
