// Procesamiento por lotes de anuncios ya extraídos (de un correo de alerta, de
// un recorrido de navegador supervisado, o pegados a mano). Cada anuncio se
// enriquece si es de Mercado Libre y se pasa por el grafo.
//
// Vive aparte para que las rutas de intake no dupliquen esta lógica.

import type { SupabaseClient } from '@supabase/supabase-js';
import { correrCaptacion } from './graph';
import { registrarUso } from './uso';
import { listingVacio, type FuenteCaptacion, type ListingCrudo } from './tipos';
import { enriquecerItem, extraerItemId, esUrlMercadoLibre } from './sources/mercadolibre';

// Cuántos anuncios se procesan a la vez. Cada uno son 2 llamadas al LLM: en
// serie un lote grande no cabe en maxDuration, y todos a la vez arriesga
// rate-limits.
export const CONCURRENCIA = 4;

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
}

export interface ResumenLote {
  creados: number;
  duplicados: number;
  descartados: number;
  fallidos: number;
  detalle: Array<{
    titulo: string;
    resultado: string;
    prospecto_id: string | null;
    motivo: string | null;
  }>;
}

export function inferirFuente(url: string | null | undefined): FuenteCaptacion {
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
      let listing: ListingCrudo = listingVacio(fuente);

      // Mercado Libre: los datos oficiales le ganan a lo que se haya extraído.
      if (fuente === 'mercadolibre' && a.url) {
        const itemId = extraerItemId(a.url);
        if (itemId) {
          try {
            listing = await enriquecerItem(supabase, inmobiliariaId, itemId);
          } catch (e) {
            console.warn('[Captaciones] No se pudo enriquecer con ML:', e);
          }
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
