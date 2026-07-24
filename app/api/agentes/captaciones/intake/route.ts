// Intake del agente de captaciones: recibe UN anuncio (URL y/o texto pegado),
// lo normaliza a ListingCrudo y lo pasa por el grafo → prospecto calificado con
// mensaje redactado, en estado 'por_aprobar'. NUNCA envía nada: el contacto lo
// aprueba y ejecuta un humano.
//
// Descubrimiento: Mercado Libre cerró su búsqueda pública (403), así que los
// anuncios entran por aquí — pegados a mano o desde una sesión de navegador
// supervisado. Si la URL es de Mercado Libre, se ENRIQUECE con la API oficial
// (/items/{id}), que sí sigue abierta y da datos estructurados.
//
// Auth: sesión de admin (desde la app) o cabecera x-webhook-token
// (CAPTACIONES_WEBHOOK_TOKEN) para automatizaciones.
//
// POST body: { url?, texto?, fuente?, titulo?, descripcion?, precio?, ciudad?,
//              barrio?, habitaciones?, banos?, area_m2?, contacto_nombre?,
//              contacto_telefono?, contacto_perfil?, inmobiliaria_id? }

import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { correrCaptacion } from '@/lib/agente-captaciones/graph';
import { registrarUso } from '@/lib/agente-captaciones/uso';
import { listingVacio, type FuenteCaptacion, type ListingCrudo } from '@/lib/agente-captaciones/tipos';
import { enriquecerItem, extraerItemId, esUrlMercadoLibre } from '@/lib/agente-captaciones/sources/mercadolibre';

export const maxDuration = 300;

interface Cuerpo {
  url?: string;
  texto?: string;
  fuente?: FuenteCaptacion;
  titulo?: string;
  descripcion?: string;
  precio?: number;
  ciudad?: string;
  barrio?: string;
  area_m2?: number;
  habitaciones?: number;
  banos?: number;
  contacto_nombre?: string;
  contacto_telefono?: string;
  contacto_perfil?: string;
  inmobiliaria_id?: string;
}

function inferirFuente(url: string | undefined): FuenteCaptacion {
  if (!url) return 'otro';
  if (esUrlMercadoLibre(url)) return 'mercadolibre';
  if (/facebook\.com|fb\.com|fb\.me/i.test(url)) return 'facebook';
  return 'otro';
}

export async function POST(request: Request) {
  // --- auth: token de automatización o sesión de admin ---
  const token = request.headers.get('x-webhook-token');
  const tokenEsperado = process.env.CAPTACIONES_WEBHOOK_TOKEN;
  const porToken = Boolean(token && tokenEsperado && token === tokenEsperado);

  let inmobiliariaId: string | undefined;
  if (!porToken) {
    const user = await getCurrentUser();
    if (!user?.profile || user.profile.rol !== 'admin') {
      return Response.json({ estado: 'error', error: 'No autorizado' }, { status: 401 });
    }
    inmobiliariaId = user.profile.inmobiliaria_id;
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ estado: 'error', error: 'Falta configurar OPENAI_API_KEY' }, { status: 500 });
  }

  const cuerpo: Cuerpo | null = await request.json().catch(() => null);
  if (!cuerpo) {
    return Response.json({ estado: 'error', error: 'Body inválido' }, { status: 400 });
  }
  inmobiliariaId = inmobiliariaId || cuerpo.inmobiliaria_id || process.env.CUMBRES_INMOBILIARIA_ID;
  if (!inmobiliariaId) {
    return Response.json({ estado: 'error', error: 'Falta inmobiliaria_id' }, { status: 400 });
  }

  const url = cuerpo.url?.trim();
  const texto = cuerpo.texto?.trim();
  if (!url && !texto && !cuerpo.titulo) {
    return Response.json(
      { estado: 'error', error: 'Manda al menos una url, un texto del anuncio o un título.' },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // --- kill switch (mismo patrón que el agente comercial): sin fila = activo ---
  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();
  if (config && !config.activo) {
    return Response.json({ estado: 'pausado', error: 'El agente de captaciones está pausado.' }, { status: 409 });
  }

  // --- construir el ListingCrudo ---
  const fuente = cuerpo.fuente ?? inferirFuente(url);
  let listing: ListingCrudo = listingVacio(fuente);
  let enriquecido = false;

  if (fuente === 'mercadolibre' && url) {
    const itemId = extraerItemId(url);
    if (itemId) {
      try {
        listing = await enriquecerItem(supabase, inmobiliariaId, itemId);
        enriquecido = true;
      } catch (e) {
        // Sin enriquecer se sigue con lo que haya mandado el usuario: es mejor
        // registrar el prospecto con datos parciales que perder el anuncio.
        console.warn('[Captaciones] No se pudo enriquecer con la API de ML:', e);
      }
    }
  }

  // Lo que venga explícito en el body pisa a lo enriquecido (el humano manda).
  listing.url = url ?? listing.url;
  listing.titulo = cuerpo.titulo ?? listing.titulo;
  listing.descripcion = cuerpo.descripcion ?? texto ?? listing.descripcion;
  listing.precio = cuerpo.precio ?? listing.precio;
  listing.ciudad = cuerpo.ciudad ?? listing.ciudad;
  listing.barrio = cuerpo.barrio ?? listing.barrio;
  listing.area_m2 = cuerpo.area_m2 ?? listing.area_m2;
  listing.habitaciones = cuerpo.habitaciones ?? listing.habitaciones;
  listing.banos = cuerpo.banos ?? listing.banos;
  listing.contacto_nombre = cuerpo.contacto_nombre ?? listing.contacto_nombre;
  listing.contacto_telefono = cuerpo.contacto_telefono ?? listing.contacto_telefono;
  listing.contacto_perfil = cuerpo.contacto_perfil ?? listing.contacto_perfil;
  if (!listing.fuente_id && url) listing.fuente_id = url; // dedup por URL si no hay id propio

  // --- correr el grafo ---
  try {
    const salida = await correrCaptacion({ supabase, inmobiliariaId, listing });
    await registrarUso(supabase, inmobiliariaId, salida.prospecto_id, salida.uso);
    return Response.json({ estado: 'ok', enriquecido, ...salida });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Captaciones] Error corriendo el grafo:', msg);
    return Response.json({ estado: 'error', error: msg }, { status: 500 });
  }
}
