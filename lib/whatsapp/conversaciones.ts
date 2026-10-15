import type { createAdminClient } from '@/lib/supabase/admin';

type Supabase = ReturnType<typeof createAdminClient>;

/**
 * La conversación de esa persona, creándola si no existe.
 *
 * La usan el webhook (los ecos y el historial del celular) y la ruta por
 * la que manda el CRM: un recordatorio de cartera le llega a gente que
 * nunca nos escribió, y sin conversación el mensaje salía pero no quedaba
 * en ningún hilo, ni en la ficha del CRM.
 *
 * Dos escrituras pueden querer crearla a la vez (dos lotes del historial,
 * un envío y un mensaje que entra): si la segunda choca con el único
 * (23505), la de la primera ya está ahí y se usa esa.
 */
export async function conversacionDe(
  supabase: Supabase,
  inmobiliariaId: string,
  telefono: string
): Promise<string | null> {
  const buscar = () =>
    supabase
      .from('agente_comercial_conversaciones')
      .select('id')
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('telefono', telefono)
      .maybeSingle();

  const { data: existente } = await buscar();
  if (existente?.id) return existente.id as string;

  const { data: nueva, error } = await supabase
    .from('agente_comercial_conversaciones')
    .insert({ inmobiliaria_id: inmobiliariaId, telefono })
    .select('id')
    .single();
  if (nueva?.id) return nueva.id as string;
  if (error?.code === '23505') {
    const { data: otra } = await buscar();
    if (otra?.id) return otra.id as string;
  }
  console.error('[WhatsApp] No se pudo crear la conversación:', error?.message);
  return null;
}
