import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CitasView from './CitasView';

export default async function CitasPage() {
  const user = await getCurrentUser();
  if (!user || !user.profile) {
    redirect('/login');
  }

  const { profile } = user;
  const isAdmin = profile.rol === 'admin';
  const supabase = await createClient();

  // Fecha de hoy en la zona horaria de Colombia, independiente de la TZ del servidor
  // (en Vercel el servidor corre en UTC y rodaría al día siguiente por la noche).
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

  // Citas agendadas de hoy en adelante.
  // RLS: el asesor solo recibe las citas de sus franjas; el admin, todas las de su inmobiliaria.
  const { data: citas } = await supabase
    .from('citas')
    .select(`
      id,
      franja_id,
      inmueble_id,
      fecha,
      hora_inicio,
      hora_fin,
      cliente_nombre,
      cliente_telefono,
      cliente_email,
      origen,
      inmuebles ( titulo, direccion ),
      franjas_horarias ( asesor_id, usuarios!franjas_horarias_asesor_id_fkey ( id, nombre_completo ) )
    `)
    .eq('estado', 'agendada')
    .gte('fecha', hoy)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true });

  // Para admin: lista de asesores de la inmobiliaria para los chips de filtro
  let asesores: any[] = [];
  let inmuebles: any[] = [];
  if (isAdmin) {
    const { data: dataAsesores } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('rol', 'asesor')
      .order('nombre_completo');
    asesores = dataAsesores || [];

    // Inmuebles disponibles para el selector del formulario "Nueva cita"
    const { data: dataInmuebles } = await supabase
      .from('inmuebles')
      .select('id, titulo, direccion')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('estado', 'disponible')
      .order('titulo');
    inmuebles = dataInmuebles || [];
  }

  return (
    <CitasView
      citas={(citas || []) as any[]}
      asesores={asesores}
      inmuebles={inmuebles}
      isAdmin={isAdmin}
      hoy={hoy}
    />
  );
}
