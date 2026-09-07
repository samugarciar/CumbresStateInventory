import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import ColaClient from './ColaClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cola de revisión | Cumbres State Inventory',
};

// Cola de revisión del "modo cola".
//
// El bookmarklet, sobre una lista de resultados de Facebook, deja aquí solo los
// ENLACES: desde una lista no hay descripción, y sin descripción el calificador
// no puede distinguir un dueño directo de una agencia (se comprobó: 33 anuncios
// capturados así salieron todos con el mismo score). El prospecto se crea
// después, al abrir cada publicación y pulsar "Captar" allí.
//
// Los anuncios nuevos llegan en el FRAGMENTO de la URL, que el navegador no
// manda al servidor: por eso el alta la hace el componente cliente.
export default async function ColaPage() {
  const user = await getCurrentUser();
  if (!user?.profile) redirect('/login');
  if (user.profile.rol !== 'admin') redirect('/dashboard');

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('captacion_cola')
    .select('id, url, titulo, precio, fuente, created_at')
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true });

  // Un fallo de carga NO puede verse como "la cola está vacía": ese fue
  // exactamente el bug de la bandeja, donde una columna inexistente se mostraba
  // como una vista vacía y parecía que el agente no encontraba nada.
  if (error) console.error('[Captaciones/cola] Error cargando la cola:', error.message);

  return <ColaClient pendientes={data ?? []} errorCarga={error ? error.message : null} />;
}
