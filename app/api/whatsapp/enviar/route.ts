import { createAdminClient } from '@/lib/supabase/admin';
import { enviarTexto, enviarPlantilla, estaConfigurado } from '@/lib/whatsapp/meta';

/**
 * Por aquí manda el CRM.
 *
 * Es la otra mitad de la decisión 13 —«el CRM pide, la plataforma
 * escribe»—: el CRM no habla con Meta ni escribe en `public`, llama aquí
 * con un token y esta ruta hace las dos cosas.
 *
 * Que el mensaje del asesor se guarde en `agente_comercial_mensajes`, al
 * lado de los del bot, no es un detalle de implementación: es lo que hace
 * que aparezca en `crm.actividades` por el trigger de proyección que ya
 * existe, y con eso se cierra el agujero de los CERO salientes humanos —
 * la ceguera que bloqueaba medir el ghosteo y saber si alguien atendió
 * después de escalar.
 *
 * NO COMPRUEBA LA VENTANA DE 24 HORAS, y es deliberado: eso ya lo decidió
 * `crm.encolar_envio()`, que revienta con texto libre fuera de plazo. Aquí
 * se repetiría la regla en una segunda capa, y este proyecto ya se quemó
 * con un valor duplicado en dos sitios — se arregló en uno y siguió mal en
 * el otro. Meta es la última palabra de todos modos: si se cuela algo,
 * responde 131047 y queda registrado como fallido.
 */

export const maxDuration = 60;

interface Peticion {
  inmobiliaria_id?: string;
  telefono?: string;
  texto?: string;
  /** La fila que el CRM ya creó con crm.encolar_envio(). */
  envio_id?: string;
  plantilla?: {
    nombre_meta?: string;
    idioma?: string;
    variables?: Record<string, string>;
  };
}

export async function POST(request: Request) {
  const token = request.headers.get('x-crm-token');
  if (!token || token !== process.env.CRM_ENVIO_TOKEN) {
    return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  if (!estaConfigurado()) {
    return Response.json(
      {
        ok: false,
        error:
          'El canal propio todavía no está configurado: el número sigue fuera de la Cloud API de Meta.',
      },
      { status: 503 }
    );
  }

  const cuerpo: Peticion | null = await request.json().catch(() => null);
  const telefono = cuerpo?.telefono?.trim();
  const inmobiliariaId = cuerpo?.inmobiliaria_id;
  const texto = cuerpo?.texto?.trim();

  if (!telefono || !inmobiliariaId || !texto) {
    return Response.json(
      { ok: false, error: 'Faltan telefono, inmobiliaria_id y/o texto' },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Fuera de la ventana, Meta solo entrega plantillas aprobadas. El
  // `texto` viaja igualmente porque es lo que se guarda en la
  // conversación: lo que el cliente ve es la plantilla ya rellena, y eso
  // es exactamente lo que hay que dejar escrito.
  const p = cuerpo?.plantilla;
  const r = p?.nombre_meta
    ? await enviarPlantilla(telefono, p.nombre_meta, p.idioma ?? 'es', p.variables ?? {})
    : await enviarTexto(telefono, texto);

  // ── Anotar el resultado en la fila que el CRM ya había creado ─────
  if (cuerpo?.envio_id) {
    if (r.ok && r.waMessageId) {
      await supabase
        .schema('crm')
        .from('envios')
        .update({ wa_message_id: r.waMessageId, estado: 'enviado', enviado_at: new Date().toISOString() })
        .eq('id', cuerpo.envio_id);
    } else if (r.codigo) {
      // Con código: Meta lo RECHAZÓ. Es un fallo de verdad.
      await supabase
        .schema('crm')
        .from('envios')
        .update({ estado: 'fallido', error_codigo: r.codigo, error: r.error, fallido_at: new Date().toISOString() })
        .eq('id', cuerpo.envio_id);
    }
    // Sin código es un fallo de RED, y ahí no se sabe si salió o no. Se
    // deja 'pendiente' a propósito: marcarlo fallido podría hacer que
    // alguien lo reenviara y el cliente recibiera el mensaje dos veces.
  }

  if (!r.ok) {
    return Response.json({ ok: false, codigo: r.codigo, error: r.error }, { status: 502 });
  }

  // ── Y en la conversación, para que se vea en el timeline ──────────
  const { data: conversacion } = await supabase
    .from('agente_comercial_conversaciones')
    .select('id')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('telefono', telefono)
    .maybeSingle();

  if (conversacion) {
    const { error } = await supabase.from('agente_comercial_mensajes').insert({
      conversacion_id: conversacion.id,
      rol: 'asesor',
      contenido: texto,
      wa_message_id: r.waMessageId,
    });
    if (error) {
      // El mensaje SALIÓ. Que no se pueda guardar es grave —el timeline
      // queda incompleto— pero devolver error haría que el asesor lo
      // mandara otra vez, y el cliente lo recibiría dos veces.
      console.error('[WhatsApp] Mensaje entregado pero no registrado:', error);
    }
  } else {
    console.error(
      '[WhatsApp] Mensaje entregado a un teléfono sin conversación abierta:',
      telefono
    );
  }

  return Response.json({ ok: true, wa_message_id: r.waMessageId });
}
