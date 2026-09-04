'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

interface FranjaData {
  inmueble_id: string;
  asesor_id: string;
  fecha: string;        // 'YYYY-MM-DD'
  hora_inicio: string;  // 'HH:MM'
  hora_fin: string;     // 'HH:MM'
  color?: string;
}

interface CitaManualData {
  franja_id: string;
  cliente_nombre: string;
  cliente_telefono: string;
  notas?: string | null;
}

// Misma lógica que public.ubicacion_key en la BD: la franja de un inmueble
// aplica a todos los que comparten unidad (o dirección exacta si no hay unidad)
function ubicacionKey(unidad: string | null, direccion: string): string {
  const u = (unidad || '').trim();
  return (u !== '' ? u : direccion).trim().toLowerCase();
}

// Cuenta cuántos inmuebles activos quedan cubiertos por la franja de un inmueble
async function contarInmueblesCubiertos(supabase: any, inmuebleId: string): Promise<number> {
  const { data: base } = await supabase
    .from('inmuebles')
    .select('inmobiliaria_id, unidad, direccion')
    .eq('id', inmuebleId)
    .single();
  if (!base) return 1;

  const { data: candidatos } = await supabase
    .from('inmuebles')
    .select('id, unidad, direccion')
    .eq('inmobiliaria_id', base.inmobiliaria_id)
    .neq('estado', 'inactivo');

  const key = ubicacionKey(base.unidad, base.direccion);
  return (candidatos || []).filter(
    (i: any) => ubicacionKey(i.unidad, i.direccion) === key
  ).length || 1;
}

/**
 * Crea una nueva franja horaria en la agenda.
 * Solo admins pueden crear franjas.
 */
export async function crearFranjaHoraria(data: FranjaData) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    // Obtener perfil para verificar rol y obtener inmobiliaria_id
    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol, inmobiliaria_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Solo los administradores pueden programar franjas.' };
    }

    // Validar que no exista overlap con otra franja del mismo asesor en la misma fecha/hora
    const { data: overlaps } = await supabase
      .from('franjas_horarias')
      .select('id')
      .eq('asesor_id', data.asesor_id)
      .eq('fecha', data.fecha)
      .lt('hora_inicio', data.hora_fin)
      .gt('hora_fin', data.hora_inicio);

    if (overlaps && overlaps.length > 0) {
      return { success: false, error: 'Ya existe una franja en ese horario para este asesor.' };
    }

    const { error } = await supabase
      .from('franjas_horarias')
      .insert({
        inmobiliaria_id: profile.inmobiliaria_id,
        inmueble_id: data.inmueble_id,
        asesor_id: data.asesor_id,
        fecha: data.fecha,
        hora_inicio: data.hora_inicio,
        hora_fin: data.hora_fin,
        color: data.color || '#00abd8',
        creado_por: user.id
      });

    if (error) {
      console.error('[Agenda] Error al crear franja:', error.message);
      return { success: false, error: 'Error al crear la franja horaria.' };
    }

    const cubiertos = await contarInmueblesCubiertos(supabase, data.inmueble_id);

    revalidatePath('/agenda');
    return {
      success: true,
      message: cubiertos > 1
        ? `Franja creada. Este horario cubre ${cubiertos} inmuebles en la misma ubicación.`
        : 'Franja creada.'
    };
  } catch (error: any) {
    console.error('[Agenda] Excepción:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}

/**
 * Actualiza una franja horaria existente.
 * Solo admins pueden editar.
 */
export async function actualizarFranjaHoraria(id: string, data: FranjaData) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Solo los administradores pueden editar franjas.' };
    }

    // Validar overlap excluyendo la franja actual
    const { data: overlaps } = await supabase
      .from('franjas_horarias')
      .select('id')
      .eq('asesor_id', data.asesor_id)
      .eq('fecha', data.fecha)
      .neq('id', id)
      .lt('hora_inicio', data.hora_fin)
      .gt('hora_fin', data.hora_inicio);

    if (overlaps && overlaps.length > 0) {
      return { success: false, error: 'Ya existe una franja en ese horario para este asesor.' };
    }

    // Las citas ya agendadas deben seguir cabiendo en el nuevo horario
    const { data: citasActivas } = await supabase
      .from('citas')
      .select('id, fecha, hora_inicio, hora_fin')
      .eq('franja_id', id)
      .eq('estado', 'agendada');

    const citaFuera = (citasActivas || []).find((c: any) =>
      c.fecha !== data.fecha ||
      c.hora_inicio.substring(0, 5) < data.hora_inicio ||
      c.hora_fin.substring(0, 5) > data.hora_fin
    );
    if (citaFuera) {
      return {
        success: false,
        error: 'Hay citas agendadas que quedarían fuera del nuevo horario. Cancélalas primero o amplía el rango.'
      };
    }

    const { error } = await supabase
      .from('franjas_horarias')
      .update({
        inmueble_id: data.inmueble_id,
        asesor_id: data.asesor_id,
        fecha: data.fecha,
        hora_inicio: data.hora_inicio,
        hora_fin: data.hora_fin,
        color: data.color || '#00abd8',
      })
      .eq('id', id);

    if (error) {
      console.error('[Agenda] Error al actualizar franja:', error.message);
      return { success: false, error: 'Error al actualizar la franja horaria.' };
    }

    revalidatePath('/agenda');
    return { success: true };
  } catch (error: any) {
    console.error('[Agenda] Excepción:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}

/**
 * Cancela una cita agendada (por el agente n8n o manualmente).
 * Solo admins pueden cancelar desde la app.
 */
export async function cancelarCitaAdmin(citaId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Solo los administradores pueden cancelar citas.' };
    }

    const { error } = await supabase
      .from('citas')
      .update({ estado: 'cancelada' })
      .eq('id', citaId)
      .eq('estado', 'agendada');

    if (error) {
      console.error('[Agenda] Error al cancelar cita:', error.message);
      return { success: false, error: 'Error al cancelar la cita.' };
    }

    revalidatePath('/agenda');
    return { success: true };
  } catch (error: any) {
    console.error('[Agenda] Excepción:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}

/**
 * Elimina una franja horaria.
 * Solo admins pueden eliminar.
 */
export async function eliminarFranjaHoraria(id: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Solo los administradores pueden eliminar franjas.' };
    }

    // No eliminar franjas con citas vigentes (el cliente ya confirmó la visita)
    const { count: citasActivas } = await supabase
      .from('citas')
      .select('id', { count: 'exact', head: true })
      .eq('franja_id', id)
      .eq('estado', 'agendada');

    if (citasActivas && citasActivas > 0) {
      return {
        success: false,
        error: `Esta franja tiene ${citasActivas} cita(s) agendada(s). Cancélalas antes de eliminarla.`
      };
    }

    const { error } = await supabase
      .from('franjas_horarias')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Agenda] Error al eliminar franja:', error.message);
      return { success: false, error: 'Error al eliminar la franja horaria.' };
    }

    revalidatePath('/agenda');
    return { success: true };
  } catch (error: any) {
    console.error('[Agenda] Excepción:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}

/**
 * Agenda una cita manualmente (solo admin) eligiendo una FRANJA ya creada en la
 * agenda. La franja ya define asesor, inmueble, fecha y horario; el admin solo
 * agrega el cliente. La cita toma el horario completo de la franja (se permiten
 * varias citas a la vez en una misma franja → visitas grupales de la unidad).
 */
export async function agendarCitaManual(data: CitaManualData) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol, inmobiliaria_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Solo los administradores pueden agendar citas manualmente.' };
    }

    const nombre = (data.cliente_nombre || '').trim();
    const telefono = (data.cliente_telefono || '').trim();
    if (!nombre || !telefono) {
      return { success: false, error: 'El nombre y el teléfono del cliente son obligatorios.' };
    }
    if (!data.franja_id) {
      return { success: false, error: 'Selecciona una franja disponible.' };
    }

    // La franja ya tiene asesor, inmueble, fecha y horario. Debe ser de la inmobiliaria del admin.
    const { data: franja } = await supabase
      .from('franjas_horarias')
      .select('id, inmobiliaria_id, inmueble_id, fecha, hora_inicio, hora_fin')
      .eq('id', data.franja_id)
      .single();

    if (!franja || franja.inmobiliaria_id !== profile.inmobiliaria_id) {
      return { success: false, error: 'Franja no encontrada.' };
    }

    // La cita hereda inmueble, fecha y horario de la franja
    const { error: insertError } = await supabase
      .from('citas')
      .insert({
        inmobiliaria_id: franja.inmobiliaria_id,
        franja_id: franja.id,
        inmueble_id: franja.inmueble_id,
        fecha: franja.fecha,
        hora_inicio: franja.hora_inicio,
        hora_fin: franja.hora_fin,
        cliente_nombre: nombre,
        cliente_telefono: telefono,
        cliente_email: null,
        notas: (data.notas || '').trim() || null,
        origen: 'app',
        estado: 'agendada',
      });

    if (insertError) {
      // 23P01 = exclusion_violation: aún está el candado anti-cruce (migración pendiente de aplicar)
      if ((insertError as any).code === '23P01') {
        return { success: false, error: 'Esta franja ya tiene una cita. Para permitir varias a la vez, aplica la migración de citas múltiples (2026-06-20) en Supabase.' };
      }
      console.error('[Agenda] Error al agendar cita manual:', insertError.message);
      return { success: false, error: 'No se pudo agendar la cita.' };
    }

    revalidatePath('/citas');
    revalidatePath('/agenda');
    return { success: true, message: `Cita agendada para ${nombre}.` };
  } catch (error: any) {
    console.error('[Agenda] Excepción agendarCitaManual:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}

/**
 * Dispara el webhook del flujo n8n "Confirmacion citas cumbres" con las citas
 * seleccionadas por el admin. El webhook responde 200 de inmediato (fire-and-forget,
 * sin auth), así que "éxito" aquí significa que el POST se entregó, no que el flujo
 * haya terminado de reflejar cada cita en Kommo.
 *
 * Contrato del payload (según el flujo): { citas: [ { Inmueble, Tercero, Telefono, Hora, ... } ] }
 * donde Inmueble debe coincidir con el título del inmueble para que el flujo lo cruce.
 */
/**
 * El asesor marca una de SUS citas como realizada (estado='completada').
 * Va por el RPC marcar_cita_realizada (SECURITY DEFINER) porque los asesores solo
 * tienen SELECT sobre citas por RLS; el RPC valida que quien llama sea el asesor
 * dueño de la franja. La cita sale de la lista (que filtra estado='agendada').
 */
export async function marcarCitaRealizada(citaId: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    const { data, error } = await supabase.rpc('marcar_cita_realizada', { p_cita_id: citaId });

    if (error) {
      console.error('[Agenda] Error al marcar cita realizada:', error.message);
      return { success: false, error: 'No se pudo marcar la cita como realizada.' };
    }

    const res = (data ?? {}) as { success?: boolean; error?: string };
    if (!res.success) {
      return { success: false, error: res.error || 'No se pudo marcar la cita como realizada.' };
    }

    revalidatePath('/citas');
    revalidatePath('/agenda');
    return { success: true };
  } catch (err: any) {
    console.error('[Agenda] Excepción marcarCitaRealizada:', err);
    return { success: false, error: err.message || 'Error interno.' };
  }
}

export async function confirmarCitas(citaIds: string[]) {
  try {
    if (!citaIds || citaIds.length === 0) {
      return { success: false, error: 'No seleccionaste ninguna cita.' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada.' };

    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Solo los administradores pueden confirmar citas.' };
    }

    // Cargar las citas seleccionadas (el RLS las acota a la inmobiliaria del admin).
    // El asesor (nombre + teléfono) sale de la franja → usuarios.
    const { data: citas } = await supabase
      .from('citas')
      .select(`
        id, fecha, hora_inicio, hora_fin, cliente_nombre, cliente_telefono,
        inmuebles ( titulo, direccion ),
        franjas_horarias ( usuarios!franjas_horarias_asesor_id_fkey ( nombre_completo, telefono ) )
      `)
      .in('id', citaIds)
      .eq('estado', 'agendada');

    if (!citas || citas.length === 0) {
      return { success: false, error: 'No se encontraron las citas seleccionadas.' };
    }

    // Payload con la forma que espera el flujo de n8n.
    // Nota: los nombres de campo vienen del workflow ("Standardize Appointment").
    const payload = {
      citas: citas.map((c: any) => ({
        cita_id: c.id,
        Inmueble: c.inmuebles?.titulo || '',
        Direccion: c.inmuebles?.direccion || '',
        Tercero: c.cliente_nombre,
        Telefono: c.cliente_telefono,
        Fecha: c.fecha,
        Hora: c.hora_inicio?.substring(0, 5) || '',
        Asesor: c.franjas_horarias?.usuarios?.nombre_completo || '',
        TelefonoAsesor: c.franjas_horarias?.usuarios?.telefono || '',
      })),
    };

    const url = process.env.N8N_CONFIRMAR_CITAS_URL
      || 'https://n8n.arriendabot.com/webhook/confirmar-citas';
    // El webhook exige Header Auth (X-Webhook-Token). El token va en el entorno,
    // nunca en el código ni en el navegador (este action corre en el servidor).
    const token = process.env.N8N_CONFIRMAR_CITAS_TOKEN;

    if (!token) {
      console.error('[Citas] Falta N8N_CONFIRMAR_CITAS_TOKEN en el entorno.');
      return { success: false, error: 'El servicio de confirmación no está configurado (falta el token). Avisa al administrador.' };
    }

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Token': token,
        },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      console.error('[Citas] Error de red al disparar el webhook:', e?.message);
      return { success: false, error: 'No se pudo contactar el servicio de confirmación. Revisa la conexión.' };
    }

    if (!resp.ok) {
      console.error('[Citas] El webhook respondió con estado', resp.status);
      return { success: false, error: `El servicio de confirmación respondió con un error (${resp.status}).` };
    }

    // Marcar las citas enviadas como confirmadas (queda el rastro de cuáles y
    // cuándo; re-enviar actualiza la marca). Best-effort: si falla, el envío
    // al flujo ya ocurrió y solo se pierde el badge.
    const { error: markErr } = await supabase
      .from('citas')
      .update({ confirmada_at: new Date().toISOString(), confirmada_por: user.id })
      .in('id', citas.map((c: any) => c.id));
    if (markErr) {
      console.warn('[Citas] Enviadas al flujo pero no se pudieron marcar como confirmadas:', markErr.message);
    }

    // Cerrar la tarea "Confirmar cita" que el agente creó al agendarla, para
    // que no quede pendiente algo que ya se hizo (mismo patrón que
    // completarTareaSolicitud en solicitudes.ts). Best-effort.
    const { error: tareaErr } = await supabase
      .from('tareas')
      .update({
        estado: 'completada',
        completada_at: new Date().toISOString(),
        completada_por: user.id,
      })
      .in('entidad_id', citas.map((c: any) => c.id))
      .eq('evento_origen', 'cita_agendada')
      .eq('estado', 'pendiente');
    if (tareaErr) {
      console.warn('[Citas] No se pudieron completar las tareas de confirmación:', tareaErr.message);
    }

    revalidatePath('/citas');
    revalidatePath('/tareas');
    return { success: true, count: payload.citas.length };
  } catch (error: any) {
    console.error('[Citas] Excepción confirmarCitas:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}
