'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getNubyConfig, obtenerTokenJWT } from '@/lib/nuby';

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
  if (!['disponible', 'arrendado', 'inactivo'].includes(nuevoEstado)) {
    return { success: false, error: 'Estado no válido.' };
  }

  const supabase = await createClient();

  // 1. Consultar el estado actual del inmueble para validar reglas de negocio
  const { data: inmueble, error: getErr } = await supabase
    .from('inmuebles')
    .select('estado, arrendasoft_id, inmobiliaria_id, titulo, asesor_id, direccion')
    .eq('id', inmuebleId)
    .single();

  if (getErr || !inmueble) {
    return { success: false, error: 'No se encontró el inmueble a actualizar.' };
  }

  // REGLA: Si el inmueble está arrendado, no se permite ninguna modificación manual de estado
  if (inmueble.estado === 'arrendado') {
    return { 
      success: false, 
      error: 'El inmueble está arrendado. Este estado representa un lazo legal/contable y solo puede modificarse desde Arrendasoft ERP.' 
    };
  }

  // REGLA: No se permite cambiar el estado a 'arrendado' de forma manual
  if (nuevoEstado === 'arrendado') {
    return { 
      success: false, 
      error: 'No se puede cambiar el estado a Arrendado de forma manual. Este estado se sincroniza automáticamente desde el ERP.' 
    };
  }

  // 2. Si el nuevo estado es 'inactivo', y el inmueble proviene del ERP, actualizar en Arrendasoft
  if (nuevoEstado === 'inactivo' && inmueble.arrendasoft_id) {
    const config = getNubyConfig();
    let token = '';

    try {
      token = await obtenerTokenJWT(config);
    } catch (authErr: any) {
      console.warn("Falla de autenticación en actualización de Nuby:", authErr.message);
    }

    const putUrl = `https://${config.instancia}/service/v2/public/properties/${inmueble.arrendasoft_id}/status`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      console.log(`Sincronizando estado inactivo en Nuby: PATCH ${putUrl}`);
      const res = await fetch(putUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ 
          estado: 2,
          status: 2
        }), // 2 = Inactivo en Arrendasoft/Nuby
        cache: 'no-store'
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { 
          success: false, 
          error: `Error al sincronizar estado inactivo con Arrendasoft ERP (${res.status}): ${errorText}` 
        };
      }
    } catch (apiErr: any) {
      console.error("Error al llamar a la API de Nuby:", apiErr);
      return { 
        success: false, 
        error: `Falla de conexión con Arrendasoft ERP: ${apiErr.message}` 
      };
    }
  }

  // 3. Ejecutar la actualización en base de datos local
  const { error } = await supabase
    .from('inmuebles')
    .update({ estado: nuevoEstado })
    .eq('id', inmuebleId);

  if (error) {
    return { success: false, error: error.message };
  }

  // Si cambia de disponible (activo) a inactivo, crear la tarea "Bajar de facebook" automáticamente
  if (inmueble.estado === 'disponible' && nuevoEstado === 'inactivo') {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from('tareas')
      .insert({
        inmobiliaria_id: inmueble.inmobiliaria_id,
        usuario_id: inmueble.asesor_id || user?.id || null,
        entidad_tipo: 'inmueble',
        entidad_id: inmuebleId,
        evento_origen: 'inmueble_desactivado',
        evento_titulo: inmueble.direccion || inmueble.titulo,
        titulo: 'Bajar de facebook',
        estado: 'pendiente'
      });
  }

  revalidatePath('/inmuebles');
  revalidatePath('/dashboard');
  revalidatePath('/tareas');
  return { success: true, message: 'Estado actualizado correctamente.' };
}
