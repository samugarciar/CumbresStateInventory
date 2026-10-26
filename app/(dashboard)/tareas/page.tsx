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

  // 3. Para mostrar cada tarea sin códigos internos: de quién es (usuario_id) y,
  //    si es de un inmueble, su código para el enlace «Ir» (solo columnas existentes).
  const { data: usuarios } = await supabase
    .from('usuarios')
    .select('id, nombre_completo')
    .eq('inmobiliaria_id', profile.inmobiliaria_id);
  const asesores = Object.fromEntries((usuarios || []).map(u => [u.id, u.nombre_completo as string]));

  const idsInmuebles = Array.from(new Set(
    (tasks || []).filter(t => t.entidad_tipo === 'inmueble' && t.entidad_id).map(t => t.entidad_id as string)
  ));
  let codigosInmuebles: Record<string, string> = {};
  if (idsInmuebles.length > 0) {
    const { data: inms } = await supabase
      .from('inmuebles')
      .select('id, arrendasoft_id')
      .in('id', idsInmuebles);
    codigosInmuebles = Object.fromEntries(
      (inms || []).filter(i => i.arrendasoft_id != null).map(i => [i.id, String(i.arrendasoft_id)])
    );
  }

  // Hora del servidor para el «hace 2 h» del primer render (el navegador sigue desde ahí)
  const ahora = new Date().getTime();

  return (
    <TareasView
      initialTasks={tasks || []}
      asesores={asesores}
      codigosInmuebles={codigosInmuebles}
      ahora={ahora}
    />
  );
}
