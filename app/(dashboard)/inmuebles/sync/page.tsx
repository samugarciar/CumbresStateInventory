import { getCurrentUser } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import SyncClient from './SyncClient';

export default async function SyncPage() {
  // 1. Validar permisos de administrador
  const user = await getCurrentUser();
  if (!user || !user.profile || user.profile.rol !== 'admin') {
    redirect('/inmuebles');
  }

  // 2. Extraer instancia por defecto de variables de entorno
  const defaultInstancia = process.env.NUBY_API_INSTANCIA || 'invosadia.arrendasoft.co';

  return (
    <div className="animate-fade-in" style={{ padding: '0.5rem 0' }}>
      <SyncClient defaultInstancia={defaultInstancia} />
    </div>
  );
}
