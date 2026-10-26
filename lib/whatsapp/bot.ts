import type { createAdminClient } from '@/lib/supabase/admin';

type Supabase = ReturnType<typeof createAdminClient>;

/**
 * ¿Puede el bot contestarle a este teléfono? Lo decide el CRM
 * (crm.bot_puede_responder): el silencio por persona —relevo, escalamiento,
 * a mano— y el freno de la 324 (crm.frenos_bot).
 *
 * CON LA LÍNEA. Desde el 26 oct (migración del CRM 20261026100005) la
 * función recibe también el número por el que entró el mensaje: el freno de
 * la 324 no aplica a lo que entra por una línea oficial. Si esa versión
 * todavía no existe en la base (la migración no se ha aplicado), se
 * pregunta con la de dos argumentos, como hasta hoy.
 *
 * FALLA HACIA «SÍ RESPONDE», A PROPÓSITO: si el CRM no contesta, el cliente
 * recibe respuesta. Un bot que habla de más lo corrige un asesor; un canal
 * mudo por un error del CRM no lo ve nadie.
 */
export async function botPuedeResponder(
  supabase: Supabase,
  inmobiliariaId: string,
  telefono: string,
  waPhoneNumberId?: string | null
): Promise<boolean> {
  try {
    const crm = supabase.schema('crm');
    if (waPhoneNumberId) {
      const { data, error } = await crm.rpc('bot_puede_responder', {
        p_inmobiliaria_id: inmobiliariaId,
        p_telefono: telefono,
        p_wa_phone_number_id: waPhoneNumberId,
      });
      if (!error) return data !== false;
      // PGRST202: PostgREST no conoce esa firma (la migración falta). Otro
      // error también cae a la pregunta de siempre antes de rendirse.
      console.warn('[Bot] bot_puede_responder con línea falló; se pregunta sin línea:', error.code, error.message);
    }
    const { data, error } = await crm.rpc('bot_puede_responder', {
      p_inmobiliaria_id: inmobiliariaId,
      p_telefono: telefono,
    });
    if (error) {
      console.error('[Bot] No se pudo consultar si el bot puede responder:', error.message);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.error('[Bot] No se pudo consultar si el bot puede responder:', error);
    return true;
  }
}
