import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import InteligenciaClient from './InteligenciaClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Arriendabot | Cumbres State Inventory',
};

export default async function InteligenciaPage() {
  const user = await getCurrentUser();

  if (!user?.profile) {
    redirect('/login');
  }
  // Datos comerciales y financieros de toda la inmobiliaria: solo admins.
  if (user.profile.rol !== 'admin') {
    redirect('/dashboard');
  }

  const supabase = await createClient();

  // Carga inicial en el servidor (evita el parpadeo de "cargando" al abrir
  // la página); las actualizaciones posteriores van por server actions.
  const [{ data: conversaciones }, { data: informes }] = await Promise.all([
    supabase
      .from('bi_conversaciones')
      .select('id, titulo, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50),
    supabase
      .from('bi_artefactos')
      .select('id, tipo, titulo, resumen, created_at, conversacion_id, usuarios(nombre_completo)')
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  return (
    <InteligenciaClient
      nombreUsuario={user.profile.nombre_completo}
      conversacionesIniciales={conversaciones || []}
      informesIniciales={(informes || []) as any[]}
    />
  );
}
