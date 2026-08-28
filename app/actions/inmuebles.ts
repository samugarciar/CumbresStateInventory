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
    .select('estado, arrendasoft_id, inmobiliaria_id, titulo, asesor_id, asesor_id_override, direccion')
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
        usuario_id: inmueble.asesor_id_override || inmueble.asesor_id || user?.id || null,
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

export async function reasignarAsesor(inmuebleId: string, asesorId: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión no válida.' };

  const { data: profile } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.rol !== 'admin') {
    return { success: false, error: 'No autorizado. Solo los administradores pueden reasignar asesores.' };
  }

  // Actualizar el campo asesor_id_override (el null sirve para limpiar el override y volver al del ERP)
  const { error } = await supabase
    .from('inmuebles')
    .update({ asesor_id_override: asesorId || null })
    .eq('id', inmuebleId)
    .eq('inmobiliaria_id', profile.inmobiliaria_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/inmuebles');
  revalidatePath('/dashboard');
  revalidatePath('/tareas');
  revalidatePath('/agenda');
  return { success: true, message: 'Asesor reasignado exitosamente.' };
}

export async function actualizarUnidad(inmuebleId: string, unidad: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión no válida.' };

  const { data: profile } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.rol !== 'admin') {
    return { success: false, error: 'No autorizado. Solo los administradores pueden asignar la unidad.' };
  }

  // La unidad agrupa inmuebles del mismo lugar: las franjas de agenda de un
  // inmueble cubren a todos los que comparten unidad (o dirección si es null)
  const { error } = await supabase
    .from('inmuebles')
    .update({ unidad: unidad?.trim() || null })
    .eq('id', inmuebleId)
    .eq('inmobiliaria_id', profile.inmobiliaria_id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath('/inmuebles');
  revalidatePath('/agenda');
  return { success: true, message: 'Unidad actualizada.' };
}

/**
 * Oferta (o deja de ofertar) un inmueble mediante un override LOCAL de estado.
 * Caso de uso: un inmueble se desocupa y queremos ofertarlo, pero el ERP lo
 * mantiene como 'arrendado' por temas de contrato pendientes.
 * - ofertar=true  → estado_override='disponible', estado='disponible' y el
 *   canon con el que se va a ofrecer (`precio_oferta`, obligatorio).
 * - ofertar=false → limpia el override y el precio de oferta; el estado vuelve
 *   al del ERP (estado_erp).
 * Nunca escribe al ERP; el sync respeta ambos overrides (no los pisa).
 *
 * El precio es obligatorio porque es justamente el dato que el ERP tiene mal:
 * al desocuparse, el inmueble se vuelve a ofrecer con el canon ajustado por
 * IPC, mientras el ERP sigue mostrando el del contrato viejo. Llamarla de
 * nuevo sobre un inmueble ya ofertado sirve para corregir ese precio.
 */
export async function ofertarInmueble(inmuebleId: string, ofertar: boolean, precioOferta?: number | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión no válida.' };

  const { data: profile } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.rol !== 'admin') {
    return { success: false, error: 'No autorizado. Solo los administradores pueden ofertar inmuebles.' };
  }

  const { data: inmueble } = await supabase
    .from('inmuebles')
    .select('id, estado_erp, precio')
    .eq('id', inmuebleId)
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .single();

  if (!inmueble) return { success: false, error: 'Inmueble no encontrado.' };

  let update: Record<string, unknown>;
  if (ofertar) {
    const precio = Number(precioOferta);
    if (!Number.isFinite(precio) || precio <= 0) {
      return { success: false, error: 'Indica el canon con el que se va a ofrecer el inmueble.' };
    }
    // Freno al cero de más. El ajuste por IPC mueve el canon unos puntos
    // porcentuales, nunca lo triplica: si la cifra se sale de ese rango es un
    // error de tipeo, y ese número terminaría saliendo por WhatsApp a un
    // cliente. Solo se compara si el ERP trae un precio válido.
    const erp = Number(inmueble.precio);
    if (Number.isFinite(erp) && erp > 0 && (precio > erp * 3 || precio < erp / 3)) {
      return {
        success: false,
        error:
          `$${precio.toLocaleString('es-CO')} se aleja demasiado del precio del ERP ` +
          `($${erp.toLocaleString('es-CO')}). Revisa si sobra o falta un cero.`,
      };
    }
    update = { estado_override: 'disponible', estado: 'disponible', precio_oferta: precio };
  } else {
    update = { estado_override: null, estado: inmueble.estado_erp || 'arrendado', precio_oferta: null };
  }

  const { error } = await supabase
    .from('inmuebles')
    .update(update)
    .eq('id', inmuebleId)
    .eq('inmobiliaria_id', profile.inmobiliaria_id);

  if (error) return { success: false, error: error.message };

  revalidatePath('/inmuebles');
  revalidatePath('/citas');
  revalidatePath('/agenda');
  return { success: true };
}

/**
 * Marca (o quita) un inmueble como "empalme": arrendado que el inquilino de salida
 * muestra directo. Setea el override local a 'empalme' (el sync no lo pisa) y guarda
 * el contacto del inquilino (teléfono obligatorio; lo carga el admin, no viene del ERP).
 * No crea agenda ni asesor: el empalme es off-platform salvo el estado + el contacto.
 */
export async function marcarEmpalme(
  inmuebleId: string,
  activar: boolean,
  contacto?: { nombre?: string; telefono?: string }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión no válida.' };

  const { data: profile } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.rol !== 'admin') {
    return { success: false, error: 'No autorizado. Solo los administradores pueden marcar empalmes.' };
  }

  const { data: inmueble } = await supabase
    .from('inmuebles')
    .select('id, estado_erp')
    .eq('id', inmuebleId)
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .single();

  if (!inmueble) return { success: false, error: 'Inmueble no encontrado.' };

  let update: Record<string, any>;
  if (activar) {
    const telefono = (contacto?.telefono || '').trim();
    const nombre = (contacto?.nombre || '').trim();
    if (!telefono) {
      return { success: false, error: 'Ingresa el teléfono del inquilino que muestra el inmueble.' };
    }
    update = {
      estado_override: 'empalme',
      estado: 'empalme',
      empalme_contacto_nombre: nombre || null,
      empalme_contacto_telefono: telefono,
    };
  } else {
    update = {
      estado_override: null,
      estado: inmueble.estado_erp || 'arrendado',
      empalme_contacto_nombre: null,
      empalme_contacto_telefono: null,
    };
  }

  const { error } = await supabase
    .from('inmuebles')
    .update(update)
    .eq('id', inmuebleId)
    .eq('inmobiliaria_id', profile.inmobiliaria_id);

  if (error) return { success: false, error: error.message };

  revalidatePath('/inmuebles');
  return { success: true };
}
