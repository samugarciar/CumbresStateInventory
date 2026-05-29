import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardLayoutClient from './DashboardLayoutClient';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user || !user.profile) {
    // Si el usuario tiene sesión de Auth pero no tiene perfil en la tabla de usuarios (estado inconsistente o RLS fallando),
    // cerramos la sesión de forma activa para evitar bucles infinitos de redirección con el middleware.
    try {
      const supabase = await createClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error('Error al cerrar sesión en redirección defensiva:', e);
    }
    redirect('/login');
  }

  const { profile, inmobiliaria } = user;
  const isAdmin = profile.rol === 'admin';

  // Obtener conteo de tareas pendientes en el servidor para alimentar el Badge del Sidebar
  let pendingTasksCount = 0;
  if (isAdmin) {
    const supabase = await createClient();
    const { count } = await supabase
      .from('tareas')
      .select('*', { count: 'exact', head: true })
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('estado', 'pendiente');
    pendingTasksCount = count || 0;
  }

  return (
    <DashboardLayoutClient 
      profile={profile}
      inmobiliaria={inmobiliaria}
      isAdmin={isAdmin}
      pendingTasksCount={pendingTasksCount}
    >
      {children}
    </DashboardLayoutClient>
  );
}
