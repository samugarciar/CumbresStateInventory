'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth-helpers';
import { revalidatePath } from 'next/cache';

import { procesarAnuncios } from '@/lib/agente-captaciones/procesar';
import { DIAS_PRIMER_SEGUIMIENTO } from '@/lib/agente-captaciones/config';

// Estados del pipeline a los que se puede mover un prospecto desde la bandeja.
export type EstadoProspecto =
  | 'nuevo' | 'calificado' | 'por_aprobar' | 'contactado'
  | 'en_conversacion' | 'cita' | 'captado' | 'descartado';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') return null;
  return user;
}

// Captaciones es un módulo de administración: todas las acciones exigen admin.

// Fecha en Bogotá (el servidor de Vercel corre en UTC). Colombia es UTC-5 fijo.
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function fechaBogotaMasDias(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(
    new Date(Date.now() + dias * 864e5)
  );
}

/**
 * Agrega un anuncio a la bandeja: lo enriquece (si es de Mercado Libre), lo
 * pasa por el grafo (calificar → dedupe → redactar) y lo deja en 'por_aprobar'.
 * NO contacta a nadie.
 */
export async function agregarProspecto(datos: {
  url?: string;
  texto?: string;
  contacto_telefono?: string;
  contacto_nombre?: string;
}) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden captar prospectos.' };

  const url = datos.url?.trim();
  const texto = datos.texto?.trim();
  if (!url && !texto) {
    return { success: false as const, error: 'Pega la URL del anuncio o el texto de la publicación.' };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { success: false as const, error: 'Falta configurar OPENAI_API_KEY.' };
  }

  const inmobiliariaId = user.profile.inmobiliaria_id;
  const supabase = createAdminClient();

  // Kill switch: sin fila = activo (mismo criterio que el resto de agentes)
  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();
  if (config && !config.activo) {
    return { success: false as const, error: 'El agente de captaciones está pausado. Actívalo en Agentes.' };
  }

  // Misma tubería que el intake por correo y por lote (enriquecer + calificar +
  // dedupe + redactar), para no tener tres implementaciones distintas.
  try {
    const resumen = await procesarAnuncios(supabase, inmobiliariaId, [
      {
        url: url ?? null,
        titulo: texto ? texto.slice(0, 120) : (url ?? ''),
        descripcion: texto ?? null,
        contacto_telefono: datos.contacto_telefono?.trim() || null,
        contacto_nombre: datos.contacto_nombre?.trim() || null,
      },
    ]);
    revalidatePath('/captaciones');

    const item = resumen.detalle[0];
    const mensajes: Record<string, string> = {
      creado: 'Prospecto calificado y listo para aprobar.',
      duplicado: 'Ese anuncio ya estaba en la bandeja.',
      descartado: `Descartado: ${item?.motivo ?? 'no cumple el criterio de captación.'}`,
    };
    if (!item || item.resultado === 'error') {
      return { success: false as const, error: item?.motivo ?? 'No se pudo procesar el anuncio.' };
    }
    return { success: true as const, resultado: item.resultado, message: mensajes[item.resultado] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Captaciones] Error agregando prospecto:', msg);
    return { success: false as const, error: msg };
  }
}

/**
 * Aprueba el contacto: guarda el mensaje final (editado o no), marca el
 * prospecto como 'contactado' y programa el primer seguimiento.
 * El ENVÍO lo hace el humano (la UI abre WhatsApp con el mensaje listo).
 */
export async function aprobarContacto(datos: { prospecto_id: string; mensaje_final: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden aprobar contactos.' };

  const mensaje = datos.mensaje_final?.trim();
  if (!mensaje) return { success: false as const, error: 'El mensaje no puede quedar vacío.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      mensaje_borrador: mensaje,
      estado: 'contactado',
      fecha_contacto: hoyBogota(),
      proximo_seguimiento: fechaBogotaMasDias(DIAS_PRIMER_SEGUIMIENTO),
      asesor_id: user.profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    .eq('estado', 'por_aprobar');

  if (error) {
    console.error('[Captaciones] Error aprobando contacto:', error.message);
    return { success: false as const, error: 'No se pudo marcar como contactado.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Marcado como contactado. Seguimiento programado.' };
}

/** Descarta un prospecto (no se contacta). */
export async function rechazarProspecto(datos: { prospecto_id: string; motivo?: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden descartar prospectos.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      estado: 'descartado',
      notas: datos.motivo?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error descartando:', error.message);
    return { success: false as const, error: 'No se pudo descartar el prospecto.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Prospecto descartado.' };
}

/** Mueve un prospecto por el pipeline (en conversación, cita, captado...). */
export async function cambiarEstadoProspecto(datos: { prospecto_id: string; estado: EstadoProspecto }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden mover prospectos.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({ estado: datos.estado, updated_at: new Date().toISOString() })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error cambiando estado:', error.message);
    return { success: false as const, error: 'No se pudo actualizar el estado.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Estado actualizado.' };
}

/** Registra un seguimiento hecho y reprograma el siguiente. */
export async function registrarSeguimiento(datos: { prospecto_id: string; dias?: number }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden registrar seguimientos.' };

  const supabase = createAdminClient();
  const { data: actual } = await supabase
    .from('captacion_prospectos')
    .select('n_seguimientos')
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    .maybeSingle();

  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      n_seguimientos: (actual?.n_seguimientos ?? 0) + 1,
      proximo_seguimiento: fechaBogotaMasDias(datos.dias ?? DIAS_PRIMER_SEGUIMIENTO),
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error registrando seguimiento:', error.message);
    return { success: false as const, error: 'No se pudo registrar el seguimiento.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Seguimiento registrado.' };
}
