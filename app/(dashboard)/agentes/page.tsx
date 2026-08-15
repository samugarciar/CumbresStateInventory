import { getCurrentUser } from '@/lib/auth-helpers';
import { MODELO_BI } from '@/lib/bi/costos';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { MODELO_CALIFICAR, MODELO_REDACTAR } from '@/lib/agente-captaciones/config';
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
    { data: usoComercialMes },
    { count: citas7 },
    { count: citas30 },
    { count: solicitudes30 },
    { count: solicitudesPendientes },
    { data: usoCaptacionMes },
    { count: prospectosPorAprobar },
    { count: prospectosContactados30 },
    { count: prospectosCaptados },
  ] = await Promise.all([
    supabase.from('agentes_config').select('agente, activo, limite_mensual_usd, prompt_sistema'),
    supabase
      .from('bi_uso')
      .select('costo_usd, tokens_entrada, tokens_salida, tokens_cache_lectura, tokens_cache_escritura, created_at')
      .gte('created_at', inicioMes),
    supabase
      .from('agente_comercial_uso')
      .select('costo_usd, tokens_entrada, tokens_salida, tokens_cache, modelo, created_at')
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
    supabase.from('captacion_uso').select('costo_usd, tokens_entrada, tokens_salida, tokens_cache, modelo, created_at').gte('created_at', inicioMes),
    supabase.from('captacion_prospectos').select('id', { count: 'exact', head: true }).eq('estado', 'por_aprobar'),
    supabase.from('captacion_prospectos').select('id', { count: 'exact', head: true }).eq('estado', 'contactado').gte('fecha_contacto', hace30d.substring(0, 10)),
    supabase.from('captacion_prospectos').select('id', { count: 'exact', head: true }).eq('estado', 'captado'),
  ]);

  // Estado de la conexión con Mercado Libre. Se lee con el cliente admin porque
  // integraciones_mercadolibre tiene RLS sin políticas (guarda tokens); acá solo
  // se exponen campos NO sensibles — nunca los tokens.
  let ml: { conectado: boolean; ml_user_id: string | null; expira: string | null } = {
    conectado: false, ml_user_id: null, expira: null,
  };
  try {
    const { data: conexion } = await createAdminClient()
      .from('integraciones_mercadolibre')
      .select('ml_user_id, expires_at')
      .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
      .maybeSingle();
    if (conexion) {
      ml = { conectado: true, ml_user_id: conexion.ml_user_id, expira: conexion.expires_at };
    }
  } catch (e) {
    console.warn('[Agentes] No se pudo leer la conexión de Mercado Libre:', e);
  }

  // Config por agente (sin fila = activo por defecto, igual que el backend)
  const config = {
    arriendabot_bi: { activo: true, limite_mensual_usd: null as number | null },
    comercial_whatsapp: { activo: true },
    captaciones: { activo: true, prompt_sistema: '' as string, limite_mensual_usd: null as number | null },
  };
  for (const row of configRows || []) {
    if (row.agente === 'arriendabot_bi') {
      config.arriendabot_bi = {
        activo: row.activo,
        limite_mensual_usd: row.limite_mensual_usd !== null ? Number(row.limite_mensual_usd) : null,
      };
    } else if (row.agente === 'comercial_whatsapp') {
      config.comercial_whatsapp = { activo: row.activo };
    } else if (row.agente === 'captaciones') {
      config.captaciones = {
        activo: row.activo,
        prompt_sistema: row.prompt_sistema ?? '',
        limite_mensual_usd: row.limite_mensual_usd !== null ? Number(row.limite_mensual_usd) : null,
      };
    }
  }

  // Agregados del uso BI (el mes actual; "hoy" es un subconjunto)
  const filas = usoMes || [];
  const suma = (fn: (r: any) => number) => filas.reduce((acc, r) => acc + fn(r), 0);
  const filasHoy = filas.filter((r) => r.created_at >= inicioHoy);
  const bi = {
    modelo: MODELO_BI,
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

  // Agregados del uso del agente comercial (mismo patrón que `bi` arriba).
  // Hasta que la Fase 5 (cablear n8n al endpoint nuevo) esté lista, esto
  // solo refleja pruebas directas — el tráfico real de WhatsApp sigue
  // corriendo por el agente viejo en n8n mientras dura el canario.
  const filasComercial = usoComercialMes || [];
  const sumaComercial = (fn: (r: any) => number) => filasComercial.reduce((acc, r) => acc + fn(r), 0);
  const filasComercialHoy = filasComercial.filter((r) => r.created_at >= inicioHoy);
  const modelosComercial = Array.from(new Set(filasComercial.map((r) => r.modelo))).sort();
  const comercial = {
    modelos: modelosComercial.length > 0 ? modelosComercial.join(' + ') : 'gpt-4.1 + gpt-4o',
    gastoMesUsd: sumaComercial((r) => Number(r.costo_usd || 0)),
    gastoHoyUsd: filasComercialHoy.reduce((acc, r) => acc + Number(r.costo_usd || 0), 0),
    peticionesMes: filasComercial.length,
    peticionesHoy: filasComercialHoy.length,
    tokensEntradaMes: sumaComercial((r) => r.tokens_entrada || 0),
    tokensSalidaMes: sumaComercial((r) => r.tokens_salida || 0),
    tokensCacheMes: sumaComercial((r) => r.tokens_cache || 0),
  };

  // Agregados del agente de captaciones (mismo patrón que `bi` y `comercial`).
  const filasCap = usoCaptacionMes || [];
  const sumaCap = (fn: (r: any) => number) => filasCap.reduce((acc, r) => acc + fn(r), 0);
  const filasCapHoy = filasCap.filter((r) => r.created_at >= inicioHoy);
  const captaciones = {
    modelos: `${MODELO_CALIFICAR} + ${MODELO_REDACTAR}`,
    gastoMesUsd: sumaCap((r) => Number(r.costo_usd || 0)),
    gastoHoyUsd: filasCapHoy.reduce((acc, r) => acc + Number(r.costo_usd || 0), 0),
    anunciosMes: filasCap.length,
    tokensMes: sumaCap((r) => (r.tokens_entrada || 0) + (r.tokens_salida || 0) + (r.tokens_cache || 0)),
    porAprobar: prospectosPorAprobar || 0,
    contactados30: prospectosContactados30 || 0,
    captados: prospectosCaptados || 0,
    promptSistema: config.captaciones.prompt_sistema,
    limiteMensualUsd: config.captaciones.limite_mensual_usd,
    ml,
  };

  return <AgentesClient config={config} bi={bi} n8n={n8n} comercial={comercial} captaciones={captaciones} />;
}
