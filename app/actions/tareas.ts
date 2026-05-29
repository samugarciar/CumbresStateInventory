'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Server Action para completar o reactivar una tarea administrativa.
 * Solo ejecutable por usuarios administradores.
 */
export async function completarTarea(tareaId: string, completada: boolean) {
  try {
    const supabase = await createClient();

    // 1. Validar sesión del usuario
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Sesión expirada o no válida.' };
    }

    // 2. Validar rol del usuario (solo admin puede marcar como completada/pendiente)
    const { data: profile, error: profileErr } = await supabase
      .from('usuarios')
      .select('rol, inmobiliaria_id')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile || profile.rol !== 'admin') {
      return { success: false, error: 'Acceso denegado. Se requieren permisos de administrador.' };
    }

    // 3. Actualizar la tarea en base de datos
    const { error: updateErr } = await supabase
      .from('tareas')
      .update({
        estado: completada ? 'completada' : 'pendiente',
        completada_at: completada ? new Date().toISOString() : null,
        completada_por: completada ? user.id : null
      })
      .eq('id', tareaId)
      .eq('inmobiliaria_id', profile.inmobiliaria_id);

    if (updateErr) {
      console.error('Error al actualizar tarea:', updateErr);
      return { success: false, error: 'No se pudo actualizar el estado de la tarea.' };
    }

    // 4. Revalidar rutas para refrescar los datos en tiempo real
    revalidatePath('/tareas');
    revalidatePath('/dashboard');

    return { success: true };
  } catch (error: any) {
    console.error('Excepción en completarTarea:', error);
    return { success: false, error: error.message || 'Error interno del servidor.' };
  }
}

/**
 * Server Action para completar múltiples tareas a la vez.
 */
export async function completarTareasMultiples(tareaIds: string[]) {
  try {
    if (!tareaIds || tareaIds.length === 0) return { success: true };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Sesión expirada o no válida.' };

    const { data: profile } = await supabase
      .from('usuarios')
      .select('rol, inmobiliaria_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.rol !== 'admin') {
      return { success: false, error: 'Acceso denegado.' };
    }

    const { error: updateErr } = await supabase
      .from('tareas')
      .update({
        estado: 'completada',
        completada_at: new Date().toISOString(),
        completada_por: user.id
      })
      .in('id', tareaIds)
      .eq('inmobiliaria_id', profile.inmobiliaria_id);

    if (updateErr) {
      console.error('Error al actualizar tareas múltiples:', updateErr);
      return { success: false, error: 'No se pudieron actualizar las tareas.' };
    }

    revalidatePath('/tareas');
    revalidatePath('/dashboard');

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Error interno.' };
  }
}
