'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { conversacionDe } from '@/lib/whatsapp/conversaciones';
import { anotarResultadoCredencial, credencialDeLinea } from '@/lib/whatsapp/lineas';
import { enviarPlantilla } from '@/lib/whatsapp/meta';
import {
  PLANTILLA_CONFIRMACION,
  asegurarPlantillaConfirmacion,
  diaLegible,
  horaLegible,
  telefonoE164,
  textoConfirmacion,
} from '@/lib/whatsapp/confirmacion-citas';

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
 * Un asesor desactivado no recibe franjas de hoy en adelante: el agente
 * comercial las ofrecería a los clientes. Las pasadas se pueden seguir editando.
 */
async function asesorInactivoEnFuturo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  asesorId: string,
  fecha: string
) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  if (fecha < hoy) return false;
  const { data } = await supabase
    .from('usuarios')
    .select('activo')
    .eq('id', asesorId)
    .maybeSingle();
  return data?.activo === false;
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

    if (await asesorInactivoEnFuturo(supabase, data.asesor_id, data.fecha)) {
      return { success: false, error: 'Ese asesor está inactivo. Elige otro asesor.' };
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

    if (await asesorInactivoEnFuturo(supabase, data.asesor_id, data.fecha)) {
      return { success: false, error: 'Ese asesor está inactivo. Elige otro asesor.' };
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

/**
 * Confirma las citas seleccionadas mandándole a cada cliente la plantilla
 * de confirmación por la línea comercial (lib/whatsapp/confirmacion-citas).
 * Desde el 26 oct 2026 no pasa por n8n ni por Kommo.
 *
 * Una cita queda confirmada solo si Meta acepta el mensaje; las demás
 * quedan con su motivo en /citas y su tarea abierta, para confirmarla a
 * mano. El mensaje se guarda en la conversación del cliente (la ve el CRM
 * y su respuesta cae en el mismo hilo) y NO calla al bot: es un aviso
 * automático, no un asesor tomando la conversación.
 */
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
        id, inmobiliaria_id, fecha, hora_inicio, hora_fin, cliente_nombre, cliente_telefono,
        inmuebles ( titulo, direccion ),
        franjas_horarias ( usuarios!franjas_horarias_asesor_id_fkey ( nombre_completo, telefono ) )
      `)
      .in('id', citaIds)
      .eq('estado', 'agendada');

    if (!citas || citas.length === 0) {
      return { success: false, error: 'No se encontraron las citas seleccionadas.' };
    }

    // ── La línea comercial de la inmobiliaria y su token ───────────────
    // El token vive en Vault y solo lo lee el service_role: por eso este
    // tramo usa el cliente de administración. Nada del token sale de aquí.
    const admin = createAdminClient();
    const inmobiliariaId = (citas[0] as any).inmobiliaria_id as string;
    const { data: lineaComercial } = await admin
      .schema('crm')
      .from('lineas')
      .select('wa_phone_number_id')
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('embudo', 'comercial')
      .eq('activa', true)
      .maybeSingle();
    const numeroSalida = lineaComercial?.wa_phone_number_id as string | undefined;
    const credencial = numeroSalida ? await credencialDeLinea(admin, numeroSalida) : null;
    if (!numeroSalida || !credencial) {
      return {
        success: false,
        error: 'La línea comercial de WhatsApp no está conectada. Conéctala en WhatsApp antes de confirmar citas.',
      };
    }

    // ── La plantilla: aprobada, o se manda a revisión la primera vez ───
    const plantilla = await asegurarPlantillaConfirmacion(credencial);
    if (plantilla.estado !== 'aprobada') {
      const motivo = {
        enviada_a_revision:
          'La plantilla de confirmación se acaba de mandar a revisión de Meta. Suele aprobarse en minutos u horas: vuelve a intentarlo más tarde. Mientras tanto, confirma estas citas a mano.',
        en_revision:
          'La plantilla de confirmación sigue en revisión de Meta. Vuelve a intentarlo más tarde; mientras tanto, confirma estas citas a mano.',
        rechazada: `Meta rechazó la plantilla de confirmación${plantilla.estado === 'rechazada' && plantilla.motivo ? ` (${plantilla.motivo})` : ''}. Hay que ajustar su texto.`,
        error: `No se pudo revisar la plantilla de confirmación: ${plantilla.estado === 'error' ? plantilla.mensaje : ''}`,
      }[plantilla.estado];
      return { success: false, error: motivo };
    }

    const confirmadas: string[] = [];
    const fallidas: { cita_id: string; cliente: string; motivo: string }[] = [];
    // Fallo de RED: no se sabe si el mensaje salió. No se marca ni como
    // confirmada ni como fallida: decir cualquiera de las dos sería adivinar,
    // y reintentarla podría mandarle dos mensajes al cliente.
    const sinRespuesta: { cita_id: string; cliente: string }[] = [];

    // Uno por uno: son pocas por tanda y así cada fallo queda con su motivo.
    for (const c of citas as any[]) {
      const cliente = c.cliente_nombre || 'Cliente';
      const telefono = telefonoE164(c.cliente_telefono);
      if (!telefono) {
        fallidas.push({
          cita_id: c.id,
          cliente,
          motivo: `El teléfono «${c.cliente_telefono || 'vacío'}» no es un número de WhatsApp válido.`,
        });
        continue;
      }

      const asesorNombre = c.franjas_horarias?.usuarios?.nombre_completo?.trim();
      const asesorTelefono = c.franjas_horarias?.usuarios?.telefono?.trim();
      const variables = {
        inmueble: c.inmuebles?.titulo?.trim() || 'el inmueble',
        dia: diaLegible(c.fecha),
        hora: horaLegible(c.hora_inicio ?? ''),
        // Meta no acepta variables vacías.
        direccion: c.inmuebles?.direccion?.trim() || 'te la compartimos por este medio',
        asesor: asesorNombre
          ? asesorTelefono
            ? `${asesorNombre} (${asesorTelefono})`
            : asesorNombre
          : 'nuestro equipo',
      };

      const r = await enviarPlantilla(
        telefono,
        PLANTILLA_CONFIRMACION.nombreMeta,
        PLANTILLA_CONFIRMACION.idioma,
        variables,
        credencial
      );
      await anotarResultadoCredencial(admin, credencial.phoneNumberId, r);

      if (!r.ok) {
        if (r.codigo) fallidas.push({ cita_id: c.id, cliente, motivo: r.error || 'WhatsApp rechazó el mensaje.' });
        else sinRespuesta.push({ cita_id: c.id, cliente });
        continue;
      }
      confirmadas.push(c.id);

      // En la conversación del cliente, para que se vea en el CRM y su
      // respuesta caiga en el mismo hilo. Si no se puede guardar, el
      // mensaje igual salió: se anota y se sigue.
      const conversacionId = await conversacionDe(admin, inmobiliariaId, telefono);
      if (conversacionId) {
        const { error } = await admin.from('agente_comercial_mensajes').insert({
          conversacion_id: conversacionId,
          rol: 'asesor',
          contenido: textoConfirmacion(variables),
          wa_message_id: r.waMessageId,
          wa_phone_number_id: credencial.phoneNumberId,
        });
        if (error) console.error('[Citas] Confirmación enviada pero no registrada:', error.message);
      } else {
        console.error('[Citas] Confirmación enviada, pero no se pudo crear la conversación de', c.id);
      }
    }

    const ahora = new Date().toISOString();

    // Best-effort: si una marca falla, el envío al flujo ya ocurrió y solo se
    // pierde la insignia.
    if (confirmadas.length > 0) {
      const { error: markErr } = await supabase
        .from('citas')
        .update({
          confirmada_at: ahora,
          confirmada_por: user.id,
          confirmacion_error: null,
          confirmacion_fallida_at: null,
        })
        .in('id', confirmadas);
      if (markErr) {
        console.warn('[Citas] Confirmaciones enviadas pero no se pudieron marcar:', markErr.message);
      }

      // Cerrar la tarea "Confirmar cita" que el agente creó al agendarla —
      // SOLO de las que de verdad se confirmaron (mismo patrón que
      // completarTareaSolicitud en solicitudes.ts).
      const { error: tareaErr } = await supabase
        .from('tareas')
        .update({ estado: 'completada', completada_at: ahora, completada_por: user.id })
        .in('entidad_id', confirmadas)
        .eq('evento_origen', 'cita_agendada')
        .eq('estado', 'pendiente');
      if (tareaErr) {
        console.warn('[Citas] No se pudieron completar las tareas de confirmación:', tareaErr.message);
      }
    }

    for (const f of fallidas) {
      const { error: falloErr } = await supabase
        .from('citas')
        .update({ confirmacion_error: f.motivo, confirmacion_fallida_at: ahora })
        .eq('id', f.cita_id);
      if (falloErr) {
        console.warn('[Citas] No se pudo registrar el fallo de confirmación:', falloErr.message);
      }
    }

    revalidatePath('/citas');
    revalidatePath('/tareas');
    return {
      success: true,
      count: citas.length,
      confirmadas: confirmadas.length,
      fallidas,
      sinRespuesta,
    };
  } catch (error: any) {
    console.error('[Citas] Excepción confirmarCitas:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}
