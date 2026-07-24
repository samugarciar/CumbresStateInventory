'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { revalidatePath } from 'next/cache';

export type AgenteId = 'arriendabot_bi' | 'comercial_whatsapp' | 'captaciones';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') return null;
  return user;
}

/**
 * Prende o apaga un agente. Para el agente comercial de WhatsApp, apagarlo
 * hace que las RPCs que usa (consultar/agendar/cancelar/solicitar) respondan
 * "agente pausado" — el flujo de n8n recibe la señal sin romperse.
 */
export async function toggleAgente(agente: AgenteId, activo: boolean) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Solo los administradores pueden gestionar agentes.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('agentes_config')
    .upsert(
      {
        inmobiliaria_id: user.profile.inmobiliaria_id,
        agente,
        activo,
        updated_at: new Date().toISOString(),
        updated_by: user.profile.id,
      },
      { onConflict: 'inmobiliaria_id,agente' }
    );

  if (error) {
    console.error('[Agentes] Error al cambiar estado:', error.message);
    return { success: false, error: 'No se pudo cambiar el estado del agente.' };
  }

  revalidatePath('/agentes');
  return { success: true as const };
}

/**
 * Guarda el prompt de redacción del agente de captaciones (el estilo del primer
 * mensaje al propietario), editable en caliente sin redeploy. Vacío = volver al
 * default de código (lib/agente-captaciones/prompt.ts).
 *
 * Solo se expone el de captaciones a propósito: el prompt del agente comercial
 * viene de n8n y editarlo desde aquí sin más contexto sería riesgoso.
 */
export async function guardarPromptCaptaciones(prompt: string) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Solo los administradores pueden editar el prompt.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('agentes_config')
    .upsert(
      {
        inmobiliaria_id: user.profile.inmobiliaria_id,
        agente: 'captaciones',
        prompt_sistema: prompt.trim() || null,
        updated_at: new Date().toISOString(),
        updated_by: user.profile.id,
      },
      { onConflict: 'inmobiliaria_id,agente' }
    );

  if (error) {
    console.error('[Agentes] Error al guardar el prompt de captaciones:', error.message);
    return { success: false, error: 'No se pudo guardar el prompt.' };
  }

  revalidatePath('/agentes');
  return { success: true as const };
}

/**
 * Fija (o quita, con null) el límite de gasto mensual en USD del Asesor BI.
 * Al alcanzarlo, el chat responde como pausado hasta el mes siguiente o
 * hasta que se ajuste el límite.
 */
export async function guardarLimiteMensual(limiteUsd: number | null) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Solo los administradores pueden gestionar agentes.' };

  if (limiteUsd !== null && (!Number.isFinite(limiteUsd) || limiteUsd <= 0)) {
    return { success: false, error: 'El límite debe ser un monto en USD mayor a 0 (o vacío para quitarlo).' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('agentes_config')
    .upsert(
      {
        inmobiliaria_id: user.profile.inmobiliaria_id,
        agente: 'arriendabot_bi',
        limite_mensual_usd: limiteUsd,
        updated_at: new Date().toISOString(),
        updated_by: user.profile.id,
      },
      { onConflict: 'inmobiliaria_id,agente' }
    );

  if (error) {
    console.error('[Agentes] Error al guardar límite:', error.message);
    return { success: false, error: 'No se pudo guardar el límite mensual.' };
  }

  revalidatePath('/agentes');
  return { success: true as const };
}
