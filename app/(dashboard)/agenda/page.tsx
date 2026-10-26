import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AgendaView from './AgendaView';

type PropsAgenda = React.ComponentProps<typeof AgendaView>;

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !user.profile) {
    redirect('/login');
  }
  // La cuenta del revisor de Meta solo entra a /whatsapp.
  if (user.profile.rol === 'revisor') redirect('/whatsapp');

  const { profile } = user;
  const isAdmin = profile.rol === 'admin';
  const supabase = await createClient();

  // Semana a mostrar: la del parámetro ?semana=YYYY-MM-DD, o la semana actual.
  // (Sin esto, navegar de semana no volvía a consultar datos: se quedaba en la actual.)
  // «Hoy» es el de Colombia, no el del servidor: en UTC, desde las 7 p. m.
  // ya sería mañana (y un domingo de noche, la semana siguiente). Se calcula
  // como en citas/page.tsx y se opera en UTC puro para que la zona del
  // servidor no mueva el día.
  // El domingo no se trabaja: su semana es la que empieza al día siguiente
  // (la semana que ya terminó no le sirve a nadie). Es la misma regla que
  // aplica la vista en el navegador, así que los dos piden la misma semana
  // y el domingo la página no se carga dos veces.
  const { semana } = await searchParams;
  const semanaValida = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana);
  const hoyBogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const [anio, mes, dia] = (semanaValida ? semana : hoyBogota).split('-').map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay(); // 0=dom, 1=lun...
  const diffLunes = diaSemana === 0 ? 1 : 1 - diaSemana;
  const lunes = new Date(Date.UTC(anio, mes - 1, dia + diffLunes));
  const sabado = new Date(Date.UTC(anio, mes - 1, dia + diffLunes + 5));

  const fechaInicio = lunes.toISOString().slice(0, 10);
  const fechaFin = sabado.toISOString().slice(0, 10);

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
  let asesores: PropsAgenda['asesores'] = [];
  if (isAdmin) {
    const { data } = await supabase
      .from('usuarios')
      .select('id, nombre_completo')
      .eq('inmobiliaria_id', profile.inmobiliaria_id)
      .eq('rol', 'asesor')
      .eq('activo', true)
      .order('nombre_completo');
    asesores = data || [];
  }

  // Para admin: obtener inmuebles disponibles para el selector del formulario
  let inmuebles: PropsAgenda['inmuebles'] = [];
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
      franjas={(franjas || []) as unknown as PropsAgenda['franjas']}
      citas={(citas || []) as unknown as PropsAgenda['citas']}
      asesores={asesores}
      inmuebles={inmuebles}
      isAdmin={isAdmin}
      userId={profile.id}
      inmobiliariaId={profile.inmobiliaria_id}
      fechaInicioSemana={fechaInicio}
    />
  );
}
