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
  | 'buscar_factura'
  | 'cartera_resumen'
  | 'buscar_contrato'
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
  con_detalles?: boolean; // auxiliar_contable: incluir los movimientos por tercero
  // Filtros para buscar_factura / buscar_contrato (la API no soporta
  // filtrar server-side; se recorre todo el listado y se filtra aquí).
  documento?: string;
  contrato_numero?: string | number;
  nombre_contiene?: string;
}

// ---- Proyecciones compactas (eficiencia de tokens) ----
// Cada resultado de herramienta se re-envía al modelo en TODAS las
// iteraciones siguientes del bucle agéntico, así que cada campo inútil se
// paga muchas veces. Se proyecta aquí lo que el BI realmente usa; la ficha
// completa sigue disponible (recurso 'propiedad' por código, o
// con_detalles=true en auxiliar_contable).

function facturaCompacta(f: any) {
  return {
    factura_numero: f.factura_numero,
    fecha_factura: f.fecha_factura,
    fecha_vencimiento: f.fecha_vencimiento,
    valor_total: parseFloat(f.valor_total) || 0,
    saldo: parseFloat(f.saldo) || 0,
    documento_tercero: f.documento_tercero,
    nombre_tercero: f.nombre_tercero,
    estado: f.estado,
    contrato_numero: f.detalles?.[0]?.contrato_numero ?? null,
    concepto: f.detalles?.[0]?.producto ?? null,
  };
}

function contratoCompacto(c: any) {
  if (!c || typeof c !== 'object') return c;
  const { observaciones, ...resto } = c;
  return {
    ...resto,
    observaciones:
      typeof observaciones === 'string' && observaciones.length > 140
        ? observaciones.slice(0, 140) + '…'
        : observaciones ?? null,
  };
}

function propiedadCompacta(p: any) {
  if (!p || typeof p !== 'object') return p;
  const caract = (fragmento: string) => {
    const item = Array.isArray(p.caracteristicas)
      ? p.caracteristicas.find(
          (c: any) => typeof c?.descripcion === 'string' && c.descripcion.toLowerCase().includes(fragmento)
        )
      : undefined;
    const v = item?.valor;
    return v && v !== '-1' ? v : null;
  };
  return {
    codigo: p.codigo,
    titulo: p.titulo,
    clase_inmueble: p.clase_inmueble,
    tipo_servicio: p.tipo_servicio,
    asesor: p.asesor,
    estado: p.estado,
    estado_texto: p.estado_texto,
    valor_arriendo1: p.valor_arriendo1,
    valor_venta1: p.valor_venta1,
    municipio: p.municipio,
    barrio: p.barrio,
    direccion: p.direccion,
    area: p.area,
    estrato_texto: p.estrato_texto,
    habitaciones: caract('habitacion'),
    banos: caract('baño'),
  };
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
      // 100 por defecto (no 1000): el listado crudo es solo para "ver recientes";
      // buscar/agregar se hace con buscar_factura / cartera_resumen.
      query.set('page_size', String(p.por_pagina ?? 100));
      return { ruta: '/service/v2/public/invoices/list', query };
    case 'asesores':
      return { ruta: '/service/v2/public/agents', query };
    case 'estados':
      return { ruta: '/service/v2/public/masters/properties/states', query };
    case 'auxiliar_contable':
      if (p.fecha_ini) query.set('fecha_ini', p.fecha_ini);
      if (p.fecha_fin) query.set('fecha_fin', p.fecha_fin);
      if (p.cuenta_ini) query.set('cuenta_ini', p.cuenta_ini);
      // El ERP compara los códigos de cuenta LEXICOGRÁFICAMENTE como texto:
      // cuenta_fin='4' excluye '41050501' ("41050501" > "4" como string), por
      // eso "clase 4 a 4" devolvía vacío. Rellenar con 9s convierte cuenta_fin
      // en "todo lo que empiece por ese prefijo" (verificado contra la API).
      if (p.cuenta_fin) query.set('cuenta_fin', String(p.cuenta_fin).padEnd(12, '9'));
      return { ruta: '/service/v2/public/accounting/general-ledger', query };
    case 'buscar_factura':
    case 'cartera_resumen':
    case 'buscar_contrato':
      // Se resuelven aparte (fetchTodasLasPaginas + filtro); no van por acá.
      throw new Error(`${recurso} no usa rutaYQuery`);
  }
}

/** GET de una sola página, con reintentos cortos ante hipos del WAF delante del ERP. */
async function fetchPagina(ruta: string, query: URLSearchParams, intentos = 2): Promise<any> {
  const { instancia } = getNubyConfig();
  const token = await getToken();
  const url = `https://${instancia}${ruta}${query.size ? `?${query}` : ''}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': UA };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let ultimoError: unknown;
  for (let intento = 0; intento < intentos; intento++) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (res.ok) return await res.json();
      if (![429, 500, 502, 503, 504].includes(res.status) || intento === intentos - 1) {
        throw new Error(`El ERP devolvió ${res.status} para ${ruta}.`);
      }
      ultimoError = new Error(`El ERP devolvió ${res.status} para ${ruta}.`);
    } catch (error) {
      ultimoError = error;
    }
    await new Promise((r) => setTimeout(r, 400 * (intento + 1)));
  }
  throw ultimoError instanceof Error ? ultimoError : new Error(String(ultimoError));
}

const TAMANO_PAGINA_ESCANEO = 1000; // máximo permitido por la API
const MAX_PAGINAS_ESCANEO = 25; // cota de seguridad (~25.000 registros; hoy hay ~18.5k facturas)
const CONCURRENCIA_ESCANEO = 4;

interface ResultadoEscaneo {
  registros: any[];
  totalRevisados: number;
  totalReportadoPorAPI: number;
  limiteAlcanzado: boolean;
}

/**
 * Recorre TODAS las páginas de un listado paginado (facturas/contratos) y
 * acumula los registros. La API no soporta filtrar por documento/contrato,
 * así que esta es la única forma confiable de "buscar" en vez de hojear a
 * ciegas la página 1 (que es lo que fallaba antes: con miles de facturas,
 * la página 1 rara vez contiene a la persona buscada).
 */
async function fetchTodasLasPaginas(ruta: string): Promise<ResultadoEscaneo> {
  const primera = new URLSearchParams({ page: '1', page_size: String(TAMANO_PAGINA_ESCANEO), limit: String(TAMANO_PAGINA_ESCANEO) });
  const p1 = await fetchPagina(ruta, primera);
  const registros: any[] = Array.isArray(p1.body) ? [...p1.body] : [];
  const totalPaginas: number = p1.pagination?.total_pages ?? 1;
  const totalReportadoPorAPI: number = p1.pagination?.total_records ?? registros.length;
  const limiteAlcanzado = totalPaginas > MAX_PAGINAS_ESCANEO;
  const ultimaPagina = Math.min(totalPaginas, MAX_PAGINAS_ESCANEO);

  const pendientes: number[] = [];
  for (let pg = 2; pg <= ultimaPagina; pg++) pendientes.push(pg);

  while (pendientes.length > 0) {
    const lote = pendientes.splice(0, CONCURRENCIA_ESCANEO);
    const resultados = await Promise.all(
      lote.map((pg) =>
        fetchPagina(
          ruta,
          new URLSearchParams({ page: String(pg), page_size: String(TAMANO_PAGINA_ESCANEO), limit: String(TAMANO_PAGINA_ESCANEO) })
        )
      )
    );
    for (const r of resultados) if (Array.isArray(r.body)) registros.push(...r.body);
  }

  return { registros, totalRevisados: registros.length, totalReportadoPorAPI, limiteAlcanzado };
}

/**
 * Normaliza un documento a su tira de dígitos más larga:
 * "1.054.986.516" → "1054986516" (quita separadores de miles),
 * "[1] 1000902076 - NATALIA..." → "1000902076" (ignora el índice [1]).
 */
function soloDigitos(valor?: string | number | null): string | undefined {
  if (valor === undefined || valor === null) return undefined;
  const sinSeparadores = String(valor).replace(/(?<=\d)[.,](?=\d)/g, '');
  const corridas = sinSeparadores.match(/\d{4,}/g);
  if (!corridas) return undefined;
  return corridas.reduce((a, b) => (b.length > a.length ? b : a));
}

function diagnostico(r: ResultadoEscaneo) {
  return {
    total_registros_en_erp: r.totalReportadoPorAPI,
    registros_revisados: r.totalRevisados,
    limite_de_escaneo_alcanzado: r.limiteAlcanzado, // si es true, el resultado puede estar incompleto
  };
}

async function buscarFactura(p: ParamsERP) {
  const documento = soloDigitos(p.documento);
  const contratoNumero = p.contrato_numero !== undefined ? String(p.contrato_numero) : undefined;
  const nombreBuscado = p.nombre_contiene?.toLowerCase().trim();
  if (!documento && !contratoNumero && !nombreBuscado) {
    throw new Error('buscar_factura requiere al menos uno de: documento, contrato_numero, nombre_contiene.');
  }

  const escaneo = await fetchTodasLasPaginas('/service/v2/public/invoices/list');
  const coincidencias = escaneo.registros.filter((f) => {
    if (documento && soloDigitos(f.documento_tercero) === documento) return true;
    if (contratoNumero && Array.isArray(f.detalles)) {
      // Igual que en buscar_contrato: SOLO detalles[].contrato_numero (el
      // consecutivo que usa el personal). NUNCA detalles[].contrato_id: es la
      // clave interna y puede coincidir por casualidad con el consecutivo de
      // OTRO contrato (así se coló una factura ajena en una búsqueda real).
      if (f.detalles.some((d: any) => String(d.contrato_numero) === contratoNumero)) {
        return true;
      }
    }
    if (nombreBuscado && typeof f.nombre_tercero === 'string' && f.nombre_tercero.toLowerCase().includes(nombreBuscado)) {
      return true;
    }
    return false;
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const saldoDe = (f: any) => parseFloat(f.saldo) || 0;
  const conSaldo = coincidencias.filter((f) => saldoDe(f) > 0);
  const vencidas = conSaldo.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < hoy);

  // Tokens: el resumen cubre TODAS las coincidencias; el detalle lista las con
  // saldo primero (lo que importa para cobro) y completa con las más recientes.
  const MAX_FACTURAS_DETALLE = 60;
  const detalle = [...conSaldo, ...coincidencias.filter((f) => saldoDe(f) === 0)].slice(0, MAX_FACTURAS_DETALLE);

  return {
    facturas: detalle.map(facturaCompacta),
    ...(coincidencias.length > MAX_FACTURAS_DETALLE
      ? { nota: `Se listan ${MAX_FACTURAS_DETALLE} de ${coincidencias.length} facturas (todas las con saldo van primero); el resumen cubre todas.` }
      : {}),
    resumen: {
      facturas_encontradas: coincidencias.length,
      facturas_con_saldo: conSaldo.length,
      saldo_total: conSaldo.reduce((a, f) => a + saldoDe(f), 0),
      facturas_vencidas: vencidas.length,
      saldo_vencido: vencidas.reduce((a, f) => a + saldoDe(f), 0),
      // Señal de alerta: en este ERP una deuda puede NO tener factura emitida
      // (la facturación electrónica no siempre cubre la cuenta de cobro). Si
      // la última factura es vieja para un contrato activo mensual, "saldo 0"
      // NO garantiza que esté al día.
      ultima_factura_fecha:
        coincidencias.reduce<string | null>(
          (max, f) => (f.fecha_factura && (!max || f.fecha_factura > max) ? f.fecha_factura : max),
          null
        ),
    },
    diagnostico: diagnostico(escaneo),
  };
}

async function carteraResumen() {
  const escaneo = await fetchTodasLasPaginas('/service/v2/public/invoices/list');
  const hoy = new Date().toISOString().slice(0, 10);
  const saldoDe = (f: any) => parseFloat(f.saldo) || 0;
  const conSaldo = escaneo.registros.filter((f) => saldoDe(f) > 0);
  const vencidas = conSaldo.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < hoy);

  const porTercero = new Map<string, { documento: string; nombre: string; saldo: number; saldo_vencido: number; facturas: number }>();
  for (const f of conSaldo) {
    const key = f.documento_tercero || f.nombre_tercero || 'desconocido';
    const actual = porTercero.get(key) ?? { documento: f.documento_tercero, nombre: f.nombre_tercero, saldo: 0, saldo_vencido: 0, facturas: 0 };
    actual.saldo += saldoDe(f);
    actual.facturas += 1;
    if (f.fecha_vencimiento && f.fecha_vencimiento < hoy) actual.saldo_vencido += saldoDe(f);
    porTercero.set(key, actual);
  }
  const topDeudores = [...porTercero.values()].sort((a, b) => b.saldo - a.saldo).slice(0, 10);

  return {
    facturas_con_saldo: conSaldo.length,
    saldo_total: conSaldo.reduce((a, f) => a + saldoDe(f), 0),
    facturas_vencidas: vencidas.length,
    saldo_vencido: vencidas.reduce((a, f) => a + saldoDe(f), 0),
    top_deudores: topDeudores,
    diagnostico: diagnostico(escaneo),
  };
}

async function buscarContrato(p: ParamsERP) {
  const documento = soloDigitos(p.documento);
  const contratoNumero = p.contrato_numero !== undefined ? String(p.contrato_numero) : undefined;
  const nombreBuscado = p.nombre_contiene?.toLowerCase().trim();
  if (!documento && !contratoNumero && !nombreBuscado) {
    throw new Error('buscar_contrato requiere al menos uno de: documento, contrato_numero, nombre_contiene.');
  }

  // El total de contratos (~585) cabe hoy en una sola página de 1000, pero se
  // recorre igual por si el portafolio crece más allá de esa cota.
  const escaneo = await fetchTodasLasPaginas('/service/v2/public/contracts/list');
  const coincidencias = escaneo.registros.filter((c) => {
    // OJO: contrato_numero matchea SOLO 'consecutivo' (el "número de contrato"
    // que usa el personal y que las facturas referencian en detalles[].contrato_numero),
    // NUNCA 'contrato_id' (clave interna). Los dos son independientes y pueden
    // coincidir por casualidad en contratos distintos — matchear contrato_id
    // devolvería un falso positivo indistinguible del contrato real (así se
    // detectó: contrato_id=333 es de un inquilino, consecutivo=333 es de otro).
    if (contratoNumero && String(c.consecutivo) === contratoNumero) return true;
    if (documento && (soloDigitos(c.inquilino) === documento || soloDigitos(c.propietario) === documento)) return true;
    if (
      nombreBuscado &&
      ((typeof c.inquilino === 'string' && c.inquilino.toLowerCase().includes(nombreBuscado)) ||
        (typeof c.propietario === 'string' && c.propietario.toLowerCase().includes(nombreBuscado)))
    ) {
      return true;
    }
    return false;
  });

  return { contratos: coincidencias.map(contratoCompacto), diagnostico: diagnostico(escaneo) };
}

/** Quita los movimientos por tercero del auxiliar contable (pueden ser enormes). */
function auxiliarSinDetalles(cuentas: any[]): any[] {
  return cuentas.map((cuenta) => ({
    ...cuenta,
    terceros:
      cuenta?.terceros && typeof cuenta.terceros === 'object'
        ? Object.fromEntries(
            Object.entries(cuenta.terceros).map(([id, tercero]) => {
              const { detalles: _omitidos, ...resto } = (tercero ?? {}) as Record<string, unknown>;
              return [id, resto];
            })
          )
        : cuenta?.terceros,
  }));
}

/**
 * GET a la API pública de Nuby. Desencapsula {status, message, body} de forma
 * resiliente (igual que el sync en lib/nuby.ts) y propaga errores declarados.
 *
 * Para 'facturas'/'contratos' expone también la paginación (total_records,
 * has_next_page) en vez de descartarla: sin eso el modelo no tenía forma de
 * saber que un listado de miles de registros seguía después de la página 1.
 */
export async function consultaERP(recurso: RecursoERP, params: ParamsERP = {}): Promise<unknown> {
  if (recurso === 'buscar_factura') return buscarFactura(params);
  if (recurso === 'cartera_resumen') return carteraResumen();
  if (recurso === 'buscar_contrato') return buscarContrato(params);

  const { ruta, query } = rutaYQuery(recurso, params);
  const datos = await fetchPagina(ruta, query);

  // Proyección compacta de los listados crudos (ver comentario arriba).
  const compactar = (registros: any[]): any[] => {
    if (recurso === 'facturas') return registros.map(facturaCompacta);
    if (recurso === 'contratos') return registros.map(contratoCompacto);
    if (recurso === 'propiedades') return registros.map(propiedadCompacta);
    if (recurso === 'auxiliar_contable' && !params.con_detalles) return auxiliarSinDetalles(registros);
    return registros;
  };

  if (Array.isArray(datos)) return compactar(datos);
  if (datos && typeof datos === 'object') {
    if (datos.error === true) throw new Error(`Error del ERP: ${datos.message || 'desconocido'}`);
    if (datos.pagination) return { registros: compactar(datos.body ?? []), paginacion: datos.pagination };
    if (Array.isArray(datos.body)) return compactar(datos.body);
    return datos.body ?? datos.data ?? datos;
  }
  return datos;
}
