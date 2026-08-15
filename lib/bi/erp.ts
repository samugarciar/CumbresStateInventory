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
      if (p.codigo === undefined) {
        throw new Error(
          "El recurso 'propiedad' requiere 'codigo' (el código ERP del inmueble). Para obtenerlo NO pagines " +
            "'propiedades' (se trunca y concluirías que no existe): búscalo en la app con consultar_base_datos " +
            '(SELECT arrendasoft_id, titulo, direccion FROM inmuebles WHERE inmobiliaria_id = \'<uuid del contexto>\' ' +
            "AND direccion ILIKE '%…%') y usa ese arrendasoft_id como codigo."
        );
      }
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

/** Distingue "tus parámetros están mal" (4xx) de "el ERP está caído" (5xx).
 *  LangGraph añade "Please fix your mistakes" a TODO error de herramienta, así
 *  que un 503 sin este texto empuja al modelo a reescribir parámetros correctos
 *  en un bucle inútil; y un 404 reportado como caída produce el falso
 *  "incidencia del ERP". */
function errorDeERP(status: number, recurso: string, ruta: string): Error {
  // 401/403 son de credenciales/permisos del conector, NO de los parámetros
  // del modelo: decirle "revisa tus parámetros" lo manda a reescribir una
  // llamada correcta una y otra vez.
  if (status === 401 || status === 403) {
    return new Error(
      `El ERP rechazó la autenticación al consultar '${recurso}' (HTTP ${status}). Es un problema de ` +
        'credenciales o permisos de la integración, NO de tus parámetros: no los cambies ni reintentes. ' +
        'Dilo en tu respuesta como incidencia de configuración y responde con las fuentes que sí tengas.'
    );
  }
  if (status >= 400 && status < 500) {
    return new Error(
      `El recurso '${recurso}' rechazó la petición (HTTP ${status} en ${ruta}). ` +
        'Esto NO es una caída del ERP: revisa tus parámetros y corrígelos.'
    );
  }
  return new Error(
    `El ERP no respondió correctamente al consultar '${recurso}' (HTTP ${status}). ` +
      'Posible incidencia del ERP, NO es un problema de tus parámetros: no los cambies. ' +
      'Reintenta una vez y, si persiste, dilo en tu respuesta sin inventar cifras.'
  );
}

/** GET de una sola página, con reintentos cortos ante hipos del WAF delante del ERP. */
async function fetchPagina(
  ruta: string,
  query: URLSearchParams,
  intentos = 2,
  recurso = 'desconocido'
): Promise<any> {
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
      const error = errorDeERP(res.status, recurso, ruta);
      if (![429, 500, 502, 503, 504].includes(res.status) || intento === intentos - 1) throw error;
      ultimoError = error;
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
async function fetchTodasLasPaginas(ruta: string, recurso = 'listado'): Promise<ResultadoEscaneo> {
  const paginaQuery = (pg: number) =>
    new URLSearchParams({
      page: String(pg),
      page_size: String(TAMANO_PAGINA_ESCANEO),
      limit: String(TAMANO_PAGINA_ESCANEO),
    });

  const p1 = await fetchPagina(ruta, paginaQuery(1), 2, recurso);
  const registros: any[] = Array.isArray(p1.body) ? [...p1.body] : [];

  // Falla RUIDOSA si el endpoint no pagina. Asumir "1 página" aquí sería
  // escanear en silencio solo los primeros 1000 registros y devolver un falso
  // "no encontrado" — justo el fallo que este escaneo existe para evitar.
  // (Verificado: /properties devuelve un array pelado SIN pagination.)
  if (!p1.pagination?.total_pages) {
    throw new Error(
      `El endpoint de '${recurso}' no devolvió información de paginación, así que no se puede garantizar una ` +
        'búsqueda completa sobre todo el histórico. No uses este recurso para buscar; dilo en tu respuesta.'
    );
  }

  const totalPaginas: number = p1.pagination.total_pages;
  const totalReportadoPorAPI: number = p1.pagination.total_records ?? registros.length;
  const limiteAlcanzado = totalPaginas > MAX_PAGINAS_ESCANEO;
  const ultimaPagina = Math.min(totalPaginas, MAX_PAGINAS_ESCANEO);

  const pendientes: number[] = [];
  for (let pg = 2; pg <= ultimaPagina; pg++) pendientes.push(pg);

  while (pendientes.length > 0) {
    const lote = pendientes.splice(0, CONCURRENCIA_ESCANEO);
    const resultados = await Promise.all(lote.map((pg) => fetchPagina(ruta, paginaQuery(pg), 2, recurso)));
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

/** Fecha de HOY en Bogotá (UTC-5, sin DST). Con toISOString(), entre las 19:00
 *  y medianoche local el "hoy" saltaba al día siguiente y las facturas que
 *  vencen hoy se contaban como vencidas. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/** Compara nombres ignorando tildes, mayúsculas y orden de las palabras.
 *  El campo real del ERP es "[1] 52147896 - GUTIERREZ RESTREPO MARIA JOSE",
 *  así que un includes() literal de "maría josé gutiérrez" daba cero. */
function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function hacerCoincidenciaNombre(nombreBuscado: string) {
  const terminos = normalizarNombre(nombreBuscado).split(/\s+/).filter(Boolean);
  return (campo: unknown) => {
    if (typeof campo !== 'string' || terminos.length === 0) return false;
    const normalizado = normalizarNombre(campo);
    return terminos.every((t) => normalizado.includes(t));
  };
}

/** Estados de factura anulada (verificado contra el ERP: existen anuladas con
 *  saldo > 0, que inflarían la deuda de una persona si se suman sin más). */
function esAnulada(f: any): boolean {
  return typeof f?.estado === 'string' && f.estado.toLowerCase().startsWith('anulada');
}

/** Agrupa facturas con saldo por tercero. Sin esto, un saldo_total que abarca
 *  varios terceros (homónimos, o inquilino + propietario del mismo contrato)
 *  se atribuye a una sola persona. */
function agruparPorTercero(facturasConSaldo: any[], hoy: string) {
  const porTercero = new Map<
    string,
    { documento: string; nombre: string; facturas: number; saldo: number; saldo_vencido: number }
  >();
  for (const f of facturasConSaldo) {
    const key = f.documento_tercero || f.nombre_tercero || 'desconocido';
    const actual =
      porTercero.get(key) ?? {
        documento: f.documento_tercero,
        nombre: f.nombre_tercero,
        facturas: 0,
        saldo: 0,
        saldo_vencido: 0,
      };
    const saldo = parseFloat(f.saldo) || 0;
    actual.facturas += 1;
    actual.saldo += saldo;
    if (f.fecha_vencimiento && f.fecha_vencimiento < hoy) actual.saldo_vencido += saldo;
    porTercero.set(key, actual);
  }
  return [...porTercero.values()].sort((a, b) => b.saldo - a.saldo);
}

function diagnostico(r: ResultadoEscaneo) {
  return {
    total_registros_en_erp: r.totalReportadoPorAPI,
    registros_revisados: r.totalRevisados,
    limite_de_escaneo_alcanzado: r.limiteAlcanzado, // si es true, el resultado puede estar incompleto
  };
}

/** Construye las pruebas de filtro comunes a buscar_factura/buscar_contrato.
 *  Se combinan en AND (intersección): pasar dos filtros REFINA la búsqueda.
 *  Antes era OR y ampliarla mezclaba terceros distintos en un mismo saldo. */
function pruebasDeFiltro(
  p: ParamsERP,
  extractores: { documento: (r: any) => string | undefined; contrato: (r: any, n: string) => boolean; nombre: (r: any) => unknown[] }
) {
  const documento = soloDigitos(p.documento);
  const contratoNumero = p.contrato_numero !== undefined ? String(p.contrato_numero).trim() : undefined;
  const nombreBuscado = p.nombre_contiene?.trim();
  const coincideNombre = nombreBuscado ? hacerCoincidenciaNombre(nombreBuscado) : null;

  const pruebas: Array<{ nombre: string; test: (r: any) => boolean }> = [];
  if (documento) pruebas.push({ nombre: 'documento', test: (r) => extractores.documento(r) === documento });
  if (contratoNumero) pruebas.push({ nombre: 'contrato_numero', test: (r) => extractores.contrato(r, contratoNumero) });
  if (coincideNombre) pruebas.push({ nombre: 'nombre_contiene', test: (r) => extractores.nombre(r).some(coincideNombre) });

  return {
    pruebas,
    criterios: {
      documento: documento ?? null,
      contrato_numero: contratoNumero ?? null,
      nombre_contiene: nombreBuscado ?? null,
    },
  };
}

async function buscarFactura(p: ParamsERP) {
  const { pruebas, criterios } = pruebasDeFiltro(p, {
    documento: (f) => soloDigitos(f.documento_tercero),
    // SOLO detalles[].contrato_numero (el consecutivo que usa el personal).
    // NUNCA detalles[].contrato_id: es la clave interna y puede coincidir por
    // casualidad con el consecutivo de OTRO contrato (así se coló una factura
    // ajena en una búsqueda real).
    contrato: (f, n) => Array.isArray(f.detalles) && f.detalles.some((d: any) => String(d.contrato_numero) === n),
    nombre: (f) => [f.nombre_tercero],
  });
  if (pruebas.length === 0) {
    throw new Error(
      'buscar_factura necesita al menos un filtro: documento (preferido), contrato_numero o nombre_contiene.'
    );
  }

  const escaneo = await fetchTodasLasPaginas('/service/v2/public/invoices/list', 'facturas');
  const coincidencias = escaneo.registros.filter((f) => pruebas.every((prueba) => prueba.test(f)));

  // Rama vacía: NO devolver cifras en cero. Un `saldo_total: 0` aquí es
  // perfectamente citable como "no debe nada" — exactamente el fallo que se
  // quiere matar. Se devuelve el conteo POR filtro para que el modelo sepa
  // cuál de sus criterios falló y reintente en vez de concluir.
  if (coincidencias.length === 0) {
    const coincidenciasPorFiltro = Object.fromEntries(
      pruebas.map((prueba) => [prueba.nombre, escaneo.registros.filter(prueba.test).length])
    );
    return {
      resultado: 'sin_coincidencias',
      instruccion:
        `Se revisaron ${escaneo.totalRevisados} facturas y NINGUNA cumple TODOS los criterios a la vez. ` +
        'Esto NO significa saldo cero ni que la persona no deba: significa que no hay facturas emitidas con esos criterios. ' +
        'NO digas "no debe nada" ni "está al día". El ERP respondió bien: NO lo reportes como incidencia. ' +
        'Reintenta con UN solo criterio (mira coincidencias_por_filtro para ver cuál tiene resultados), ' +
        'verifica el documento con el usuario, o ubica el contrato con buscar_contrato.',
      coincidencias_por_filtro: coincidenciasPorFiltro,
      criterios_aplicados: criterios,
      diagnostico: diagnostico(escaneo),
    };
  }

  const hoy = hoyBogota();
  const saldoDe = (f: any) => parseFloat(f.saldo) || 0;
  const conSaldo = coincidencias.filter((f) => saldoDe(f) > 0);
  // Verificado contra el ERP: hay MUCHAS facturas anuladas que conservan saldo
  // (el ERP no lo pone en cero al anular). Sumarlas infla la deuda con
  // documentos que ya no son exigibles, así que se separan del total cobrable.
  const anuladasConSaldo = conSaldo.filter(esAnulada);
  const cobrables = conSaldo.filter((f) => !esAnulada(f));
  const vencidas = cobrables.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < hoy);
  const porTercero = agruparPorTercero(cobrables, hoy);
  const saldoCobrable = cobrables.reduce((a, f) => a + saldoDe(f), 0);
  // La advertencia se basa en los terceros que APORTAN al saldo (los que se
  // atribuirían a una persona), no en todos los que aparecen entre las
  // coincidencias: si no, avisa de mezcla donde solo hay un deudor.
  const tercerosConSaldo = porTercero.length;

  const cobertura = await coberturaFacturacion(p, coincidencias, saldoCobrable);

  // Tokens: el resumen cubre TODAS las coincidencias; el detalle lista las con
  // saldo primero (lo que importa para cobro) y completa con las más recientes.
  const MAX_FACTURAS_DETALLE = 60;
  const detalle = [...conSaldo, ...coincidencias.filter((f) => saldoDe(f) === 0)].slice(0, MAX_FACTURAS_DETALLE);

  // El orden de claves importa: JSON.stringify conserva el orden de inserción
  // y el truncado por tamaño corta por el final. Las señales de completitud e
  // interpretación van PRIMERO para que sobrevivan a cualquier recorte.
  return {
    ...(cobertura ? { cobertura_facturacion: cobertura } : {}),
    resumen: {
      criterios_aplicados: criterios,
      facturas_encontradas: coincidencias.length,
      facturas_con_saldo_cobrable: cobrables.length,
      terceros_con_saldo: tercerosConSaldo,
      ...(tercerosConSaldo > 1
        ? {
            advertencia_identidad:
              `El saldo se reparte entre ${tercerosConSaldo} terceros distintos y saldo_cobrable_total los suma ` +
              'a TODOS (típicamente inquilino y propietario del mismo contrato, u homónimos). NO atribuyas esa ' +
              'cifra a una persona: usa por_tercero, o repite la búsqueda con el documento exacto.',
          }
        : {}),
      saldo_cobrable_total: saldoCobrable,
      facturas_vencidas: vencidas.length,
      saldo_vencido: vencidas.reduce((a, f) => a + saldoDe(f), 0),
      ...(anuladasConSaldo.length > 0
        ? {
            saldo_en_facturas_anuladas: anuladasConSaldo.reduce((a, f) => a + saldoDe(f), 0),
            nota_anuladas:
              `${anuladasConSaldo.length} factura(s) ANULADAS conservan saldo en el ERP; NO están sumadas en ` +
              'saldo_cobrable_total porque no son exigibles. Menciónalas solo si el usuario pregunta por ellas.',
          }
        : {}),
      ultima_factura_fecha: coincidencias.reduce<string | null>(
        (max, f) => (f.fecha_factura && (!max || f.fecha_factura > max) ? f.fecha_factura : max),
        null
      ),
      por_tercero: porTercero,
    },
    diagnostico: diagnostico(escaneo),
    ...(coincidencias.length > MAX_FACTURAS_DETALLE
      ? {
          nota_detalle: `Se listan ${MAX_FACTURAS_DETALLE} de ${coincidencias.length} facturas (las que tienen saldo van primero); el resumen cubre todas.`,
        }
      : {}),
    facturas: detalle.map(facturaCompacta),
  };
}

/**
 * Señal determinística de "deuda posiblemente NO facturada".
 *
 * En este ERP la facturación electrónica no cubre toda la deuda: hay contratos
 * activos que deben meses sin factura emitida (caso real verificado). Antes,
 * el retorno entregaba `ultima_factura_fecha` cruda y dejaba la inferencia —
 * aritmética de fechas + una segunda llamada — en manos del modelo, cuya ruta
 * de menor esfuerzo era leer `saldo 0` y declarar "al día".
 *
 * Solo se calcula con documento o contrato_numero (nombre_contiene es ambiguo).
 */
async function coberturaFacturacion(p: ParamsERP, coincidencias: any[], saldoFacturado: number) {
  if (p.documento === undefined && p.contrato_numero === undefined) return null;

  let contratos: any[];
  try {
    const escaneo = await fetchTodasLasPaginas('/service/v2/public/contracts/list', 'contratos');
    const { pruebas } = pruebasDeFiltro(p, {
      documento: (c) => soloDigitos(c.inquilino) ?? soloDigitos(c.propietario),
      contrato: (c, n) => String(c.consecutivo) === n,
      nombre: (c) => [c.inquilino, c.propietario],
    });
    contratos = escaneo.registros.filter((c) => pruebas.every((prueba) => prueba.test(c)));
  } catch {
    // El bloque es un refuerzo: si falla, el resto del resultado sigue siendo útil.
    return null;
  }

  const activos = contratos.filter((c) => String(c.estado).toLowerCase() === 'activo');
  const ultimaFactura = coincidencias.reduce<string | null>(
    (max, f) => (f.fecha_factura && (!max || f.fecha_factura > max) ? f.fecha_factura : max),
    null
  );

  if (activos.length === 0) {
    return {
      contratos_activos_encontrados: 0,
      ultima_factura_fecha: ultimaFactura,
      saldo_confirmado_en_facturas: saldoFacturado,
      evidencia_completa: false,
      conclusion_permitida:
        'No se encontró un contrato ACTIVO para estos criterios, así que no puedo verificar si la facturación está al día. ' +
        'Reporta el saldo facturado y aclara que no confirmaste el estado del contrato.',
    };
  }

  const hoy = hoyBogota();
  const dias = ultimaFactura
    ? Math.floor((Date.parse(hoy) - Date.parse(ultimaFactura)) / 86_400_000)
    : null;
  // Verificado en el ERP: los 596 contratos son 'Mensual'. Cualquier otra
  // periodicidad devuelve null y se dice explícitamente que no se pudo medir.
  const mensuales = activos.filter((c) => String(c.periodicidad).toLowerCase() === 'mensual');
  const periodosSinFacturar =
    dias !== null && mensuales.length === activos.length ? Math.max(0, Math.floor(dias / 30)) : null;

  const contratosResumen = activos.map((c) => ({
    consecutivo: c.consecutivo,
    estado: c.estado,
    periodicidad: c.periodicidad,
    canon_total: c.canon_total,
  }));

  if (periodosSinFacturar === null) {
    return {
      contratos_activos_encontrados: activos.length,
      contratos: contratosResumen,
      ultima_factura_fecha: ultimaFactura,
      dias_desde_ultima_factura: dias,
      periodos_sin_facturar: null,
      saldo_confirmado_en_facturas: saldoFacturado,
      evidencia_completa: false,
      conclusion_permitida:
        'No pude determinar la periodicidad del contrato (o no hay facturas para fechar): NO afirmes que está al día. ' +
        'Reporta el saldo facturado y sugiere confirmar el estado de cuenta en Arrendasoft.',
    };
  }

  if (periodosSinFacturar === 0) {
    return {
      contratos_activos_encontrados: activos.length,
      contratos: contratosResumen,
      ultima_factura_fecha: ultimaFactura,
      dias_desde_ultima_factura: dias,
      periodos_sin_facturar: 0,
      saldo_confirmado_en_facturas: saldoFacturado,
      evidencia_completa: true,
      conclusion_permitida: `La facturación está al día hasta ${ultimaFactura}; el saldo facturado (${saldoFacturado}) refleja la deuda conocida.`,
    };
  }

  return {
    contratos_activos_encontrados: activos.length,
    contratos: contratosResumen,
    ultima_factura_fecha: ultimaFactura,
    dias_desde_ultima_factura: dias,
    periodos_sin_facturar: periodosSinFacturar,
    saldo_confirmado_en_facturas: saldoFacturado,
    evidencia_completa: false,
    conclusion_permitida:
      `NO puedes afirmar que está al día: hay ${activos.length} contrato(s) ACTIVO(S) mensual(es) y la última factura ` +
      `es de ${ultimaFactura} (${dias} días), es decir ${periodosSinFacturar} período(s) sin factura emitida. ` +
      `Reporta el saldo FACTURADO (${saldoFacturado}), di explícitamente que hay ${periodosSinFacturar} período(s) sin facturar ` +
      'y que el saldo real puede ser mayor (aproximado, sin confirmar), y sugiere confirmar el estado de cuenta en Arrendasoft.',
  };
}

async function carteraResumen() {
  const escaneo = await fetchTodasLasPaginas('/service/v2/public/invoices/list', 'facturas');
  const hoy = hoyBogota();
  const saldoDe = (f: any) => parseFloat(f.saldo) || 0;
  const conSaldo = escaneo.registros.filter((f) => saldoDe(f) > 0);
  // Ver comentario en buscarFactura: las anuladas con saldo son muchas y no
  // son exigibles; incluirlas sobrestimaba la cartera en decenas de millones.
  const anuladasConSaldo = conSaldo.filter(esAnulada);
  const cobrables = conSaldo.filter((f) => !esAnulada(f));
  const vencidas = cobrables.filter((f) => f.fecha_vencimiento && f.fecha_vencimiento < hoy);

  return {
    diagnostico: diagnostico(escaneo),
    alcance: 'TODA la cartera de la inmobiliaria (no una persona). Para una persona usa buscar_factura.',
    facturas_con_saldo_cobrable: cobrables.length,
    saldo_cobrable_total: cobrables.reduce((a, f) => a + saldoDe(f), 0),
    facturas_vencidas: vencidas.length,
    saldo_vencido: vencidas.reduce((a, f) => a + saldoDe(f), 0),
    ...(anuladasConSaldo.length > 0
      ? {
          saldo_en_facturas_anuladas: anuladasConSaldo.reduce((a, f) => a + saldoDe(f), 0),
          nota_anuladas:
            `${anuladasConSaldo.length} factura(s) ANULADAS conservan saldo en el ERP y NO están sumadas en ` +
            'saldo_cobrable_total (no son exigibles). Si el usuario compara con una cifra de cartera que él ' +
            'tenía, esta diferencia puede ser la explicación.',
        }
      : {}),
    top_deudores: agruparPorTercero(cobrables, hoy).slice(0, 10),
  };
}

async function buscarContrato(p: ParamsERP) {
  const { pruebas, criterios } = pruebasDeFiltro(p, {
    documento: (c) => soloDigitos(c.inquilino) ?? soloDigitos(c.propietario),
    // contrato_numero matchea SOLO 'consecutivo' (el número que usa el personal
    // y que las facturas referencian en detalles[].contrato_numero), NUNCA
    // 'contrato_id' (clave interna): son independientes y pueden coincidir por
    // casualidad en contratos distintos — matchearlo devolvía un falso positivo
    // indistinguible del real (contrato_id=333 es de un inquilino,
    // consecutivo=333 es de otro).
    contrato: (c, n) => String(c.consecutivo) === n,
    nombre: (c) => [c.inquilino, c.propietario],
  });
  if (pruebas.length === 0) {
    throw new Error(
      'buscar_contrato necesita al menos un filtro: documento (preferido), contrato_numero o nombre_contiene.'
    );
  }

  // El total de contratos (~596) cabe hoy en una sola página de 1000, pero se
  // recorre igual por si el portafolio crece más allá de esa cota.
  const escaneo = await fetchTodasLasPaginas('/service/v2/public/contracts/list', 'contratos');
  const coincidencias = escaneo.registros.filter((c) => pruebas.every((prueba) => prueba.test(c)));

  if (coincidencias.length === 0) {
    const coincidenciasPorFiltro = Object.fromEntries(
      pruebas.map((prueba) => [prueba.nombre, escaneo.registros.filter(prueba.test).length])
    );
    return {
      resultado: 'sin_coincidencias',
      instruccion:
        `Se revisaron ${escaneo.totalRevisados} contratos y NINGUNO cumple TODOS los criterios a la vez. ` +
        'El ERP respondió bien: NO lo reportes como incidencia. Reintenta con UN solo criterio ' +
        '(mira coincidencias_por_filtro), o verifica el dato con el usuario.',
      coincidencias_por_filtro: coincidenciasPorFiltro,
      criterios_aplicados: criterios,
      diagnostico: diagnostico(escaneo),
    };
  }

  // Cap de servidor: contratoCompacto no proyecta (reenvía ...resto), así que
  // una búsqueda amplia por nombre superaba el límite de tamaño sin esfuerzo.
  const MAX_CONTRATOS_DETALLE = 40;
  const activosPrimero = [...coincidencias].sort(
    (a, b) =>
      Number(String(b.estado).toLowerCase() === 'activo') - Number(String(a.estado).toLowerCase() === 'activo')
  );

  return {
    diagnostico: diagnostico(escaneo),
    resumen: {
      criterios_aplicados: criterios,
      contratos_encontrados: coincidencias.length,
      activos: coincidencias.filter((c) => String(c.estado).toLowerCase() === 'activo').length,
    },
    ...(coincidencias.length > MAX_CONTRATOS_DETALLE
      ? {
          nota_detalle: `Se listan ${MAX_CONTRATOS_DETALLE} de ${coincidencias.length} coincidencias (activos primero); afina con documento o contrato_numero.`,
        }
      : {}),
    contratos: activosPrimero.slice(0, MAX_CONTRATOS_DETALLE).map(contratoCompacto),
  };
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
/**
 * Parámetros que CAMBIAN EL SIGNIFICADO de la respuesta si el recurso no los
 * soporta. Pasarlos a un recurso que los ignora produce el peor fallo posible:
 * el modelo cree que filtró y recibe datos sin filtrar, sin ninguna señal.
 * Los parámetros meramente inertes (pagina/por_pagina donde no aplican) NO se
 * rechazan — solo se listan en el eco — para no gastar iteraciones del bucle.
 */
const PARAMS_QUE_CAMBIAN_EL_SIGNIFICADO: Record<string, RecursoERP[]> = {
  documento: ['buscar_factura', 'buscar_contrato'],
  nombre_contiene: ['buscar_factura', 'buscar_contrato'],
  contrato_numero: ['buscar_factura', 'buscar_contrato'],
  codigo: ['propiedad'],
  fecha_ini: ['auxiliar_contable'],
  fecha_fin: ['auxiliar_contable'],
  cuenta_ini: ['auxiliar_contable'],
  cuenta_fin: ['auxiliar_contable'],
  con_detalles: ['auxiliar_contable'],
};

const PARAMS_DE_PAGINACION: RecursoERP[] = ['propiedades', 'contratos', 'facturas'];

function validarParametros(recurso: RecursoERP, params: ParamsERP): string[] {
  const ignorados: string[] = [];

  for (const [param, recursosValidos] of Object.entries(PARAMS_QUE_CAMBIAN_EL_SIGNIFICADO)) {
    if (params[param as keyof ParamsERP] === undefined) continue;
    if (recursosValidos.includes(recurso)) continue;
    const sugerencia =
      param === 'documento' || param === 'nombre_contiene' || param === 'contrato_numero'
        ? `El ERP no filtra server-side: te devolvería TODOS los registros, no los de esa persona. Para la cartera de alguien puntual usa recurso='buscar_factura'; para ubicar su contrato, recurso='buscar_contrato'.`
        : `Solo aplica a: ${recursosValidos.join(', ')}.`;
    throw new Error(`El recurso '${recurso}' no acepta el parámetro '${param}'. ${sugerencia}`);
  }

  for (const param of ['pagina', 'por_pagina'] as const) {
    if (params[param] !== undefined && !PARAMS_DE_PAGINACION.includes(recurso)) ignorados.push(param);
  }
  return ignorados;
}

export async function consultaERP(recurso: RecursoERP, params: ParamsERP = {}): Promise<unknown> {
  const parametrosIgnorados = validarParametros(recurso, params);

  if (recurso === 'buscar_factura') return buscarFactura(params);
  if (recurso === 'cartera_resumen') return carteraResumen();
  if (recurso === 'buscar_contrato') return buscarContrato(params);

  const { ruta, query } = rutaYQuery(recurso, params);
  const datos = await fetchPagina(ruta, query, 2, recurso);

  // Eco de lo que REALMENTE se consultó. Sin esto, cuando el servidor
  // reescribe un parámetro (cuenta_fin se expande con 9s) un resultado vacío
  // es ininterpretable y el modelo lo reporta como "incidencia del ERP".
  const consultaAplicada: Record<string, unknown> = { recurso };
  for (const [k, v] of query.entries()) consultaAplicada[k] = v;
  if (recurso === 'auxiliar_contable' && params.cuenta_fin) {
    consultaAplicada.nota =
      `cuenta_fin se expande a prefijo rellenando con 9s ('${params.cuenta_fin}' → '${query.get('cuenta_fin')}'), ` +
      'porque el ERP compara los códigos de cuenta como texto.';
  }
  if (parametrosIgnorados.length > 0) consultaAplicada.parametros_ignorados = parametrosIgnorados;

  // Proyección compacta de los listados crudos (ver comentario arriba).
  const compactar = (registros: any[]): any[] => {
    if (recurso === 'facturas') return registros.map(facturaCompacta);
    if (recurso === 'contratos') return registros.map(contratoCompacto);
    if (recurso === 'propiedades') return registros.map(propiedadCompacta);
    if (recurso === 'auxiliar_contable' && !params.con_detalles) return auxiliarSinDetalles(registros);
    return registros;
  };

  // consulta_aplicada y paginacion van PRIMERO: el truncado por tamaño corta
  // por el final, y son justo las señales que no se pueden perder.
  if (Array.isArray(datos)) return { consulta_aplicada: consultaAplicada, registros: compactar(datos) };
  if (datos && typeof datos === 'object') {
    if (datos.error === true) throw new Error(`Error del ERP: ${datos.message || 'desconocido'}`);
    if (datos.pagination) {
      return {
        consulta_aplicada: consultaAplicada,
        paginacion: datos.pagination,
        registros: compactar(datos.body ?? []),
      };
    }
    if (Array.isArray(datos.body)) return { consulta_aplicada: consultaAplicada, registros: compactar(datos.body) };
    return { consulta_aplicada: consultaAplicada, datos: datos.body ?? datos.data ?? datos };
  }
  return { consulta_aplicada: consultaAplicada, datos };
}
