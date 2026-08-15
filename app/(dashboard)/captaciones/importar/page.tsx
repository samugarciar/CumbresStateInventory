import { getCurrentUser } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import ImportarClient from './ImportarClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Importar anuncios | Cumbres State Inventory',
};

// Destino del bookmarklet "Captar". Los anuncios llegan en el FRAGMENTO de la
// URL (después del #), que el navegador NO envía al servidor: por eso los lee
// el componente cliente. Se hace así porque Facebook y Mercado Libre tienen
// CSP estricta y un bookmarklet no puede hacer fetch desde sus páginas hacia
// esta app; abrir una pestaña sí funciona, y además usa la sesión del admin
// en vez de un token embebido en el marcador.
export default async function ImportarPage() {
  const user = await getCurrentUser();
  if (!user?.profile) redirect('/login');
  if (user.profile.rol !== 'admin') redirect('/dashboard');

  return <ImportarClient />;
}
