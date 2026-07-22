// Cliente de búsqueda de Mercado Libre (site MCO) para el agente de captaciones.
// La búsqueda pública /sites/MCO/search EXIGE token Bearer (ML devuelve 403 a
// peticiones anónimas) → usamos obtenerAccessTokenValido().
//
// FILTROS: ML expone los filtros válidos (operación, tipo, "dueño directo",
// ubicación) en `available_filters` del propio response, con ids que dependen
// del sitio. No los adivinamos: la búsqueda base usa `q` (texto libre de la
// zona) + category=MCO1459, que YA trae resultados reales, y la calificación
// fina (apartamento / venta / particular) la hace el grafo. Para estrechar
// server-side, corre explorarFiltros() UNA vez tras conectar ML y fija los ids
// exactos en FILTROS_ML. Ver TODO.

import type { SupabaseClient } from '@supabase/supabase-js';
import { obtenerAccessTokenValido } from '../mercadolibre/oauth';

const SITE_ID = 'MCO';
const CATEGORIA_INMUEBLES = 'MCO1459';
const API = 'https://api.mercadolibre.com';

// Shape crudo normalizado que consumirá el grafo (nodo normalize).
export interface ListingCrudo {
  fuente: 'mercadolibre';
  fuente_id: string;
  url: string;
  titulo: string;
  precio: number | null;
  moneda: string | null;
  ciudad: string | null;
  barrio: string | null;
  direccion: string | null;
  atributos: Record<string, string>; // id de atributo -> value_name
  vendedor: { id?: string | number; tipo?: string; nickname?: string } | null;
  crudo: unknown; // el item completo, por si el grafo necesita más
}

// TODO (tras conectar ML): correr explorarFiltros() y fijar aquí los ids
// exactos — operación=Venta, tipo=Apartamento, "dueño directo", y ubicación
// (state/city de Antioquia/Medellín/Bello). Mientras estén vacíos, la
// calificación la hace el grafo sobre los resultados de `q`.
export const FILTROS_ML: Record<string, string> = {
  // OPERATION: '242075',
  // PROPERTY_TYPE: '...',
  // OWNER: 'yes',          // "dueño directo"
  // state: 'TUxDUEFO...',  // Antioquia
};

export interface OpcionesBusqueda {
  zonas: string[]; // p. ej. ['Robledo', 'Bello']
  tipo?: string; // p. ej. 'apartamento'
  operacion?: string; // p. ej. 'venta'
  limit?: number;
  offset?: number;
  filtrosExtra?: Record<string, string>;
}

function mapearItem(item: any): ListingCrudo {
  const attrs: Record<string, string> = {};
  for (const a of item?.attributes ?? []) {
    if (a?.id) attrs[a.id] = a?.value_name ?? a?.value_id ?? '';
  }
  const loc = item?.location ?? item?.address ?? {};
  return {
    fuente: 'mercadolibre',
    fuente_id: String(item?.id ?? ''),
    url: item?.permalink ?? '',
    titulo: item?.title ?? '',
    precio: typeof item?.price === 'number' ? item.price : null,
    moneda: item?.currency_id ?? null,
    ciudad: loc?.city?.name ?? loc?.city ?? null,
    barrio: loc?.neighborhood?.name ?? loc?.neighborhood ?? null,
    direccion: loc?.address_line ?? null,
    atributos: attrs,
    vendedor: item?.seller
      ? { id: item.seller.id, nickname: item.seller.nickname, tipo: item.seller?.seller_type }
      : null,
    crudo: item,
  };
}

async function fetchML(url: string, token: string): Promise<any> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const detalle = data ? JSON.stringify(data) : `HTTP ${resp.status}`;
    throw new Error(`Mercado Libre search falló (${resp.status}): ${detalle}`);
  }
  return data;
}

/**
 * Busca inmuebles en Mercado Libre para las zonas dadas. Hace una búsqueda por
 * zona (texto libre, para no depender de ids de ubicación) y devuelve listings
 * crudos normalizados, deduplicados por fuente_id dentro de esta corrida.
 */
export async function buscarInmuebles(
  supabaseAdmin: SupabaseClient,
  inmobiliariaId: string,
  opciones: OpcionesBusqueda
): Promise<ListingCrudo[]> {
  const token = await obtenerAccessTokenValido(supabaseAdmin, inmobiliariaId);
  const limit = opciones.limit ?? 50;
  const resultados: ListingCrudo[] = [];
  const vistos = new Set<string>();

  for (const zona of opciones.zonas) {
    const terminoBusqueda = [opciones.tipo, opciones.operacion, zona, 'Medellín']
      .filter(Boolean)
      .join(' ');
    const params = new URLSearchParams({
      category: CATEGORIA_INMUEBLES,
      q: terminoBusqueda,
      limit: String(limit),
      offset: String(opciones.offset ?? 0),
    });
    for (const [k, v] of Object.entries({ ...FILTROS_ML, ...(opciones.filtrosExtra ?? {}) })) {
      params.set(k, v);
    }

    const data = await fetchML(`${API}/sites/${SITE_ID}/search?${params.toString()}`, token);
    for (const item of data?.results ?? []) {
      const c = mapearItem(item);
      if (c.fuente_id && !vistos.has(c.fuente_id)) {
        vistos.add(c.fuente_id);
        resultados.push(c);
      }
    }
  }
  return resultados;
}

/**
 * Diagnóstico: devuelve los `available_filters` (y los `filters` aplicados) de
 * una búsqueda en la categoría Inmuebles, para descubrir los ids exactos de
 * operación, tipo, "dueño directo" y ubicación y fijarlos en FILTROS_ML.
 * Correr UNA vez tras conectar Mercado Libre (necesita token).
 */
export async function explorarFiltros(
  supabaseAdmin: SupabaseClient,
  inmobiliariaId: string,
  q = 'apartamento venta Robledo Medellín'
): Promise<{ available_filters: unknown; filters: unknown; total: number }> {
  const token = await obtenerAccessTokenValido(supabaseAdmin, inmobiliariaId);
  const params = new URLSearchParams({ category: CATEGORIA_INMUEBLES, q, limit: '1' });
  const data = await fetchML(`${API}/sites/${SITE_ID}/search?${params.toString()}`, token);
  return {
    available_filters: data?.available_filters ?? [],
    filters: data?.filters ?? [],
    total: data?.paging?.total ?? 0,
  };
}
