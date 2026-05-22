import { createClient } from '@/lib/supabase/server';

export async function getCurrentUser() {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Obtener perfil y datos de inmobiliaria
  const { data: profile, error } = await supabase
    .from('usuarios')
    .select(`
      id,
      nombre_completo,
      email,
      rol,
      inmobiliaria_id,
      inmobiliarias (
        id,
        nombre,
        nit
      )
    `)
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    return {
      auth: user,
      profile: null,
      inmobiliaria: null,
    };
  }

  // Aplanar el resultado de la inmobiliaria
  const { inmobiliarias, ...profileData } = profile as any;

  return {
    auth: user,
    profile: profileData,
    inmobiliaria: inmobiliarias,
  };
}
