'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

export async function registrarAsesor(prevState: any, formData: FormData) {
  const nombreCompleto = formData.get('nombreCompleto') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const telefono = ((formData.get('telefono') as string) || '').trim();

  if (!nombreCompleto || !email || !password) {
    return { success: false, error: 'El nombre, el correo y la contraseña son obligatorios.' };
  }

  if (password.length < 6) {
    return { success: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
  }

  // 1. Verificar sesión del administrador solicitante
  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (!currentUser) {
    return { success: false, error: 'Sesión no activa.' };
  }

  // Obtener perfil del solicitante
  const { data: profile, error: profileErr } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', currentUser.id)
    .single();

  if (profileErr || !profile || profile.rol !== 'admin') {
    return { success: false, error: 'No posees permisos de administrador.' };
  }

  try {
    // 2. Crear el usuario asesor en Supabase Auth mediante service_role client
    const supabaseAdmin = createAdminClient();
    
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Confirmamos su correo de inmediato para que pueda loguearse
    });

    if (authError) {
      return { 
        success: false, 
        error: authError.message.includes('already registered')
          ? 'Este correo electrónico ya se encuentra registrado.'
          : `Error en Autenticación: ${authError.message}` 
      };
    }

    const newUser = authData.user;
    if (!newUser) {
      return { success: false, error: 'Error al instanciar el nuevo usuario.' };
    }

    // 3. Crear el perfil en la tabla de usuarios
    const { error: insertError } = await supabaseAdmin
      .from('usuarios')
      .insert({
        id: newUser.id,
        inmobiliaria_id: profile.inmobiliaria_id,
        nombre_completo: nombreCompleto,
        email,
        telefono: telefono || null,
        rol: 'asesor',
      });

    if (insertError) {
      // Eliminar el auth.user recién creado para evitar huérfanos si falla la tabla pública
      await supabaseAdmin.auth.admin.deleteUser(newUser.id);
      return { success: false, error: `Error al crear perfil en la base de datos: ${insertError.message}` };
    }

    revalidatePath('/asesores');
    return { success: true, message: 'Asesor comercial registrado de manera exitosa.' };
  } catch (err: any) {
    return { success: false, error: `Excepción inesperada: ${err.message || err}` };
  }
}

/**
 * Actualiza el teléfono de un asesor existente (solo admin de su inmobiliaria).
 * Se usa para completar el dato en asesores ya creados, de modo que el payload
 * de "Confirmar citas" hacia n8n pueda incluir el teléfono del asesor.
 */
export async function actualizarTelefonoAsesor(asesorId: string, telefono: string | null) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Sesión no activa.' };

  const { data: profile } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.rol !== 'admin') {
    return { success: false, error: 'No posees permisos de administrador.' };
  }

  try {
    const supabaseAdmin = createAdminClient();

    // El asesor debe pertenecer a la inmobiliaria del admin
    const { data: asesor } = await supabaseAdmin
      .from('usuarios')
      .select('id, inmobiliaria_id')
      .eq('id', asesorId)
      .single();

    if (!asesor || asesor.inmobiliaria_id !== profile.inmobiliaria_id) {
      return { success: false, error: 'Asesor no encontrado.' };
    }

    const limpio = (telefono || '').trim();
    const { error } = await supabaseAdmin
      .from('usuarios')
      .update({ telefono: limpio || null })
      .eq('id', asesorId);

    if (error) {
      return { success: false, error: `No se pudo actualizar el teléfono: ${error.message}` };
    }

    revalidatePath('/asesores');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: `Excepción inesperada: ${err.message || err}` };
  }
}

// Baneo "indefinido" de Auth (100 años): el asesor no puede iniciar sesión ni
// refrescar su token. 'none' lo levanta.
const BANEO_INDEFINIDO = '876000h';

/**
 * Comprueba que quien llama es admin y que el asesor es de su inmobiliaria.
 * Devuelve el cliente con llave de servicio: las escrituras en usuarios no
 * tienen política para el token del usuario (ver 2026-10-23_asesores_activos.sql).
 */
async function adminConAsesor(asesorId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión no activa.' } as const;

  const { data: profile } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (!profile || profile.rol !== 'admin') {
    return { error: 'No posees permisos de administrador.' } as const;
  }

  const supabaseAdmin = createAdminClient();
  const { data: asesor } = await supabaseAdmin
    .from('usuarios')
    .select('id, nombre_completo, email, rol, activo, inmobiliaria_id')
    .eq('id', asesorId)
    .single();

  if (!asesor || asesor.inmobiliaria_id !== profile.inmobiliaria_id || asesor.rol !== 'asesor') {
    return { error: 'Asesor no encontrado.' } as const;
  }

  return { supabaseAdmin, asesor, inmobiliariaId: profile.inmobiliaria_id as string } as const;
}

/**
 * Edita el nombre y el correo de un asesor. El correo es también su usuario
 * de inicio de sesión, así que se cambia primero en Auth.
 * Ojo: el nombre es el que se empareja con el asesor de Nuby al sincronizar.
 */
export async function actualizarAsesor(asesorId: string, nombreCompleto: string, email: string) {
  const nombre = (nombreCompleto || '').trim().replace(/\s+/g, ' ');
  const correo = (email || '').trim().toLowerCase();
  if (!nombre || !correo) {
    return { success: false, error: 'El nombre y el correo son obligatorios.' };
  }

  try {
    const ctx = await adminConAsesor(asesorId);
    if ('error' in ctx) return { success: false, error: ctx.error };
    const { supabaseAdmin, asesor } = ctx;

    const cambiaCorreo = correo !== asesor.email.toLowerCase();
    if (cambiaCorreo) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(asesorId, {
        email: correo,
        email_confirm: true,
      });
      if (authError) {
        return {
          success: false,
          error: authError.message.includes('already')
            ? 'Ese correo ya lo usa otra cuenta.'
            : `No se pudo cambiar el correo de acceso: ${authError.message}`,
        };
      }
    }

    const { error } = await supabaseAdmin
      .from('usuarios')
      .update({ nombre_completo: nombre, email: correo })
      .eq('id', asesorId);

    if (error) {
      if (cambiaCorreo) {
        await supabaseAdmin.auth.admin.updateUserById(asesorId, { email: asesor.email, email_confirm: true });
      }
      return { success: false, error: `No se pudo actualizar el asesor: ${error.message}` };
    }

    revalidatePath('/asesores');
    return { success: true };
  } catch (err) {
    return { success: false, error: `Excepción inesperada: ${err instanceof Error ? err.message : err}` };
  }
}

/**
 * Desactiva a un asesor que se fue de la empresa. Nunca se borra: el borrado
 * arrastra en cascada su agenda y todas sus citas.
 * - Si tiene franjas de hoy en adelante no se deja: el agente comercial las
 *   seguiría ofreciendo. Hay que reasignarlas o eliminarlas en la Agenda.
 * - Con `reasignarA`, sus inmuebles (asesor efectivo) pasan a ese asesor con
 *   asesor_id_override, que la sincronización con Nuby respeta.
 * - Se banea su usuario de Auth para que no pueda volver a entrar.
 */
export async function desactivarAsesor(asesorId: string, reasignarA: string | null) {
  try {
    const ctx = await adminConAsesor(asesorId);
    if ('error' in ctx) return { success: false, error: ctx.error };
    const { supabaseAdmin, asesor, inmobiliariaId } = ctx;

    if (!asesor.activo) return { success: false, error: 'Este asesor ya está inactivo.' };

    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const { count: franjasFuturas } = await supabaseAdmin
      .from('franjas_horarias')
      .select('id', { count: 'exact', head: true })
      .eq('asesor_id', asesorId)
      .gte('fecha', hoy);

    if (franjasFuturas) {
      return {
        success: false,
        error: `Tiene ${franjasFuturas} franja(s) en la agenda de hoy en adelante. Reasígnalas a otro asesor o elimínalas en Agenda antes de desactivarlo.`,
      };
    }

    let inmueblesReasignados = 0;
    if (reasignarA) {
      if (reasignarA === asesorId) {
        return { success: false, error: 'Elige a otro asesor para recibir sus inmuebles.' };
      }
      const { data: destino } = await supabaseAdmin
        .from('usuarios')
        .select('id')
        .eq('id', reasignarA)
        .eq('inmobiliaria_id', inmobiliariaId)
        .eq('rol', 'asesor')
        .eq('activo', true)
        .maybeSingle();
      if (!destino) return { success: false, error: 'El asesor que recibe los inmuebles no es válido.' };

      const { data: movidos, error: errInm } = await supabaseAdmin
        .from('inmuebles')
        .update({ asesor_id_override: reasignarA })
        .eq('inmobiliaria_id', inmobiliariaId)
        .or(`asesor_id_override.eq.${asesorId},and(asesor_id_override.is.null,asesor_id.eq.${asesorId})`)
        .select('id');
      if (errInm) {
        return { success: false, error: `No se pudieron reasignar sus inmuebles: ${errInm.message}` };
      }
      inmueblesReasignados = movidos?.length || 0;
    }

    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(asesorId, {
      ban_duration: BANEO_INDEFINIDO,
    });
    if (banError) {
      return { success: false, error: `No se pudo bloquear su acceso: ${banError.message}` };
    }

    const { error } = await supabaseAdmin
      .from('usuarios')
      .update({ activo: false, desactivado_at: new Date().toISOString() })
      .eq('id', asesorId);

    if (error) {
      await supabaseAdmin.auth.admin.updateUserById(asesorId, { ban_duration: 'none' });
      return { success: false, error: `No se pudo desactivar: ${error.message}` };
    }

    revalidatePath('/asesores');
    revalidatePath('/inmuebles');
    revalidatePath('/dashboard');
    return { success: true, inmueblesReasignados };
  } catch (err) {
    return { success: false, error: `Excepción inesperada: ${err instanceof Error ? err.message : err}` };
  }
}

/** Reactiva a un asesor inactivo y le devuelve el acceso. Sus inmuebles no vuelven solos. */
export async function reactivarAsesor(asesorId: string) {
  try {
    const ctx = await adminConAsesor(asesorId);
    if ('error' in ctx) return { success: false, error: ctx.error };
    const { supabaseAdmin, asesor } = ctx;

    if (asesor.activo) return { success: false, error: 'Este asesor ya está activo.' };

    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(asesorId, {
      ban_duration: 'none',
    });
    if (banError) {
      return { success: false, error: `No se pudo devolverle el acceso: ${banError.message}` };
    }

    const { error } = await supabaseAdmin
      .from('usuarios')
      .update({ activo: true, desactivado_at: null })
      .eq('id', asesorId);

    if (error) {
      await supabaseAdmin.auth.admin.updateUserById(asesorId, { ban_duration: BANEO_INDEFINIDO });
      return { success: false, error: `No se pudo reactivar: ${error.message}` };
    }

    revalidatePath('/asesores');
    return { success: true };
  } catch (err) {
    return { success: false, error: `Excepción inesperada: ${err instanceof Error ? err.message : err}` };
  }
}
