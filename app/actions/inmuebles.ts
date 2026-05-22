'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function registrarInmueble(prevState: any, formData: FormData) {
  const titulo = formData.get('titulo') as string;
  const descripcion = formData.get('descripcion') as string;
  const direccion = formData.get('direccion') as string;
  const precioRaw = formData.get('precio') as string;
  const tipoTransaccion = formData.get('tipoTransaccion') as string;
  const tipoInmueble = formData.get('tipoInmueble') as string;
  const estado = (formData.get('estado') as string) || 'disponible';
  let asesorId = formData.get('asesorId') as string || null;

  if (!titulo || !direccion || !precioRaw || !tipoTransaccion || !tipoInmueble) {
    return { success: false, error: 'Por favor, completa todos los campos obligatorios.' };
  }

  const precio = Number(precioRaw);
  if (isNaN(precio) || precio < 0) {
    return { success: false, error: 'El precio debe ser un número válido mayor o igual a 0.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión de usuario no válida.' };

  // Obtener perfil para forzar inmobiliaria_id y control de roles
  const { data: profile, error: profileErr } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return { success: false, error: 'No se pudo verificar el perfil del usuario.' };
  }

  // Si es un asesor, forzar que el inmueble se le asigne a sí mismo
  if (profile.rol === 'asesor') {
    asesorId = user.id;
  }

  const { error } = await supabase
    .from('inmuebles')
    .insert({
      inmobiliaria_id: profile.inmobiliaria_id,
      asesor_id: asesorId || null,
      titulo,
      descripcion: descripcion || '',
      direccion,
      precio,
      tipo_transaccion: tipoTransaccion,
      tipo_inmueble: tipoInmueble,
      estado,
    });

  if (error) {
    return { success: false, error: `Error de base de datos: ${error.message}` };
  }

  revalidatePath('/inmuebles');
  revalidatePath('/dashboard');
  return { success: true, message: 'Inmueble registrado exitosamente.' };
}

export async function actualizarEstadoInmueble(inmuebleId: string, nuevoEstado: string) {
  if (!['disponible', 'reservado', 'vendido', 'arrendado'].includes(nuevoEstado)) {
    return { success: false, error: 'Estado no válido.' };
  }

  const supabase = await createClient();
  
  const { error } = await supabase
    .from('inmuebles')
    .update({ estado: nuevoEstado })
    .eq('id', inmuebleId);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/inmuebles');
  revalidatePath('/dashboard');
  return { success: true, message: 'Estado actualizado correctamente.' };
}
