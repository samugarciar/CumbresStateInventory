import { getNubyConfig, obtenerTokenJWT } from '@/lib/nuby';

// Cliente de SOLO LECTURA del ERP Nuby/Arrendasoft para el Asesor BI.
// Docs: https://docs.nuby.ai/books/api-nuby-v2
// La API también tiene endpoints de escritura (crear propiedad, actualizar
// estado, registrar pago); a propósito NO se exponen aquí.

// El JWT de Nuby dura 1 hora; se cachea 50 min por instancia serverless.
let _token: { valor: string; expira: number } | null = null;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _token.expira) return _token.valor;
  const jwt = await obtenerTokenJWT(getNubyConfig());
  _token = { valor: jwt, expira: Date.now() + 50 * 60 * 1000 };
  return jwt;
}

export type RecursoERP =
  | 'propiedades'
  | 'propiedad'
  | 'contratos'
  | 'facturas'
  | 'asesores'
  | 'estados'
  | 'auxiliar_contable';

interface ParamsERP {
  pagina?: number;
  por_pagina?: number;
  codigo?: number | string; // para 'propiedad'
  fecha_ini?: string; // para 'auxiliar_contable' (YYYY-MM-DD)
  fecha_fin?: string;
  cuenta_ini?: string; // clase PUC 1-9
  cuenta_fin?: string;
}

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function rutaYQuery(recurso: RecursoERP, p: ParamsERP): { ruta: string; query: URLSearchParams } {
  const query = new URLSearchParams();
  const pagina = String(p.pagina ?? 1);

  switch (recurso) {
    case 'propiedades':
      query.set('page', pagina);
      query.set('limit', String(p.por_pagina ?? 100));
      query.set('page_size', String(p.por_pagina ?? 100));
      return { ruta: '/service/v2/public/properties', query };
    case 'propiedad':
      if (p.codigo === undefined) throw new Error("El recurso 'propiedad' requiere el parámetro codigo.");
      return { ruta: `/service/v2/public/properties/${p.codigo}`, query };
    case 'contratos':
      query.set('page', pagina);
      query.set('page_size', String(p.por_pagina ?? 1000));
      return { ruta: '/service/v2/public/contracts/list', query };
    case 'facturas':
      query.set('page', pagina);
      query.set('page_size', String(p.por_pagina ?? 1000));
      return { ruta: '/service/v2/public/invoices/list', query };
    case 'asesores':
      return { ruta: '/service/v2/public/agents', query };
    case 'estados':
      return { ruta: '/service/v2/public/masters/properties/states', query };
    case 'auxiliar_contable':
      if (p.fecha_ini) query.set('fecha_ini', p.fecha_ini);
      if (p.fecha_fin) query.set('fecha_fin', p.fecha_fin);
      if (p.cuenta_ini) query.set('cuenta_ini', p.cuenta_ini);
      if (p.cuenta_fin) query.set('cuenta_fin', p.cuenta_fin);
      return { ruta: '/service/v2/public/accounting/general-ledger', query };
  }
}

/**
 * GET a la API pública de Nuby. Desencapsula {status, message, body} de forma
 * resiliente (igual que el sync en lib/nuby.ts) y propaga errores declarados.
 */
export async function consultaERP(recurso: RecursoERP, params: ParamsERP = {}): Promise<unknown> {
  const { instancia } = getNubyConfig();
  const { ruta, query } = rutaYQuery(recurso, params);
  const token = await getToken();

  const url = `https://${instancia}${ruta}${query.size ? `?${query}` : ''}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`El ERP devolvió ${res.status} para ${recurso} (${ruta}).`);
  }

  const datos = await res.json();
  if (Array.isArray(datos)) return datos;
  if (datos && typeof datos === 'object') {
    if (datos.error === true) throw new Error(`Error del ERP: ${datos.message || 'desconocido'}`);
    return datos.body ?? datos.data ?? datos;
  }
  return datos;
}
