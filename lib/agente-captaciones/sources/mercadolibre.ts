// Fuente Mercado Libre — ENRIQUECEDOR de descripción.
//
// ⚠️ QUÉ PERMITE HOY LA API DE ML (verificado en vivo el 27/jul/2026 con token
// válido y scopes read + offline_access):
//
//   GET /users/me ................................. 200  (el token sirve)
//   GET /sites/MCO/search ......................... 403  búsqueda pública CERRADA
//   GET /items/{id}  con id INEXISTENTE ........... 404  ← engaña: el 404 se
//                                                   evalúa ANTES del permiso
//   GET /items/{id}  con id REAL de otro vendedor .. 403  access_denied
//   GET /items?ids={id}  (multiget) ................ 200 con {"code":403} adentro
//   GET /items/{id}/description ................... 200  ✅ SÍ funciona
//
// O sea: ML bloquea los METADATOS de publicaciones ajenas, pero entrega su
// DESCRIPCIÓN. Por eso este módulo ya no intenta traer precio/ubicación/
// atributos por API (daría 403 siempre): esos datos los aporta quien descubre
// el anuncio (navegador supervisado o correo de alerta), y aquí solo sumamos la
// descripción — que es justo donde viven las señales de "dueño directo".

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
 * Trae la DESCRIPCIÓN oficial de una publicación de Mercado Libre.
 * Devuelve null si no se puede (sin conexión de ML, o si algún día cierran
 * también este endpoint): es best-effort, nunca debe tumbar la captación.
 *
 * No intenta traer precio/ubicación/atributos: `GET /items/{id}` responde 403
 * para publicaciones de otros vendedores (ver el bloque de arriba).
 */
export async function obtenerDescripcion(
  supabaseAdmin: SupabaseClient,
  inmobiliariaId: string,
  itemId: string
): Promise<string | null> {
  try {
    const token = await obtenerAccessTokenValido(supabaseAdmin, inmobiliariaId);
    const d = await get(`${API}/items/${itemId}/description`, token);
    const texto = (d?.plain_text ?? d?.text ?? '').trim();
    return texto || null;
  } catch (e) {
    console.warn('[Captaciones/ML] No se pudo traer la descripción de', itemId, e);
    return null;
  }
}
