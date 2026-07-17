// Prompt del sistema del agente comercial de WhatsApp.
//
// A diferencia del Asesor BI (lib/bi/prompt.ts, constante estática), este
// prompt vive en la base de datos (agentes_config.prompt_sistema) — se ha
// editado quirúrgicamente muchas veces vía la API de n8n sin redeploy, y
// mudarlo a una constante de código sería un retroceso real en velocidad de
// edición. Ver sección 5 del plan de migración.
//
// Contenido estable (el prompt de negocio) primero; lo variable (teléfono,
// nombre del cliente, fecha) se inyecta al final — así el prefijo se
// mantiene idéntico entre requests y OpenAI puede servirlo desde su cache
// automático de prompt.

import { createAdminClient } from '@/lib/supabase/admin';

export async function cargarPromptSistema(inmobiliariaId: string): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('agentes_config')
    .select('prompt_sistema')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'comercial_whatsapp')
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar el prompt del agente comercial: ${error.message}`);
  }
  if (!data?.prompt_sistema || !data.prompt_sistema.trim()) {
    throw new Error(
      'agentes_config.prompt_sistema está vacío para comercial_whatsapp. Falta copiar el prompt ' +
        'vigente del nodo "Agente Cumbres AI" en n8n (workflow 3bihDRvaLKEDcQdw) y guardarlo ahí ' +
        '— ver Fase 0/1 del plan de migración. No se genera un prompt por defecto a propósito: ' +
        'inventar reglas de negocio aquí sería peor que fallar explícito.'
    );
  }
  return data.prompt_sistema;
}

// La fecha actual NO va aquí: n8n hoy se la da al agente en el mensaje del
// usuario de cada turno ("Fecha de hoy: ... \n\nMensaje del usuario: ..."),
// no en el prompt de sistema — se replica ese mismo patrón en el route (ver
// fraseFechaYMensaje en app/api/agentes/comercial-whatsapp/route.ts) para no
// desviarse del comportamiento ya validado en producción.
export function contextoVariable(args: { telefono: string; clienteNombre?: string | null }): string {
  return (
    '\n\n---\n' +
    'Contexto de esta conversación (interno, no se lo reveles al cliente tal cual):\n' +
    `- Teléfono del cliente: ${args.telefono}\n` +
    `- Nombre conocido del cliente: ${args.clienteNombre?.trim() || 'aún no lo sabemos, pregúntalo si lo necesitas'}\n`
  );
}
