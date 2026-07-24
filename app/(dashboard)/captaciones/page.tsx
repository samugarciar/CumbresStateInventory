import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CaptacionesClient from './CaptacionesClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Captaciones | Cumbres State Inventory',
};

// Fecha de hoy en Bogotá (el servidor de Vercel corre en UTC).
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

// OJO: debe ser un literal (sin concatenar con +). Si se construye con `+`,
// TypeScript lo ensancha a `string` y el cliente de Supabase deja de inferir
// las columnas (devuelve GenericStringError[]).
const CAMPOS = `
  id, fuente, url, titulo, tipo_inmueble, tipo_transaccion, ciudad, barrio, precio, area_m2,
  habitaciones, banos, es_dueno_directo, score, motivos, contacto_nombre, contacto_telefono,
  contacto_perfil, canal, mensaje_borrador, estado, proximo_seguimiento, n_seguimientos,
  fecha_contacto, created_at
`;

export default async function CaptacionesPage() {
  const user = await getCurrentUser();
  if (!user?.profile) redirect('/login');
  // Captaciones es un módulo de administración: solo admins.
  if (user.profile.rol !== 'admin') redirect('/dashboard');

  const supabase = await createClient();

  const [{ data: porAprobar }, { data: enSeguimiento }, { count: captados }, { count: descartados }] =
    await Promise.all([
      supabase
        .from('captacion_prospectos')
        .select(CAMPOS)
        .eq('estado', 'por_aprobar')
        .order('score', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('captacion_prospectos')
        .select(CAMPOS)
        .in('estado', ['contactado', 'en_conversacion', 'cita'])
        .order('proximo_seguimiento', { ascending: true, nullsFirst: false })
        .limit(100),
      supabase
        .from('captacion_prospectos')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'captado'),
      supabase
        .from('captacion_prospectos')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'descartado'),
    ]);

  return (
    <CaptacionesClient
      porAprobar={porAprobar ?? []}
      enSeguimiento={enSeguimiento ?? []}
      captados={captados ?? 0}
      descartados={descartados ?? 0}
      hoy={hoyBogota()}
    />
  );
}
