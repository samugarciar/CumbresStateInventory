'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function login(prevState: any, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { success: false, error: 'Por favor, completa todos los campos.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { success: false, error: error.message || 'Credenciales incorrectas.' };
  }

  revalidatePath('/', 'layout');
  return { success: true, redirect: '/dashboard' };
}

export async function signupInmobiliaria(prevState: any, formData: FormData) {
  const nombreInmobiliaria = formData.get('nombreInmobiliaria') as string;
  const nit = formData.get('nit') as string;
  const nombreCompleto = formData.get('nombreCompleto') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!nombreInmobiliaria || !nit || !nombreCompleto || !email || !password) {
    return { success: false, error: 'Todos los campos son obligatorios.' };
  }

  const supabase = await createClient();
  const supabaseAdmin = createAdminClient();

  // 1. Insertar la inmobiliaria usando admin para evitar problemas de RLS antes de que el usuario tenga sesión
  const { data: inmob, error: inmobError } = await supabaseAdmin
    .from('inmobiliarias')
    .insert({ nombre: nombreInmobiliaria, nit })
    .select('id')
    .single();

  if (inmobError) {
    return { 
      success: false, 
      error: inmobError.code === '23505' 
        ? 'Este NIT de inmobiliaria ya se encuentra registrado.' 
        : `Error al crear inmobiliaria: ${inmobError.message}` 
    };
  }

  // 2. Registrar el usuario en Supabase Auth (usando el cliente estándar para iniciar la sesión web)
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError) {
    // Si falla el registro, intentamos borrar la inmobiliaria creada para no dejar datos huérfanos
    await supabaseAdmin.from('inmobiliarias').delete().eq('id', inmob.id);
    return { success: false, error: `Error en registro: ${authError.message}` };
  }

  const user = authData.user;
  if (!user) {
    return { success: false, error: 'No se pudo crear la cuenta de usuario.' };
  }

  // 3. Crear el perfil de usuario administrador usando admin
  const { error: profileError } = await supabaseAdmin.from('usuarios').insert({
    id: user.id,
    inmobiliaria_id: inmob.id,
    nombre_completo: nombreCompleto,
    email,
    rol: 'admin',
  });

  if (profileError) {
    // En caso de error al crear el perfil, borramos el usuario y la inmobiliaria
    await supabaseAdmin.auth.admin.deleteUser(user.id);
    await supabaseAdmin.from('inmobiliarias').delete().eq('id', inmob.id);
    return { success: false, error: `Error al crear perfil administrativo: ${profileError.message}` };
  }

  revalidatePath('/', 'layout');
  return { success: true, redirect: '/dashboard' };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
