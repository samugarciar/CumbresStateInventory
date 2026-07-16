'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { revalidatePath } from 'next/cache';
import type { Turno } from '@/lib/bi/parte';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') {
    return null;
  }
  return user;
}

/**
 * Lista las conversaciones del asesor BI del usuario actual (RLS ya las
 * acota a las propias), más recientes primero.
 */
export async function listarConversaciones() {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Acceso denegado.' as const, data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bi_conversaciones')
    .select('id, titulo, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[Inteligencia] Error al listar conversaciones:', error.message);
    return { success: false, error: 'No se pudieron cargar las conversaciones.' as const, data: [] };
  }
  return { success: true as const, data: data || [] };
}

/**
 * Carga una conversación completa (turnos listos para hidratar el chat).
 */
export async function cargarConversacion(id: string) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Acceso denegado.' as const };

  const supabase = await createClient();
  const { data: conversacion } = await supabase
    .from('bi_conversaciones')
    .select('id, titulo')
    .eq('id', id)
    .single();

  if (!conversacion) return { success: false, error: 'Conversación no encontrada.' as const };

  const { data: mensajes, error } = await supabase
    .from('bi_mensajes')
    .select('rol, contenido')
    .eq('conversacion_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Inteligencia] Error al cargar mensajes:', error.message);
    return { success: false, error: 'No se pudo cargar la conversación.' as const };
  }

  const turnos: Turno[] = (mensajes || []).map((m) => ({
    rol: m.rol as 'usuario' | 'asesor',
    partes: Array.isArray(m.contenido) ? m.contenido : [],
  }));

  return { success: true as const, data: { id: conversacion.id, titulo: conversacion.titulo, turnos } };
}

/**
 * Elimina una conversación (RLS: solo la del propio usuario). Los informes
 * que haya generado NO se borran (conversacion_id queda en NULL) porque un
 * informe guardado tiene valor independiente del chat que lo originó.
 */
export async function eliminarConversacion(id: string) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Acceso denegado.' as const };

  const supabase = await createClient();
  const { error } = await supabase.from('bi_conversaciones').delete().eq('id', id);

  if (error) {
    console.error('[Inteligencia] Error al eliminar conversación:', error.message);
    return { success: false, error: 'No se pudo eliminar la conversación.' as const };
  }

  revalidatePath('/inteligencia');
  return { success: true as const };
}

/**
 * Lista los informes/briefs guardados por cualquier admin de la inmobiliaria
 * (RLS: bi_artefactos es compartido, no por usuario). Sin el markdown
 * completo — se pide aparte al abrir uno, para mantener la lista liviana.
 */
export async function listarInformes() {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Acceso denegado.' as const, data: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bi_artefactos')
    .select('id, tipo, titulo, resumen, created_at, conversacion_id, usuarios(nombre_completo)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[Inteligencia] Error al listar informes:', error.message);
    return { success: false, error: 'No se pudieron cargar los informes.' as const, data: [] };
  }
  return { success: true as const, data: data || [] };
}

/** Contenido completo de un informe guardado, para el visor. */
export async function obtenerInforme(id: string) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Acceso denegado.' as const };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bi_artefactos')
    .select('id, tipo, titulo, resumen, contenido_markdown, created_at, conversacion_id, usuarios(nombre_completo)')
    .eq('id', id)
    .single();

  if (error || !data) return { success: false, error: 'Informe no encontrado.' as const };
  return { success: true as const, data };
}

/** Elimina un informe guardado (cualquier admin de la inmobiliaria puede). */
export async function eliminarInforme(id: string) {
  const user = await requireAdmin();
  if (!user) return { success: false, error: 'Acceso denegado.' as const };

  const supabase = await createClient();
  const { error } = await supabase.from('bi_artefactos').delete().eq('id', id);

  if (error) {
    console.error('[Inteligencia] Error al eliminar informe:', error.message);
    return { success: false, error: 'No se pudo eliminar el informe.' as const };
  }

  revalidatePath('/inteligencia');
  return { success: true as const };
}
