// Procesamiento por lotes de anuncios ya extraídos (de un correo de alerta, de
// un recorrido de navegador supervisado, o pegados a mano). Cada anuncio se
// enriquece si es de Mercado Libre y se pasa por el grafo.
//
// Vive aparte para que las rutas de intake no dupliquen esta lógica.

import type { SupabaseClient } from '@supabase/supabase-js';
import { correrCaptacion } from './graph';
import { registrarUso } from './uso';
import { listingVacio, type FuenteCaptacion, type ListingCrudo } from './tipos';
import { obtenerDescripcion, extraerItemId, esUrlMercadoLibre } from './sources/mercadolibre';

// Cuántos anuncios se procesan a la vez. Cada uno son 2 llamadas al LLM: en
// serie un lote grande no cabe en maxDuration, y todos a la vez arriesga
// rate-limits.
const CONCURRENCIA = 4;

export interface AnuncioEntrante {
  url: string | null;
  titulo: string;
  precio?: number | null;
  ciudad?: string | null;
  barrio?: string | null;
  area_m2?: number | null;
  habitaciones?: number | null;
  banos?: number | null;
  descripcion?: string | null;
  contacto_nombre?: string | null;
  contacto_telefono?: string | null;
  contacto_perfil?: string | null;
  fuente?: FuenteCaptacion;
  /**
   * true si el anuncio viene de un listado que la plataforma ya filtró por
   * "dueño directo" (p. ej. .../directo/ en Mercado Libre). Ver ListingCrudo.
   */
  fuente_marca_dueno_directo?: boolean | null;
}

interface ResumenLote {
  creados: number;
  duplicados: number;
  descartados: number;
  fallidos: number;
  detalle: Array<{
    titulo: string;
    resultado: string;
    prospecto_id: string | null;
    motivo: string | null;
    /** Veredicto del calificador, para poder mostrarlo al importar. */
    es_dueno_directo?: boolean | null;
    /** 1 = seguro dueño directo · 0 = seguro agencia. */
    probabilidad_dueno_directo?: number | null;
    score?: number | null;
  }>;
}

function inferirFuente(url: string | null | undefined): FuenteCaptacion {
  if (!url) return 'otro';
  if (esUrlMercadoLibre(url)) return 'mercadolibre';
  if (/facebook\.com|fb\.com|fb\.me/i.test(url)) return 'facebook';
  return 'otro';
}

export async function procesarAnuncios(
  supabase: SupabaseClient,
  inmobiliariaId: string,
  anuncios: AnuncioEntrante[]
): Promise<ResumenLote> {
  const resumen: ResumenLote = { creados: 0, duplicados: 0, descartados: 0, fallidos: 0, detalle: [] };

  const procesar = async (a: AnuncioEntrante) => {
    try {
      const fuente = a.fuente ?? inferirFuente(a.url);
      const listing: ListingCrudo = listingVacio(fuente);

      // Sin contenido real no se puede calificar nada: calificar una ficha
      // vacía siempre da "descartar", y peor aún, deja una fila 'descartado'
      // que luego el dedup toma por vista y bloquea el reintento. Pasó de
      // verdad: 11 anuncios reales de ML quedaron descartados porque el
      // enriquecimiento falló y se procesaron con el título de relleno.
      const tieneContenido = Boolean((a.titulo && a.titulo.trim().length > 3) || a.descripcion?.trim());
      if (!tieneContenido) {
        resumen.fallidos++;
        resumen.detalle.push({
          titulo: a.titulo || '(sin título)',
          resultado: 'error',
          prospecto_id: null,
          motivo: 'El anuncio llegó sin título ni descripción utilizables; no se califica para no ensuciar el CRM.',
        });
        return;
      }

      // Mercado Libre: la API solo entrega la DESCRIPCIÓN de publicaciones
      // ajenas (el resto da 403). Los datos estructurados los trae el caller.
      if (fuente === 'mercadolibre' && a.url) {
        const itemId = extraerItemId(a.url);
        if (itemId) {
          const desc = await obtenerDescripcion(supabase, inmobiliariaId, itemId);
          if (desc) listing.descripcion = desc;
        }
      }

      listing.url = a.url ?? listing.url;
      listing.fuente_id = listing.fuente_id ?? a.url ?? null;
      listing.titulo = listing.titulo || a.titulo;
      listing.precio = listing.precio ?? a.precio ?? null;
      listing.ciudad = listing.ciudad ?? a.ciudad ?? null;
      listing.barrio = listing.barrio ?? a.barrio ?? null;
      listing.area_m2 = listing.area_m2 ?? a.area_m2 ?? null;
      listing.habitaciones = listing.habitaciones ?? a.habitaciones ?? null;
      listing.banos = listing.banos ?? a.banos ?? null;
      listing.contacto_nombre = listing.contacto_nombre ?? a.contacto_nombre ?? null;
      listing.contacto_telefono = listing.contacto_telefono ?? a.contacto_telefono ?? null;
      listing.contacto_perfil = listing.contacto_perfil ?? a.contacto_perfil ?? null;
      listing.fuente_marca_dueno_directo = a.fuente_marca_dueno_directo ?? null;
      // La descripción es donde viven las señales de "dueño directo" (o de
      // agencia): se conserva completa, no se resume.
      if (a.descripcion) listing.descripcion = `${listing.descripcion}\n${a.descripcion}`.trim();

      const salida = await correrCaptacion({ supabase, inmobiliariaId, listing });
      await registrarUso(supabase, inmobiliariaId, salida.prospecto_id, salida.uso);

      if (salida.resultado === 'creado') resumen.creados++;
      else if (salida.resultado === 'duplicado') resumen.duplicados++;
      else resumen.descartados++;

      resumen.detalle.push({
        titulo: a.titulo,
        resultado: salida.resultado,
        prospecto_id: salida.prospecto_id,
        motivo: salida.motivo,
        es_dueno_directo: salida.calificacion?.es_dueno_directo ?? null,
        probabilidad_dueno_directo: salida.calificacion?.probabilidad_dueno_directo ?? null,
        score: salida.calificacion?.score ?? null,
      });
    } catch (e) {
      resumen.fallidos++;
      console.error('[Captaciones] Falló un anuncio:', a.titulo, e);
      resumen.detalle.push({
        titulo: a.titulo,
        resultado: 'error',
        prospecto_id: null,
        motivo: e instanceof Error ? e.message : String(e),
      });
    }
  };

  for (let i = 0; i < anuncios.length; i += CONCURRENCIA) {
    await Promise.all(anuncios.slice(i, i + CONCURRENCIA).map(procesar));
  }
  return resumen;
}
