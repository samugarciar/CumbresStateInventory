// Intake por CORREO: recibe un correo de alerta de un portal (búsqueda
// guardada) reenviado por n8n, extrae los anuncios que trae y los pasa por el
// grafo → prospectos calificados en la bandeja.
//
// Es la vía de descubrimiento DESATENDIDA y conforme: no se raspa ninguna
// página, el portal nos envía los datos por correo a nosotros. n8n solo hace de
// cartero (trigger IMAP/Gmail → POST aquí); toda la lógica vive en este repo.
//
// Auth: cabecera x-webhook-token == CAPTACIONES_WEBHOOK_TOKEN (obligatoria: la
// llama una máquina, no hay sesión).
//
// POST body: { asunto?, html?, texto?, from?, inmobiliaria_id? }

import { createAdminClient } from '@/lib/supabase/admin';
import { correrCaptacion } from '@/lib/agente-captaciones/graph';
import { registrarUso } from '@/lib/agente-captaciones/uso';
import { extraerAnunciosDeCorreo, MAX_ANUNCIOS_POR_CORREO } from '@/lib/agente-captaciones/email/extraer';
import { listingVacio, type FuenteCaptacion, type ListingCrudo } from '@/lib/agente-captaciones/tipos';
import { enriquecerItem, extraerItemId, esUrlMercadoLibre } from '@/lib/agente-captaciones/sources/mercadolibre';

export const maxDuration = 300;

// Cuántos anuncios se procesan a la vez. Cada uno son 2 llamadas al LLM; en
// serie un digest de 20 no cabe en maxDuration, y todos a la vez arriesga
// rate-limits.
const CONCURRENCIA = 4;

interface Cuerpo {
  asunto?: string;
  subject?: string;
  html?: string;
  texto?: string;
  text?: string;
  from?: string;
  inmobiliaria_id?: string;
}

function inferirFuente(url: string | null): FuenteCaptacion {
  if (!url) return 'otro';
  if (esUrlMercadoLibre(url)) return 'mercadolibre';
  if (/facebook\.com|fb\.com|fb\.me/i.test(url)) return 'facebook';
  return 'otro';
}

export async function POST(request: Request) {
  const token = request.headers.get('x-webhook-token');
  if (!token || !process.env.CAPTACIONES_WEBHOOK_TOKEN || token !== process.env.CAPTACIONES_WEBHOOK_TOKEN) {
    return Response.json({ estado: 'error', error: 'No autorizado' }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ estado: 'error', error: 'Falta configurar OPENAI_API_KEY' }, { status: 500 });
  }

  const cuerpo: Cuerpo | null = await request.json().catch(() => null);
  if (!cuerpo) return Response.json({ estado: 'error', error: 'Body inválido' }, { status: 400 });

  const inmobiliariaId = cuerpo.inmobiliaria_id || process.env.CUMBRES_INMOBILIARIA_ID;
  if (!inmobiliariaId) {
    return Response.json({ estado: 'error', error: 'Falta inmobiliaria_id' }, { status: 400 });
  }

  const asunto = cuerpo.asunto ?? cuerpo.subject;
  const html = cuerpo.html;
  const texto = cuerpo.texto ?? cuerpo.text;
  if (!html && !texto) {
    return Response.json({ estado: 'error', error: 'Manda el html o el texto del correo.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Kill switch: sin fila = activo
  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();
  if (config && !config.activo) {
    return Response.json({ estado: 'pausado', error: 'El agente de captaciones está pausado.' }, { status: 409 });
  }

  // --- 1) Sacar los anuncios del correo ---
  let extraccion;
  try {
    extraccion = await extraerAnunciosDeCorreo({ asunto, html, texto });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Captaciones/email] Error extrayendo anuncios:', msg);
    return Response.json({ estado: 'error', error: msg }, { status: 500 });
  }
  await registrarUso(supabase, inmobiliariaId, null, extraccion.uso);

  if (!extraccion.esAlerta || extraccion.anuncios.length === 0) {
    return Response.json({
      estado: 'ok',
      es_alerta: extraccion.esAlerta,
      anuncios_detectados: 0,
      mensaje: extraccion.esAlerta
        ? 'Es una alerta pero no traía anuncios nuevos.'
        : 'El correo no parece una alerta de inmuebles; se ignoró.',
    });
  }

  // --- 2) Cada anuncio por el grafo (en tandas) ---
  const resumen = { creados: 0, duplicados: 0, descartados: 0, fallidos: 0 };
  const detalle: Array<{ titulo: string; resultado: string; prospecto_id: string | null; motivo: string | null }> = [];

  const procesar = async (a: (typeof extraccion.anuncios)[number]) => {
    try {
      const fuente = inferirFuente(a.url);
      let listing: ListingCrudo = listingVacio(fuente);

      // Mercado Libre: los datos oficiales le ganan a lo que diga el correo.
      if (fuente === 'mercadolibre' && a.url) {
        const itemId = extraerItemId(a.url);
        if (itemId) {
          try {
            listing = await enriquecerItem(supabase, inmobiliariaId, itemId);
          } catch (e) {
            console.warn('[Captaciones/email] No se pudo enriquecer con ML:', e);
          }
        }
      }

      listing.url = a.url ?? listing.url;
      listing.fuente_id = listing.fuente_id ?? a.url ?? null;
      listing.titulo = listing.titulo || a.titulo;
      listing.precio = listing.precio ?? a.precio;
      listing.ciudad = listing.ciudad ?? a.ciudad;
      listing.barrio = listing.barrio ?? a.barrio;
      listing.area_m2 = listing.area_m2 ?? a.area_m2;
      listing.habitaciones = listing.habitaciones ?? a.habitaciones;
      listing.contacto_telefono = listing.contacto_telefono ?? a.contacto_telefono;
      listing.contacto_nombre = listing.contacto_nombre ?? a.contacto_nombre;
      // El texto del correo se conserva: trae las señales de "dueño directo"
      // (o de agencia) que el nodo de calificación necesita.
      if (a.detalles) listing.descripcion = `${listing.descripcion}\n${a.detalles}`.trim();

      const salida = await correrCaptacion({ supabase, inmobiliariaId, listing });
      await registrarUso(supabase, inmobiliariaId, salida.prospecto_id, salida.uso);

      if (salida.resultado === 'creado') resumen.creados++;
      else if (salida.resultado === 'duplicado') resumen.duplicados++;
      else resumen.descartados++;

      detalle.push({
        titulo: a.titulo,
        resultado: salida.resultado,
        prospecto_id: salida.prospecto_id,
        motivo: salida.motivo,
      });
    } catch (e) {
      resumen.fallidos++;
      console.error('[Captaciones/email] Falló un anuncio:', a.titulo, e);
      detalle.push({ titulo: a.titulo, resultado: 'error', prospecto_id: null, motivo: e instanceof Error ? e.message : String(e) });
    }
  };

  for (let i = 0; i < extraccion.anuncios.length; i += CONCURRENCIA) {
    await Promise.all(extraccion.anuncios.slice(i, i + CONCURRENCIA).map(procesar));
  }

  return Response.json({
    estado: 'ok',
    es_alerta: true,
    anuncios_detectados: extraccion.anuncios.length,
    // Nunca truncar en silencio: si el correo traía más del tope, se reporta.
    recortados: extraccion.recortados,
    aviso_recorte:
      extraccion.recortados > 0
        ? `El correo traía más de ${MAX_ANUNCIOS_POR_CORREO} anuncios; ${extraccion.recortados} quedaron sin procesar.`
        : undefined,
    ...resumen,
    detalle,
  });
}
