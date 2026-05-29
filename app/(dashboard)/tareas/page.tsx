import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import TareasView from './TareasView';

export default async function TareasPage() {
  const user = await getCurrentUser();
  if (!user || !user.profile) {
    redirect('/login');
  }

  const { profile } = user;
  const isAdmin = profile.rol === 'admin';

  // 1. Acceso restringido exclusivamente a administradores
  if (!isAdmin) {
    redirect('/dashboard');
  }

  const supabase = await createClient();

  // 2. Recuperar todas las tareas operativas genéricas y polimórficas de la inmobiliaria
  const { data: tasks, error } = await supabase
    .from('tareas')
    .select('*')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error al recuperar tareas en la página:', error);
  }

  return (
    <TareasView initialTasks={tasks || []} />
  );
}
