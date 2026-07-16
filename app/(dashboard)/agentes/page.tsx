import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AgentesClient from './AgentesClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agentes | Cumbres State Inventory',
};

// Inicio del mes y del día actuales en Bogotá, como instante UTC
// (Colombia es UTC-5 fijo, sin horario de verano).
function inicioMesBogotaISO(): string {
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  return `${ym}-01T05:00:00.000Z`;
}

function inicioHoyBogotaISO(): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  return `${ymd}T05:00:00.000Z`;
}

export default async function AgentesPage() {
  const user = await getCurrentUser();
  if (!user?.profile) {
    redirect('/login');
  }
  // Presupuestos y control de agentes: solo admins.
  if (user.profile.rol !== 'admin') {
    redirect('/dashboard');
  }

  const supabase = await createClient();

  const inicioMes = inicioMesBogotaISO();
  const inicioHoy = inicioHoyBogotaISO();
  const hace7d = new Date(Date.now() - 7 * 864e5).toISOString();
  const hace30d = new Date(Date.now() - 30 * 864e5).toISOString();

  const [
    { data: configRows },
    { data: usoMes },
    { count: citas7 },
    { count: citas30 },
    { count: solicitudes30 },
    { count: solicitudesPendientes },
  ] = await Promise.all([
    supabase.from('agentes_config').select('agente, activo, limite_mensual_usd'),
    supabase
      .from('bi_uso')
      .select('costo_usd, tokens_entrada, tokens_salida, tokens_cache_lectura, tokens_cache_escritura, created_at')
      .gte('created_at', inicioMes),
    supabase
      .from('citas')
      .select('id', { count: 'exact', head: true })
      .eq('origen', 'n8n')
      .gte('created_at', hace7d),
    supabase
      .from('citas')
      .select('id', { count: 'exact', head: true })
      .eq('origen', 'n8n')
      .gte('created_at', hace30d),
    supabase
      .from('solicitudes_apertura')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', hace30d),
    supabase
      .from('solicitudes_apertura')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'pendiente'),
  ]);

  // Config por agente (sin fila = activo por defecto, igual que el backend)
  const config = {
    arriendabot_bi: { activo: true, limite_mensual_usd: null as number | null },
    comercial_whatsapp: { activo: true },
  };
  for (const row of configRows || []) {
    if (row.agente === 'arriendabot_bi') {
      config.arriendabot_bi = {
        activo: row.activo,
        limite_mensual_usd: row.limite_mensual_usd !== null ? Number(row.limite_mensual_usd) : null,
      };
    } else if (row.agente === 'comercial_whatsapp') {
      config.comercial_whatsapp = { activo: row.activo };
    }
  }

  // Agregados del uso BI (el mes actual; "hoy" es un subconjunto)
  const filas = usoMes || [];
  const suma = (fn: (r: any) => number) => filas.reduce((acc, r) => acc + fn(r), 0);
  const filasHoy = filas.filter((r) => r.created_at >= inicioHoy);
  const bi = {
    modelo: process.env.BI_MODEL || 'claude-opus-4-8',
    gastoMesUsd: suma((r) => Number(r.costo_usd || 0)),
    gastoHoyUsd: filasHoy.reduce((acc, r) => acc + Number(r.costo_usd || 0), 0),
    peticionesMes: filas.length,
    peticionesHoy: filasHoy.length,
    tokensEntradaMes: suma((r) => r.tokens_entrada || 0),
    tokensSalidaMes: suma((r) => r.tokens_salida || 0),
    tokensCacheMes: suma((r) => (r.tokens_cache_lectura || 0) + (r.tokens_cache_escritura || 0)),
  };

  const n8n = {
    citas7: citas7 || 0,
    citas30: citas30 || 0,
    solicitudes30: solicitudes30 || 0,
    solicitudesPendientes: solicitudesPendientes || 0,
  };

  return <AgentesClient config={config} bi={bi} n8n={n8n} />;
}
