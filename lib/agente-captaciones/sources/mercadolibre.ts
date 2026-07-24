// Fuente Mercado Libre — ENRIQUECEDOR (no buscador).
//
// ⚠️ IMPORTANTE: Mercado Libre CERRÓ la búsqueda pública. `GET /sites/{site}/search`
// devuelve 403 forbidden en todas sus variantes (incluso filtrando por el
// seller_id propio) pese a token OAuth válido y scopes correctos — política de
// ML desde ~abril 2025, verificado en vivo el 22/jul/2026. Por eso este módulo
// NO descubre listings: el descubrimiento se hace por navegador supervisado o
// intake asistido (pegar URL).
//
// Lo que SÍ sigue abierto y usamos aquí: consultar un ítem por id
// (`/items/{id}`, `/items?ids=`), que devuelve datos oficiales y estructurados
// (precio, ubicación, atributos, vendedor) — mucho mejor que leer el HTML.

import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerAccessTokenValido } from '../mercadolibre/oauth';
import { type ListingCrudo, listingVacio } from '../tipos';

const API = 'https://api.mercadolibre.com';

/**
 * Extrae el id de ítem (p. ej. MCO1234567890) de una URL de Mercado Libre.
 * Soporta los formatos habituales: articulo.mercadolibre.com.co/MCO-123-titulo,
 * /p/MCO123, y el id suelto. Devuelve null si no reconoce ninguno.
 */
export function extraerItemId(urlOTexto: string): string | null {
  if (!urlOTexto) return null;
  const m = urlOTexto.toUpperCase().match(/\bMCO-?(\d{6,})\b/);
  return m ? `MCO${m[1]}` : null;
}

export function esUrlMercadoLibre(url: string): boolean {
  return /mercadolibre\.com/i.test(url) || extraerItemId(url) !== null;
}

async function get(url: string, token: string): Promise<any> {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const detalle = body ? JSON.stringify(body) : `HTTP ${r.status}`;
    throw new Error(`Mercado Libre (${r.status}): ${detalle}`);
  }
  return body;
}

function numeroDe(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Trae un ítem de Mercado Libre por id y lo mapea a ListingCrudo.
 * La descripción va en un endpoint aparte y es best-effort (si falla, se omite).
 */
export async function enriquecerItem(
  supabaseAdmin: SupabaseClient,
  inmobiliariaId: string,
  itemId: string
): Promise<ListingCrudo> {
  const token = await obtenerAccessTokenValido(supabaseAdmin, inmobiliariaId);
  const item = await get(`${API}/items/${itemId}`, token);

  let descripcion = '';
  try {
    const d = await get(`${API}/items/${itemId}/description`, token);
    descripcion = d?.plain_text ?? d?.text ?? '';
  } catch {
    // sin descripción: el grafo califica igual con título + atributos
  }

  const attrs: Record<string, string> = {};
  for (const a of item?.attributes ?? []) {
    if (a?.id) attrs[a.id] = a?.value_name ?? a?.value_id ?? '';
  }

  const loc = item?.location ?? item?.seller_address ?? {};
  const listing = listingVacio('mercadolibre');
  listing.fuente_id = String(item?.id ?? itemId);
  listing.url = item?.permalink ?? null;
  listing.titulo = item?.title ?? '';
  listing.descripcion = descripcion;
  listing.precio = numeroDe(item?.price);
  listing.moneda = item?.currency_id ?? null;
  listing.ciudad = loc?.city?.name ?? loc?.city ?? null;
  listing.barrio = loc?.neighborhood?.name ?? loc?.neighborhood ?? null;
  listing.direccion = loc?.address_line ?? null;
  listing.area_m2 = numeroDe(attrs.COVERED_AREA ?? attrs.TOTAL_AREA);
  listing.habitaciones = numeroDe(attrs.BEDROOMS ?? attrs.ROOMS);
  listing.banos = numeroDe(attrs.FULL_BATHROOMS ?? attrs.BATHROOMS);
  listing.tipo_inmueble = attrs.PROPERTY_TYPE ?? null;
  listing.tipo_transaccion = attrs.OPERATION ?? null;
  listing.atributos = attrs;
  listing.crudo = item;

  return listing;
}
