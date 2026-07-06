'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { fetchPropiedadesNuby, getNubyConfig, mapearTipoInmueble, obtenerTokenJWT, NubyConfig, fetchContratosNuby } from '@/lib/nuby';

export interface SyncResult {
  success: boolean;
  message: string;
  processed: number;
  imported: number;
  updated: number;
  failed: number;
  details?: string[];
}

// Convierte valores numéricos sueltos del ERP (string/number) a entero positivo o null.
// Nuby usa "-1" (y a veces 0/"") para indicar "sin dato", por eso exigimos > 0.
function aEnteroPositivo(valor: unknown): number | null {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Extrae un valor numérico del arreglo `caracteristicas` de Nuby buscando por
// el texto de `descripcion` (insensible a acentos/mayúsculas).
// Ej: "Nº De Habitaciones" -> 3, "Nº De Baños" -> 2.
function extraerCaracteristicaNumerica(caracteristicas: unknown, keyword: string): number | null {
  if (!Array.isArray(caracteristicas)) return null;
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const item = caracteristicas.find(
    (c: any) => c && typeof c.descripcion === 'string' && norm(c.descripcion).includes(keyword)
  );
  return item ? aEnteroPositivo(item.valor) : null;
}

// Normaliza texto para comparar: sin acentos, minúsculas, puntuación → espacio,
// espacios colapsados. Ej: "URBVIDANTA, Apto-713" -> "urbvidanta apto 713".
function normalizarTexto(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Nombres de unidad demasiado cortos generan falsos positivos al buscarlos
// dentro de direcciones; se ignoran los de menos de este largo (normalizado).
const UNIDAD_MIN_CHARS = 3;

// Prefijos de urbanización que se anteponen al nombre del edificio en las
// direcciones colombianas, a veces PEGADOS (ej. "URBVIDANTA" = "URB"+"VIDANTA").
// Se permiten como prefijo opcional para que "VIDANTA", "URB VIDANTA" y
// "URBVIDANTA" se reconozcan como la misma unidad "Vidanta".
const UNIDAD_PREFIJOS = 'urb|urbanizacion|conj|conjunto|edif|edificio|cond|condominio|ciudadela';

/**
 * Infiere la unidad de un inmueble leyendo su dirección y buscando, por límite
 * de palabra, el nombre de alguna unidad ya fijada manualmente (el "catálogo").
 * Devuelve el valor ORIGINAL del catálogo (conserva grafía/acentos) o null.
 * Si varias unidades coinciden, elige la más específica (la más larga), de modo
 * que "Luna del Bosque" no se confunda con un genérico "Bosque".
 *
 * Ej: catálogo ["Luna del Bosque"], dirección "CL 65 #97AE-20 LUNA DEL BOSQUE APTO 212"
 *     -> "Luna del Bosque".
 */
function inferirUnidad(direccion: string | null, unidadesConocidas: string[]): string | null {
  if (!direccion || unidadesConocidas.length === 0) return null;
  const dirNorm = normalizarTexto(direccion);
  let mejor: string | null = null;
  let mejorLargo = 0;
  for (const unidad of unidadesConocidas) {
    const norm = normalizarTexto(unidad);
    if (norm.length < UNIDAD_MIN_CHARS) continue;
    // Prefijo de urbanización opcional (pegado) + nombre de la unidad por límite de palabra
    const re = new RegExp(`\\b(?:${UNIDAD_PREFIJOS})?${escaparRegex(norm)}\\b`);
    if (re.test(dirNorm) && norm.length > mejorLargo) {
      mejor = unidad;
      mejorLargo = norm.length;
    }
  }
  return mejor;
}

// Abreviaturas de tipo de vía → código canónico (para que "CALLE 72", "CL 72"
// y "CL72" produzcan la misma firma de dirección).
const VIA_MAP: Record<string, string> = {
  calle: 'ca', cll: 'ca', clle: 'ca', calla: 'ca', cl: 'ca',
  cra: 'cr', cr: 'cr', carrera: 'cr', kra: 'cr', krra: 'cr',
  av: 'av', ave: 'av', avda: 'av', avenida: 'av',
  diag: 'dg', dg: 'dg', diagonal: 'dg',
  transv: 'tv', tv: 'tv', transversal: 'tv',
  autopista: 'au', autop: 'au', circular: 'ci', circ: 'ci',
};
const VIA_CODES = new Set(['ca', 'cr', 'av', 'dg', 'tv', 'au', 'ci']);

/**
 * Calcula una "firma" estable de la dirección: tipo de vía canónico + números/placa,
 * descartando el apartamento/torre y el nombre del edificio. Dos inmuebles del mismo
 * edificio comparten firma aunque su texto esté escrito distinto o NO mencione el
 * nombre de la unidad. Ej:
 *   "CALLE 72 #65B-60 URBVIDANTA APTO 713" -> "ca 72 65b 60"
 *   "CL. 72 #65B -60 APTO 2817"            -> "ca 72 65b 60"  (misma, sin nombre)
 * Devuelve '' si no logra extraer una firma útil.
 */
function firmaDireccion(direccion: string | null): string {
  if (!direccion) return '';
  let s = normalizarTexto(direccion);
  // separar pegados letra/dígito: "cl72"->"cl 72", "221apto"->"221 apto", "65b"->"65 b"
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
  // cortar desde el marcador de apartamento/torre/etc. en adelante
  s = s.replace(/\b(apto|aptp|apartamento|apt|ap|casa|local|oficina|of|torre|bloque|bl|interior|int|parqueadero|parq|pq|piso|t)\b.*$/, '');
  // canonizar el tipo de vía
  s = s.replace(/\b([a-z]+)\b/g, (m) => VIA_MAP[m] || m);
  // re-unir la placa: "65 b" -> "65b", "97 ae" -> "97ae"
  s = s.replace(/(\d+)\s+([a-z]{1,2})\b/g, '$1$2');
  // conservar solo códigos de vía + números/placa
  const toks = s.split(' ').filter(Boolean).filter((t) => /\d/.test(t) || VIA_CODES.has(t));
  return toks.join(' ').trim();
}

/**
 * Server Action para sincronizar inmuebles de Arrendasoft/Nuby con la base de datos local.
 * Este proceso es seguro y se ejecuta completamente del lado del servidor.
 */
export async function sincronizarInmuebles(overrides?: Partial<NubyConfig>): Promise<SyncResult> {
  const supabase = await createClient();

  // 1. Obtener sesión de usuario logueado
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      success: false,
      message: 'Sesión de usuario no válida.',
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  // 2. Obtener perfil para verificar rol de administrador e inmobiliaria_id
  const { data: profile, error: profileErr } = await supabase
    .from('usuarios')
    .select('rol, inmobiliaria_id')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return {
      success: false,
      message: 'No se pudo verificar el perfil del usuario.',
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  // Restringir sincronización solo a administradores por motivos de RLS y control de asignaciones
  if (profile.rol !== 'admin') {
    return {
      success: false,
      message: 'Permiso denegado. Solo los administradores pueden realizar la sincronización con el ERP.',
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  // 3. Obtener lista de asesores locales actuales para realizar el match en memoria
  const { data: asesoresLocales, error: asesoresErr } = await supabase
    .from('usuarios')
    .select('id, nombre_completo, email')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .eq('rol', 'asesor');

  if (asesoresErr) {
    console.error('Error al obtener asesores locales:', asesoresErr);
    return {
      success: false,
      message: `Error al leer asesores locales: ${asesoresErr.message}`,
      processed: 0, imported: 0, updated: 0, failed: 0
    };
  }

  const advisors = asesoresLocales || [];

  // 4. Conectarse y descargar propiedades de forma inteligente y resiliente
  const config = getNubyConfig(overrides);
  let jwtToken = '';
  let allProperties: any[] = [];
  const details: string[] = [];
  details.push(`Estableciendo conexión con la instancia ${config.instancia} de Arrendasoft...`);

  let page = 1;
  const pageSize = 50;
  let keepFetching = true;

  try {
    // Intentar primero consultar la API directamente sin token (acceso público)
    details.push("Intentando conexión directa (acceso público)...");
    const testChunk = await fetchPropiedadesNuby(config, undefined, 1, 1);
    details.push("✓ Conexión pública establecida con éxito (no requiere autenticación).");
    
    // Si funciona, descargamos todas las páginas directamente sin token
    while (keepFetching && page <= 100) {
      const chunk = await fetchPropiedadesNuby(config, undefined, page, pageSize);
      if (!chunk || chunk.length === 0) {
        keepFetching = false;
        break;
      }
      allProperties.push(...chunk);
      if (chunk.length < pageSize) {
        keepFetching = false;
      } else {
        page++;
      }
    }
  } catch (publicError: any) {
    // Si la conexión pública falla (ej. requiere token o WAF intercepción), intentamos el flujo OAuth2
    details.push(`La conexión directa no obtuvo resultados o requiere token (${publicError.message}). Iniciando flujo OAuth2...`);
    
    try {
      jwtToken = await obtenerTokenJWT(config);
      details.push("✓ Autenticado con éxito en Arrendasoft. Token JWT obtenido.");
      
      // Reiniciar paginación para descargar con token
      page = 1;
      keepFetching = true;
      allProperties = [];

      while (keepFetching && page <= 100) {
        const chunk = await fetchPropiedadesNuby(config, jwtToken, page, pageSize);
        if (!chunk || chunk.length === 0) {
          keepFetching = false;
          break;
        }
        allProperties.push(...chunk);
        if (chunk.length < pageSize) {
          keepFetching = false;
        } else {
          page++;
        }
      }
    } catch (authError: any) {
      // Si ambos fallan, retornamos un mensaje de diagnóstico detallado
      return {
        success: false,
        message: `Error al conectar con el ERP: No se pudo establecer conexión directa (${publicError.message}) ni autenticarse por OAuth2 (${authError.message}).`,
        processed: 0, imported: 0, updated: 0, failed: 0,
        details: [...details, `Error final: ${authError.message}`]
      };
    }
  }

  details.push(`Se extrajeron ${allProperties.length} propiedades en total desde la API de Arrendasoft.`);

  // Descargar contratos de Arrendasoft activos para el mapeo
  details.push("Consultando contratos de arrendamiento activos en el ERP...");
  const contratosMap = new Map<string, any>();
  try {
    const contratos = await fetchContratosNuby(config, jwtToken || undefined);
    contratos.forEach(c => {
      if (c.propiedad_id) {
        contratosMap.set(String(c.propiedad_id), c);
      }
    });
    details.push(`✓ Se recuperaron ${contratos.length} contratos desde la API.`);
  } catch (err: any) {
    details.push(`Advertencia: No se pudieron cargar los contratos de Arrendasoft (${err.message}).`);
  }

  // 6. Filtrar y Procesar en memoria
  let processedCount = 0;
  let importedCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  // Consultar inmuebles locales previamente sincronizados para distinguir entre "creación" y "actualización"
  const { data: inmueblesExistentes, error: existingErr } = await supabase
    .from('inmuebles')
    .select('id, arrendasoft_id, unidad, estado_override')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .not('arrendasoft_id', 'is', null);

  if (existingErr) {
    console.error('Error al consultar inmuebles existentes:', existingErr);
  }

  const existingMap = new Map<string, { id: string; unidad: string | null; estado_override: string | null }>(); // arrendasoft_id -> registro local
  if (inmueblesExistentes) {
    inmueblesExistentes.forEach(item => {
      if (item.arrendasoft_id) {
        existingMap.set(String(item.arrendasoft_id), { id: item.id, unidad: item.unidad ?? null, estado_override: item.estado_override ?? null });
      }
    });
  }

  // Inmuebles con unidad ya fijada en TODA la inmobiliaria (a mano o por syncs previos).
  // Sirven de "semilla" para etiquetar a los demás de dos formas complementarias:
  //   1) por NOMBRE: buscando el nombre del edificio dentro de la dirección.
  //   2) por DIRECCIÓN: misma firma de calle/placa, aunque el texto no nombre el edificio.
  const { data: inmueblesConUnidad } = await supabase
    .from('inmuebles')
    .select('unidad, direccion')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .not('unidad', 'is', null);

  const unidadesConocidas = Array.from(
    new Set((inmueblesConUnidad || []).map((r: any) => (r.unidad || '').trim()).filter(Boolean))
  );

  // Mapa firma-de-dirección → unidad. Solo se conservan firmas NO ambiguas
  // (las que apuntan a un único edificio); si una firma choca con dos unidades
  // distintas se descarta por seguridad.
  const firmaAUnidad: Record<string, string> = {};
  const firmasAmbiguas = new Set<string>();
  for (const r of inmueblesConUnidad || []) {
    const u = (r.unidad || '').trim();
    const f = firmaDireccion(r.direccion);
    if (!u || !f || firmasAmbiguas.has(f)) continue;
    if (firmaAUnidad[f] && firmaAUnidad[f] !== u) {
      delete firmaAUnidad[f];
      firmasAmbiguas.add(f);
    } else {
      firmaAUnidad[f] = u;
    }
  }

  if (unidadesConocidas.length > 0) {
    details.push(`Catálogo de unidades: ${unidadesConocidas.length} nombre(s), ${Object.keys(firmaAUnidad).length} firma(s) de dirección.`);
  }
  let unidadInferidaCount = 0;

  // Mapear e insertar en lotes o individualmente con control de errores
  for (const prop of allProperties) {
    processedCount++;
    
    // Filtro de estados solicitado por el usuario:
    // Solo disponibles (estado 1) y arrendados (estado 0)
    // Se descartan inactivos (estado 3) y borradores (estado 5)
    const isDisponible = prop.estado === 1 || prop.estado_texto?.toLowerCase().trim() === 'activa' || prop.estado_texto?.toLowerCase().trim() === 'desocupado';
    const isArrendado = prop.estado === 0 || prop.estado_texto?.toLowerCase().trim() === 'arrendada' || prop.estado_texto?.toLowerCase().trim() === 'arrendado';
    
    if (!isDisponible && !isArrendado) {
      // Ignorar inactivos/borradores de forma silenciosa
      continue;
    }

    try {
      const arrendasoftId = String(prop.codigo);
      const isUpdate = existingMap.has(arrendasoftId);

      // Mapear precio dinámicamente según transacción
      let precio = 0;
      if (prop.valor_arriendo1 && Number(prop.valor_arriendo1) > 0) {
        precio = Number(prop.valor_arriendo1);
      } else if (prop.valor_venta1 && Number(prop.valor_venta1) > 0) {
        precio = Number(prop.valor_venta1);
      } else if (prop.valor_arriendo2 && Number(prop.valor_arriendo2) > 0) {
        precio = Number(prop.valor_arriendo2);
      } else if (prop.valor_venta2 && Number(prop.valor_venta2) > 0) {
        precio = Number(prop.valor_venta2);
      } else if (prop.valor_administracion && Number(prop.valor_administracion) > 0) {
        precio = Number(prop.valor_administracion);
      }

      // Tipo de transacción
      let tipoTransaccion: 'arriendo' | 'venta' = 'arriendo';
      const servicio = prop.tipo_servicio?.toLowerCase() || '';
      if (servicio.includes('venta') || prop.valor_venta1 > 0) {
        tipoTransaccion = 'venta';
      }

      // Mapear tipo de inmueble
      const tipoInmueble = mapearTipoInmueble(prop.clase_inmueble);

      // Coincidencia de asesores
      let matchedAsesorId: string | null = null;
      const nubyAsesorName = prop.asesor ? prop.asesor.toLowerCase().trim() : '';

      if (nubyAsesorName) {
        // Coincidencia exacta
        const matchExact = advisors.find(
          a => a.nombre_completo.toLowerCase().trim() === nubyAsesorName ||
               a.email.toLowerCase().trim() === nubyAsesorName
        );

        if (matchExact) {
          matchedAsesorId = matchExact.id;
        } else {
          // Coincidencia difusa en nombres
          const matchPartial = advisors.find(a => {
            const localName = a.nombre_completo.toLowerCase().trim();
            const localWords = localName.split(/\s+/).filter((w: string) => w.length > 2);
            const nubyWords = nubyAsesorName.split(/\s+/).filter((w: string) => w.length > 2);

            const matchesCount = localWords.filter((w: string) => nubyWords.includes(w)).length;
            return matchesCount >= 2 || nubyAsesorName.includes(localName) || localName.includes(nubyAsesorName);
          });

          if (matchPartial) {
            matchedAsesorId = matchPartial.id;
          }
        }
      }

      // Extraer URLs de imágenes
      let imagenesArr: string[] = [];
      if (Array.isArray(prop.imagenes)) {
        imagenesArr = prop.imagenes.map((img: any) => img.imagen).filter(Boolean);
      }

      // Enlace de contrato y metadatos
      let arrendasoftContratoId: string | null = null;
      let arrendasoftContratoInfo: any | null = null;

      if (isArrendado) {
        const contratoMatch = contratosMap.get(arrendasoftId);
        if (contratoMatch) {
          arrendasoftContratoId = contratoMatch.id ? String(contratoMatch.id) : (contratoMatch.codigo ? String(contratoMatch.codigo) : null);
          arrendasoftContratoInfo = {
            inquilino: contratoMatch.inquilino || null,
            inquilino_documento: contratoMatch.inquilinos_id || null,
            propietario: contratoMatch.propietario || null,
            propietario_documento: contratoMatch.propietarios_id || null,
            fecha_inicio: contratoMatch.fecha_inicio || null,
            fecha_fin: contratoMatch.fecha_fin || null,
            canon: contratoMatch.canon_total || null
          };
        }
      }

      const erpEstado = isArrendado ? 'arrendado' : 'disponible';

      const payload = {
        inmobiliaria_id: profile.inmobiliaria_id,
        asesor_id: matchedAsesorId,
        titulo: prop.titulo || `${prop.clase_inmueble || 'Inmueble'} en ${prop.barrio || 'Cumbres'}`,
        descripcion: prop.observaciones || prop.observaciones_publicas || `Sincronizado desde Arrendasoft. Código: ${prop.codigo}`,
        direccion: prop.direccion || 'Dirección no especificada',
        ciudad: prop.municipio || null,
        barrio: prop.barrio || null,
        habitaciones: extraerCaracteristicaNumerica(prop.caracteristicas, 'habitacion'),
        banos: extraerCaracteristicaNumerica(prop.caracteristicas, 'bano'),
        precio: precio,
        tipo_transaccion: tipoTransaccion,
        tipo_inmueble: tipoInmueble,
        // estado_erp = lo que dice el ERP; estado (efectivo) = override local si existe, si no el del ERP.
        // NO incluimos estado_override en el payload: es soberanía local (como asesor_id_override).
        estado_erp: erpEstado,
        estado: erpEstado,
        arrendasoft_id: isNaN(Number(arrendasoftId)) ? null : Number(arrendasoftId),
        arrendasoft_contrato_id: arrendasoftContratoId,
        arrendasoft_contrato_info: arrendasoftContratoInfo,
        imagenes: imagenesArr,
      };

      // Inferir la unidad: 1º por nombre del edificio en la dirección; si no aparece,
      // 2º por firma de dirección (mismo edificio aunque el texto no lo nombre).
      // El payload base NO incluye `unidad` para no pisar asignaciones manuales.
      const unidadInferida =
        inferirUnidad(payload.direccion, unidadesConocidas) ||
        firmaAUnidad[firmaDireccion(payload.direccion)] ||
        null;

      if (isUpdate) {
        const existente = existingMap.get(arrendasoftId)!;
        const updatePayload: Record<string, any> = { ...payload };
        // Estado efectivo = override local si existe (ej. desocupado ofertado), si no el del ERP.
        // Así el sync no pisa la decisión local de ofertar un inmueble arrendado en el ERP.
        updatePayload.estado = existente.estado_override || erpEstado;
        // Solo autocompletar si el inmueble NO tiene ya una unidad (soberanía local)
        if (unidadInferida && !(existente.unidad && existente.unidad.trim())) {
          updatePayload.unidad = unidadInferida;
          unidadInferidaCount++;
        }
        const { error: updateErr } = await supabase
          .from('inmuebles')
          .update(updatePayload)
          .eq('id', existente.id);

        if (updateErr) throw new Error(updateErr.message);
        updatedCount++;
      } else {
        const insertPayload: Record<string, any> = { ...payload };
        if (unidadInferida) {
          insertPayload.unidad = unidadInferida;
          unidadInferidaCount++;
        }
        const { error: insertErr } = await supabase
          .from('inmuebles')
          .insert(insertPayload);

        if (insertErr) throw new Error(insertErr.message);
        importedCount++;
      }

    } catch (err: any) {
      console.error(`Falla en procesar propiedad código ${prop.codigo}:`, err.message);
      failedCount++;
      details.push(`Código ${prop.codigo}: Error al guardar (${err.message})`);
    }
  }

  if (unidadInferidaCount > 0) {
    details.push(`Se autocompletó la unidad de ${unidadInferidaCount} inmueble(s) a partir de la dirección (catálogo manual).`);
  }

  details.push(`Sincronización completada. Nuevos: ${importedCount}, Actualizados: ${updatedCount}, Fallidos: ${failedCount}.`);

  // 7. Revalidar vistas
  revalidatePath('/inmuebles');
  revalidatePath('/dashboard');

  return {
    success: true,
    message: `Sincronización finalizada con éxito. Se importaron ${importedCount} propiedades nuevas y se actualizaron ${updatedCount} existentes.`,
    processed: processedCount,
    imported: importedCount,
    updated: updatedCount,
    failed: failedCount,
    details
  };
}
