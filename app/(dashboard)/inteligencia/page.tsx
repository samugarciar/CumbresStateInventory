import { getCurrentUser } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import InteligenciaClient from './InteligenciaClient';

export default async function InteligenciaPage() {
  const user = await getCurrentUser();

  if (!user?.profile) {
    redirect('/login');
  }
  // Datos comerciales y financieros de toda la inmobiliaria: solo admins.
  if (user.profile.rol !== 'admin') {
    redirect('/dashboard');
  }

  return <InteligenciaClient nombreUsuario={user.profile.nombre_completo} />;
}
