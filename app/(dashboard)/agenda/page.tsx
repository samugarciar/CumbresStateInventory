import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AgendaView from './AgendaView';

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !user.profile) {
    redirect('/login');
  }

  const { profile } = user;
  const isAdmin = profile.rol === 'admin';
  const supabase = await createClient();

  // Semana a mostrar: la del parámetro ?semana=YYYY-MM-DD, o la semana actual.
  // (Sin esto, navegar de semana no volvía a consultar datos: se quedaba en la actual.)
  const { semana } = await searchParams;
  const semanaValida = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana);
  const hoy = semanaValida ? new Date(semana + 'T00:00:00') : new Date();
  const diaSemana = hoy.getDay(); // 0=dom, 1=lun...
  const diffLunes = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diffLunes);
  const sabado = new Date(lunes);
  sabado.setDate(lunes.getDate() + 5);

  const fechaInicio = lunes.toISOString().split('T')[0];
  const fechaFin = sabado.toISOString().split('T')[0];

  // Obtener franjas de la semana actual con datos del inmueble y asesor
  const { data: franjas } = await supabase
    .from('franjas_horarias')
    .select(`
      id,
      inmueble_id,
      asesor_id,
      fecha,
      hora_inicio,
      hora_fin,
      color,
      inmuebles ( id, titulo, direccion, unidad ),
      usuarios!franjas_horarias_asesor_id_fkey ( id, nombre_completo )
    `)
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)
    .order('hora_inicio', { ascending: true });

  // Citas agendadas de la semana (RLS limita: admin ve todas, asesor las de sus franjas)
  const { data: citas } = await supabase
    .from('citas')
    .select('id, franja_id, inmueble_id, fecha, hora_inicio, hora_fin, cliente_nombre, cliente_telefono, origen, alcance, unidad, aptos_snapshot, inmuebles ( titulo, direccion, unidad )')
    .gte('fecha', fechaInicio)
    .lte('fecha', fechaFin)
    .eq('estado', 'agendada')
    .order('hora_inicio', { ascending: true });

  // Para admin: obtener lista de asesores de la inmobiliaria
  let asesores: any[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('rol', 'asesor')
      .order('nombre_completo');
    asesores = data || [];
  }

  // Para admin: obtener inmuebles disponibles para el selector del formulario
  let inmuebles: any[] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('inmuebles')
      .select('id, titulo, direccion, unidad')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .neq('estado', 'inactivo')
      .order('titulo');
    inmuebles = data || [];
  }

  return (
    <AgendaView
      franjas={(franjas || []) as any[]}
      citas={(citas || []) as any[]}
      asesores={asesores}
      inmuebles={inmuebles}
      isAdmin={isAdmin}
      userId={profile.id}
      inmobiliariaId={profile.inmobiliaria_id}
      fechaInicioSemana={fechaInicio}
    />
  );
}
