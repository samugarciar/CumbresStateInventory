'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

export async function registrarAsesor(prevState: any, formData: FormData) {
  const nombreCompleto = formData.get('nombreCompleto') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!nombreCompleto || !email || !password) {
    return { success: false, error: 'Todos los campos son obligatorios.' };
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
