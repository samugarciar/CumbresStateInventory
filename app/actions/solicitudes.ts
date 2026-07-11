'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

interface AprobarData {
  solicitud_id: string;
  asesor_id: string; // asesor al que se le crea la franja
}

interface DenegarData {
  solicitud_id: string;
  motivo?: string | null;
}

// Payload del webhook de veredicto (contrato acordado con el admin del agente n8n)
interface VeredictoPayload {
  solicitud_id: string;
  resultado: 'aprobada' | 'denegada';
  cliente_nombre: string;
  cliente_telefono: string;
  inmueble: string;
  direccion: string;
  alcance: string;
  tipo_transaccion: string | null;
  unidad: string | null;
  aptos_count: number | null;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  asesor: string | null;
  telefono_asesor: string | null;
  cita_id: string | null;
  motivo: string | null;
}

// Dispara el webhook n8n del veredicto (Header Auth, mismo patrón que confirmarCitas).
// La decisión ya quedó guardada: si el webhook falla o no está configurado,
// devolvemos un aviso pero NO revertimos nada.
async function enviarVeredicto(payload: VeredictoPayload): Promise<{ enviado: boolean; aviso?: string }> {
  const url = process.env.N8N_APERTURA_VEREDICTO_URL;
  const token = process.env.N8N_APERTURA_VEREDICTO_TOKEN;

  if (!url || !token) {
    console.warn('[Solicitudes] Webhook de veredicto sin configurar (N8N_APERTURA_VEREDICTO_URL/TOKEN).');
    return { enviado: false, aviso: 'Decisión guardada, pero el veredicto NO se envió al cliente: el webhook de n8n no está configurado.' };
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Token': token,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error('[Solicitudes] El webhook de veredicto respondió', resp.status);
      return { enviado: false, aviso: `Decisión guardada, pero el webhook de veredicto respondió con error (${resp.status}).` };
    }
    // El workflow responde 200 SIEMPRE, con body [{ estado: 'ok' | 'error', mensaje?, ... }].
    // estado != 'ok' = el flujo corrió pero no entregó el veredicto (ej. el teléfono no
    // corresponde a ningún lead en Kommo) y manda un correo de alerta a la inmobiliaria.
    try {
      const body = await resp.json();
      const r = Array.isArray(body) ? body[0] : body;
      if (r && typeof r.estado === 'string' && r.estado !== 'ok') {
        console.warn('[Solicitudes] El flujo de veredicto reportó estado:', r.estado, r.mensaje);
        return {
          enviado: true,
          aviso: `n8n recibió el veredicto pero reportó "${r.estado}"${r.mensaje ? `: ${r.mensaje}` : ''}. Revisa el correo de alerta.`,
        };
      }
    } catch { /* body vacío o no-JSON: lo tratamos como entregado */ }
    return { enviado: true };
  } catch (e: any) {
    console.error('[Solicitudes] Error de red al enviar el veredicto:', e?.message);
    return { enviado: false, aviso: 'Decisión guardada, pero no se pudo contactar el webhook de veredicto (error de red).' };
  }
}

// Fecha de hoy en Bogotá (el servidor de Vercel corre en UTC)
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

// Completa la tarea automática creada por solicitar_apertura_agenda para esta
// solicitud (evento_origen='solicitud_apertura', entidad_id=solicitud). Best-effort:
// si falla, la decisión ya quedó guardada y la tarea se puede completar a mano.
async function completarTareaSolicitud(supabase: any, solicitudId: string, userId: string) {
  const { error } = await supabase
    .from('tareas')
    .update({
      estado: 'completada',
      completada_at: new Date().toISOString(),
      completada_por: userId,
    })
    .eq('entidad_id', solicitudId)
    .eq('evento_origen', 'solicitud_apertura')
    .eq('estado', 'pendiente');
  if (error) {
    console.warn('[Solicitudes] No se pudo completar la tarea de la solicitud:', error.message);
  }
}

/**
 * Aprueba una solicitud de apertura: crea la franja para el asesor elegido,
 * agenda la cita de una vez (respetando alcance inmueble/unidad) y dispara el
 * webhook de veredicto hacia n8n → WhatsApp del cliente. Solo admins.
 */
export async function aprobarSolicitud(data: AprobarData) {
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
      return { success: false, error: 'Solo los administradores pueden aprobar solicitudes.' };
    }

    // Solicitud pendiente de la inmobiliaria del admin (el RLS ya la acota)
    const { data: solicitud } = await supabase
      .from('solicitudes_apertura')
      .select(`
        id, inmobiliaria_id, inmueble_id, alcance, unidad, tipo_transaccion,
        fecha, hora_inicio, hora_fin,
        cliente_nombre, cliente_telefono, cliente_email, notas, estado,
        inmuebles ( titulo, direccion )
      `)
      .eq('id', data.solicitud_id)
      .single();

    if (!solicitud || solicitud.inmobiliaria_id !== profile.inmobiliaria_id) {
      return { success: false, error: 'Solicitud no encontrada.' };
    }
    if (solicitud.estado !== 'pendiente') {
      return { success: false, error: 'Esta solicitud ya fue decidida.' };
    }
    if (solicitud.fecha < hoyBogota()) {
      return { success: false, error: 'El horario solicitado ya pasó. Deniégala (el cliente recibirá el aviso) o espera una solicitud nueva.' };
    }

    // Asesor de la franja nueva
    const { data: asesor } = await supabase
      .from('usuarios')
      .select('id, nombre_completo, telefono')
      .eq('id', data.asesor_id)
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .single();

    if (!asesor) {
      return { success: false, error: 'Selecciona un asesor válido.' };
    }

    // Misma regla que crearFranjaHoraria: el asesor no puede tener franjas solapadas
    const { data: overlaps } = await supabase
      .from('franjas_horarias')
      .select('id')
      .eq('asesor_id', asesor.id)
      .eq('fecha', solicitud.fecha)
      .lt('hora_inicio', solicitud.hora_fin)
      .gt('hora_fin', solicitud.hora_inicio);

    if (overlaps && overlaps.length > 0) {
      return { success: false, error: `${asesor.nombre_completo.split(' ')[0]} ya tiene una franja en ese horario. Elige otro asesor.` };
    }

    // 1) Crear la franja (cubre automáticamente a los hermanos de ubicación)
    const { data: franja, error: franjaError } = await supabase
      .from('franjas_horarias')
      .insert({
        inmobiliaria_id: profile.inmobiliaria_id,
        inmueble_id: solicitud.inmueble_id,
        asesor_id: asesor.id,
        fecha: solicitud.fecha,
        hora_inicio: solicitud.hora_inicio,
        hora_fin: solicitud.hora_fin,
        color: '#00abd8',
        creado_por: user.id,
      })
      .select('id')
      .single();

    if (franjaError || !franja) {
      console.error('[Solicitudes] Error al crear la franja:', franjaError?.message);
      return { success: false, error: 'No se pudo crear la franja horaria.' };
    }

    // 2) Snapshot de aptos (solo alcance=unidad): disponibles de la misma unidad+tipo
    let snapshot: any[] | null = null;
    if (solicitud.alcance === 'unidad' && solicitud.unidad) {
      let query = supabase
        .from('inmuebles')
        .select('id, titulo, precio, habitaciones, banos')
        .eq('inmobiliaria_id', profile.inmobiliaria_id)
        .eq('estado', 'disponible')
        .ilike('unidad', solicitud.unidad.trim())
        .order('precio');
      if (solicitud.tipo_transaccion) {
        query = query.eq('tipo_transaccion', solicitud.tipo_transaccion);
      }
      const { data: aptos } = await query;
      snapshot = (aptos || []).map(a => ({
        inmueble_id: a.id, titulo: a.titulo, precio: a.precio,
        habitaciones: a.habitaciones, banos: a.banos,
      }));
    }

    // 3) Agendar la cita vía la RPC (re-valida todo y captura alcance/unidad/snapshot)
    const rpcParams: Record<string, any> = {
      p_inmueble_id: solicitud.inmueble_id,
      p_fecha: solicitud.fecha,
      p_hora_inicio: solicitud.hora_inicio,
      p_hora_fin: solicitud.hora_fin,
      p_cliente_nombre: solicitud.cliente_nombre,
      p_cliente_telefono: solicitud.cliente_telefono,
      p_cliente_email: solicitud.cliente_email,
      p_notas: solicitud.notas,
    };
    if (solicitud.alcance === 'unidad') {
      rpcParams.p_alcance = 'unidad';
      rpcParams.p_unidad = solicitud.unidad;
      rpcParams.p_aptos_snapshot = snapshot;
    }

    const { data: cita, error: citaError } = await supabase.rpc('agendar_cita', rpcParams);

    if (citaError || !cita?.success) {
      // Compensación: la franja recién creada queda huérfana → borrarla
      await supabase.from('franjas_horarias').delete().eq('id', franja.id);
      const msg = citaError?.message || cita?.error || 'No se pudo agendar la cita.';
      console.error('[Solicitudes] Error al agendar la cita de la solicitud:', msg);
      return { success: false, error: msg };
    }

    // 4) Marcar la solicitud como aprobada
    const { error: updError } = await supabase
      .from('solicitudes_apertura')
      .update({
        estado: 'aprobada',
        cita_id: cita.cita_id,
        decidido_por: user.id,
        decidido_at: new Date().toISOString(),
      })
      .eq('id', solicitud.id)
      .eq('estado', 'pendiente');

    if (updError) {
      console.error('[Solicitudes] Cita creada pero no se pudo marcar la solicitud:', updError.message);
      return { success: false, error: 'La franja y la cita se crearon, pero la solicitud no se pudo marcar como aprobada. Recarga la página.' };
    }

    // Completar la tarea automática de esta solicitud en /tareas (best-effort)
    await completarTareaSolicitud(supabase, solicitud.id, user.id);

    // 5) Veredicto al cliente vía n8n (fire-and-forget; la decisión ya está guardada)
    const inmueble = (solicitud as any).inmuebles;
    const { enviado, aviso } = await enviarVeredicto({
      solicitud_id: solicitud.id,
      resultado: 'aprobada',
      cliente_nombre: solicitud.cliente_nombre,
      cliente_telefono: solicitud.cliente_telefono,
      inmueble: solicitud.alcance === 'unidad' ? (solicitud.unidad || '') : (inmueble?.titulo || ''),
      direccion: inmueble?.direccion || '',
      alcance: solicitud.alcance,
      tipo_transaccion: solicitud.tipo_transaccion,
      unidad: solicitud.unidad,
      aptos_count: snapshot ? snapshot.length : null,
      fecha: solicitud.fecha,
      hora_inicio: solicitud.hora_inicio.substring(0, 5),
      hora_fin: solicitud.hora_fin.substring(0, 5),
      asesor: asesor.nombre_completo,
      telefono_asesor: asesor.telefono || null,
      cita_id: cita.cita_id,
      motivo: null,
    });

    revalidatePath('/citas');
    revalidatePath('/agenda');
    revalidatePath('/tareas');
    revalidatePath('/dashboard');
    return {
      success: true,
      webhookEnviado: enviado,
      message: `Franja creada y cita agendada para ${solicitud.cliente_nombre}.${aviso ? ` ⚠️ ${aviso}` : ' El cliente recibirá la confirmación por WhatsApp.'}`,
    };
  } catch (error: any) {
    console.error('[Solicitudes] Excepción aprobarSolicitud:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}

/**
 * Deniega una solicitud de apertura (motivo opcional) y dispara el webhook de
 * veredicto para avisarle al cliente por WhatsApp. Solo admins.
 */
export async function denegarSolicitud(data: DenegarData) {
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
      return { success: false, error: 'Solo los administradores pueden denegar solicitudes.' };
    }

    const { data: solicitud } = await supabase
      .from('solicitudes_apertura')
      .select(`
        id, inmobiliaria_id, alcance, unidad, tipo_transaccion,
        fecha, hora_inicio, hora_fin,
        cliente_nombre, cliente_telefono, estado,
        inmuebles ( titulo, direccion )
      `)
      .eq('id', data.solicitud_id)
      .single();

    if (!solicitud || solicitud.inmobiliaria_id !== profile.inmobiliaria_id) {
      return { success: false, error: 'Solicitud no encontrada.' };
    }
    if (solicitud.estado !== 'pendiente') {
      return { success: false, error: 'Esta solicitud ya fue decidida.' };
    }

    const motivo = (data.motivo || '').trim() || null;

    const { error: updError } = await supabase
      .from('solicitudes_apertura')
      .update({
        estado: 'denegada',
        motivo_denegacion: motivo,
        decidido_por: user.id,
        decidido_at: new Date().toISOString(),
      })
      .eq('id', solicitud.id)
      .eq('estado', 'pendiente');

    if (updError) {
      console.error('[Solicitudes] Error al denegar:', updError.message);
      return { success: false, error: 'No se pudo denegar la solicitud.' };
    }

    // Completar la tarea automática de esta solicitud en /tareas (best-effort)
    await completarTareaSolicitud(supabase, solicitud.id, user.id);

    const inmueble = (solicitud as any).inmuebles;
    const { enviado, aviso } = await enviarVeredicto({
      solicitud_id: solicitud.id,
      resultado: 'denegada',
      cliente_nombre: solicitud.cliente_nombre,
      cliente_telefono: solicitud.cliente_telefono,
      inmueble: solicitud.alcance === 'unidad' ? (solicitud.unidad || '') : (inmueble?.titulo || ''),
      direccion: inmueble?.direccion || '',
      alcance: solicitud.alcance,
      tipo_transaccion: solicitud.tipo_transaccion,
      unidad: solicitud.unidad,
      aptos_count: null,
      fecha: solicitud.fecha,
      hora_inicio: solicitud.hora_inicio.substring(0, 5),
      hora_fin: solicitud.hora_fin.substring(0, 5),
      asesor: null,
      telefono_asesor: null,
      cita_id: null,
      motivo,
    });

    revalidatePath('/citas');
    revalidatePath('/tareas');
    revalidatePath('/dashboard');
    return {
      success: true,
      webhookEnviado: enviado,
      message: `Solicitud denegada.${aviso ? ` ⚠️ ${aviso}` : ' El cliente recibirá el aviso por WhatsApp.'}`,
    };
  } catch (error: any) {
    console.error('[Solicitudes] Excepción denegarSolicitud:', error);
    return { success: false, error: error.message || 'Error interno.' };
  }
}
