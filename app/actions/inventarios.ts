'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function registrarInventario(inmuebleId: string, titulo: string, items: any) {
  if (!inmuebleId || !titulo || !items) {
    return { success: false, error: 'El inmueble, el título y los contenidos son obligatorios.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión de usuario no válida.' };

  // 1. Obtener el inmueble para heredar de forma transparente el arrendasoft_contrato_id
  const { data: inmueble, error: inmErr } = await supabase
    .from('inmuebles')
    .select('arrendasoft_contrato_id, inmobiliaria_id, direccion')
    .eq('id', inmuebleId)
    .single();

  if (inmErr || !inmueble) {
    return { success: false, error: `Error al recuperar datos del inmueble: ${inmErr?.message || 'No encontrado'}` };
  }

  // 2. Insertar inventario con estado pendiente y contrato heredado
  const { data: nuevoInventario, error } = await supabase
    .from('inventarios')
    .insert({
      inmueble_id: inmuebleId,
      titulo,
      items,
      creado_por: user.id,
      estado: 'pendiente', // Por defecto pendiente
      arrendasoft_contrato_id: inmueble.arrendasoft_contrato_id || null, // Mapeo automático de la relación
    })
    .select('id')
    .single();

  if (error || !nuevoInventario) {
    return { success: false, error: `Error de base de datos: ${error?.message}` };
  }

  // 3. Crear tareas automáticas asociadas al inventario sin columnas de ZapSign
  try {
    const { error: taskErr } = await supabase
      .from('tareas')
      .insert([
        {
          inmobiliaria_id: inmueble.inmobiliaria_id,
          usuario_id: user.id, // Asignado al creador del inventario (asesor/admin)
          entidad_tipo: 'inventario',
          entidad_id: nuevoInventario.id,
          evento_origen: 'inventario_creado',
          evento_titulo: titulo,
          titulo: 'Firmar inventario',
          estado: 'pendiente'
        },
        {
          inmobiliaria_id: inmueble.inmobiliaria_id,
          usuario_id: user.id,
          entidad_tipo: 'inventario',
          entidad_id: nuevoInventario.id,
          evento_origen: 'inventario_creado',
          evento_titulo: titulo,
          titulo: 'Asociar contrato al inventario',
          estado: 'pendiente'
        },
        {
          inmobiliaria_id: inmueble.inmobiliaria_id,
          usuario_id: user.id,
          entidad_tipo: 'inventario',
          entidad_id: nuevoInventario.id,
          evento_origen: 'inventario_creado',
          evento_titulo: titulo,
          titulo: 'Firmar contrato',
          estado: 'pendiente'
        }
      ]);

    if (taskErr) {
      console.error('[Biometrics] Error crítico al insertar tareas del inventario:', taskErr.message);
    }
  } catch (err: any) {
    console.error('[Biometrics] Excepción crítica al insertar tareas:', err);
  }

  revalidatePath('/inventarios');
  revalidatePath('/dashboard');
  return { success: true, message: 'El inventario ha sido guardado y las tareas asociadas han sido creadas.' };
}

export async function proponerAsociacionContrato(inventarioId: string, contratoId: string) {
  if (!inventarioId || !contratoId) {
    return { success: false, error: 'Inventario o Contrato ID inválido.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'No autorizado.' };

  const { data: inventario, error: invErr } = await supabase
    .from('inventarios')
    .select('titulo, inmuebles(inmobiliaria_id)')
    .eq('id', inventarioId)
    .single();

  if (invErr || !inventario) {
    return { success: false, error: 'Inventario no encontrado.' };
  }

  const inmobiliariaId = Array.isArray(inventario.inmuebles) 
    ? inventario.inmuebles[0].inmobiliaria_id 
    : (inventario.inmuebles as any).inmobiliaria_id;

  const { error: updateErr } = await supabase
    .from('inventarios')
    .update({ contrato_id_propuesto: contratoId })
    .eq('id', inventarioId);

  if (updateErr) {
    return { success: false, error: 'No se pudo guardar la propuesta de contrato.' };
  }

  const { error: taskErr } = await supabase
    .from('tareas')
    .insert([{
      inmobiliaria_id: inmobiliariaId,
      usuario_id: null, // Asignado a todo admin
      entidad_tipo: 'inventario',
      entidad_id: inventarioId,
      evento_origen: 'asociacion_contrato',
      evento_titulo: inventario.titulo,
      titulo: 'Aceptar asociacion inventario',
      estado: 'pendiente'
    }]);

  if (taskErr) {
    await supabase.from('inventarios').update({ contrato_id_propuesto: null }).eq('id', inventarioId);
    return { success: false, error: 'No se pudo crear la tarea de revisión.' };
  }

  revalidatePath('/inventarios');
  revalidatePath('/dashboard');
  revalidatePath('/tareas');
  return { success: true };
}

export async function resolverAsociacionContrato(tareaId: string, inventarioId: string, propuestoId: string, aprobado: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'No autorizado.' };

  if (aprobado) {
    const { error: invErr } = await supabase
      .from('inventarios')
      .update({ 
        arrendasoft_contrato_id: propuestoId,
        contrato_id_propuesto: null 
      })
      .eq('id', inventarioId);

    if (invErr) return { success: false, error: 'Error al actualizar inventario.' };

    await supabase.from('tareas').update({ 
      estado: 'completada', 
      completada_at: new Date().toISOString(),
      completada_por: user.id
    }).eq('id', tareaId);



  } else {
    const { error: invErr } = await supabase
      .from('inventarios')
      .update({ contrato_id_propuesto: null })
      .eq('id', inventarioId);
    
    if (invErr) return { success: false, error: 'Error al actualizar inventario.' };

    await supabase.from('tareas').update({ 
      estado: 'completada', 
      completada_at: new Date().toISOString(),
      completada_por: user.id
    }).eq('id', tareaId);
  }

  revalidatePath('/inventarios');
  revalidatePath('/dashboard');
  revalidatePath('/tareas');
  return { success: true };
}
