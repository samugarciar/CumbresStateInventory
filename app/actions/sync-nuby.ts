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
    .select('id, arrendasoft_id')
    .eq('inmobiliaria_id', profile.inmobiliaria_id)
    .not('arrendasoft_id', 'is', null);

  if (existingErr) {
    console.error('Error al consultar inmuebles existentes:', existingErr);
  }

  const existingMap = new Map<string, string>(); // arrendasoft_id -> local_id
  if (inmueblesExistentes) {
    inmueblesExistentes.forEach(item => {
      if (item.arrendasoft_id) {
        existingMap.set(String(item.arrendasoft_id), item.id);
      }
    });
  }

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

      const payload = {
        inmobiliaria_id: profile.inmobiliaria_id,
        asesor_id: matchedAsesorId,
        titulo: prop.titulo || `${prop.clase_inmueble || 'Inmueble'} en ${prop.barrio || 'Cumbres'}`,
        descripcion: prop.observaciones || prop.observaciones_publicas || `Sincronizado desde Arrendasoft. Código: ${prop.codigo}`,
        direccion: prop.direccion || 'Dirección no especificada',
        precio: precio,
        tipo_transaccion: tipoTransaccion,
        tipo_inmueble: tipoInmueble,
        estado: isArrendado ? 'arrendado' : 'disponible',
        arrendasoft_id: isNaN(Number(arrendasoftId)) ? null : Number(arrendasoftId),
        arrendasoft_contrato_id: arrendasoftContratoId,
        arrendasoft_contrato_info: arrendasoftContratoInfo,
        imagenes: imagenesArr,
      };

      if (isUpdate) {
        const localId = existingMap.get(arrendasoftId)!;
        const { error: updateErr } = await supabase
          .from('inmuebles')
          .update(payload)
          .eq('id', localId);

        if (updateErr) throw new Error(updateErr.message);
        updatedCount++;
      } else {
        const { error: insertErr } = await supabase
          .from('inmuebles')
          .insert(payload);

        if (insertErr) throw new Error(insertErr.message);
        importedCount++;
      }

    } catch (err: any) {
      console.error(`Falla en procesar propiedad código ${prop.codigo}:`, err.message);
      failedCount++;
      details.push(`Código ${prop.codigo}: Error al guardar (${err.message})`);
    }
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
