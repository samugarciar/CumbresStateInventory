'use server';

import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Constancia de una foto del rostro que no se tomó: el firmante no la autorizó (es un dato
 * sensible, Ley 1581 de 2012) y el asesor apagó la toma antes de entregarle el dispositivo.
 * Se guarda tal cual dentro del registro del firmante y entra al hash de integridad.
 */
interface OmisionSelfie {
  selfie_omitida: true;
  selfie_omitida_por: { usuario_id: string; nombre: string };
  selfie_omitida_at: string;
}

/**
 * Genera un hash SHA-256 de integridad a partir de la evidencia biométrica.
 * El hash vincula criptográficamente: URLs de archivos, datos OCR, timestamp e inventario ID.
 * Cualquier modificación posterior a estos datos producirá un hash diferente,
 * haciendo detectable cualquier alteración.
 */
function generarHashIntegridad(params: {
  firmaUrl: string;
  selfieUrl: string;
  cedulaUrl: string;
  nombreOcr: string;
  identidadOcr: string;
  firmadoAt: string;
  inventarioId: string;
  rol: 'asesor' | 'inquilino';
  omisionSelfie?: OmisionSelfie | null;
}): string {
  const campos = [
    params.rol,
    params.inventarioId,
    params.firmaUrl,
    params.selfieUrl,
    params.cedulaUrl,
    params.nombreOcr,
    params.identidadOcr,
    params.firmadoAt
  ];

  // Si la selfie se omitió, la constancia entra al hash: quitar la marca o cambiar quién o
  // cuándo la desactivó deja de coincidir. Las actas con selfie conservan los 8 campos de siempre.
  if (params.omisionSelfie) {
    campos.push(
      'selfie_omitida',
      params.omisionSelfie.selfie_omitida_por.usuario_id,
      params.omisionSelfie.selfie_omitida_por.nombre,
      params.omisionSelfie.selfie_omitida_at
    );
  }

  return createHash('sha256').update(campos.join('|'), 'utf8').digest('hex');
}

/**
 * Inicializa el bucket de storage 'firmas_biometricas' si no existe.
 */
export async function inicializarBucketBiometria() {
  const supabaseAdmin = createAdminClient();
  try {
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    if (listError) {
      console.error('[Biometría Backend] Error al listar buckets:', listError.message);
      return { success: false, error: listError.message };
    }

    const bucketExiste = buckets?.some(b => b.name === 'firmas_biometricas');
    if (!bucketExiste) {
      console.log('[Biometría Backend] El bucket "firmas_biometricas" no existe. Creándolo...');
      // Privado: las evidencias son datos biométricos y solo se ven con URLs firmadas.
      const { error: createError } = await supabaseAdmin.storage.createBucket('firmas_biometricas', {
        public: false,
        allowedMimeTypes: ['image/png', 'image/jpeg']
      });

      if (createError) {
        console.error('[Biometría Backend] Error al crear bucket:', createError.message);
        return { success: false, error: createError.message };
      }
      console.log('[Biometría Backend] Bucket "firmas_biometricas" creado exitosamente.');
    }
    return { success: true };
  } catch (error: any) {
    console.error('[Biometría Backend] Excepción al inicializar bucket:', error);
    return { success: false, error: error.message || 'Error desconocido' };
  }
}

type TipoImagen = 'image/png' | 'image/jpeg';

// Primeros bytes de cada formato: el archivo se reconoce por su contenido, no por lo que diga el data URL.
const CABECERAS: Record<TipoImagen, Buffer> = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff])
};

/**
 * Decodifica una evidencia que llega del navegador como data URL (`data:image/jpeg;base64,…`).
 * Devuelve null si falta, si no es exactamente del tipo esperado o si sus bytes no empiezan con la
 * cabecera de ese formato. Así no se sube como imagen algo que no lo es: la captura simulada en SVG
 * que ofrecía el asistente sin cámara se convertía en 21 bytes sin sentido, guardados como .jpg, que
 * el acta mostraba como imagen rota.
 */
function decodificarImagen(dataUrl: string, tipo: TipoImagen): Buffer | null {
  const prefijo = `data:${tipo};base64,`;
  // Llega del navegador: no se confía en que sea un string.
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefijo)) return null;

  const base64 = dataUrl.slice(prefijo.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;

  const imagen = Buffer.from(base64, 'base64');
  const cabecera = CABECERAS[tipo];
  return imagen.length > cabecera.length && imagen.subarray(0, cabecera.length).equals(cabecera) ? imagen : null;
}

/** Una evidencia del acta: lo que manda el navegador y dónde se guarda. */
interface Evidencia {
  rol: 'asesor' | 'inquilino';
  archivo: string;
  tipo: TipoImagen;
  dataUrl: string;
  descripcion: string; // Para el mensaje de error: «la foto de la cédula del asesor».
}

/**
 * Sube una imagen ya validada a Supabase Storage y retorna su URL pública.
 */
async function subirImagen(
  supabaseAdmin: any,
  inmobiliariaId: string,
  inventarioId: string,
  fileName: string,
  buffer: Buffer,
  contentType: TipoImagen
): Promise<string> {
  const filePath = `${inmobiliariaId}/${inventarioId}/${fileName}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('firmas_biometricas')
    .upload(filePath, buffer, {
      contentType,
      upsert: true
    });

  if (uploadError) {
    console.error(`[Biometría Backend] Error al subir ${fileName}:`, uploadError.message);
    throw new Error(`Error al subir imagen ${fileName}: ${uploadError.message}`);
  }

  const { data } = supabaseAdmin.storage
    .from('firmas_biometricas')
    .getPublicUrl(filePath);

  if (!data?.publicUrl) {
    throw new Error(`No se pudo obtener la URL pública de ${fileName}`);
  }

  return data.publicUrl;
}

interface BiometriaPartData {
  firma: string; // Base64
  selfie: string; // Base64
  cedula: string; // Base64
  ocr_metadata: {
    numero_identidad: string;
    nombre_completo: string;
  };
}

interface BiometriaPayload {
  asesor: BiometriaPartData;
  // selfie_omitida: el asesor apagó «Tomar foto del rostro del inquilino» porque no la autorizó.
  inquilino: BiometriaPartData & { selfie_omitida?: boolean };
}

/**
 * Guarda las firmas biométricas, sube las imágenes y actualiza el inventario y sus tareas.
 */
export async function guardarFirmaBiometrica(inventarioId: string, payload: BiometriaPayload) {
  try {
    if (!inventarioId) {
      return { success: false, error: 'ID de inventario inválido o vacío.' };
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: 'Sesión expirada o inválida.' };
    }

    // 1. Validar las evidencias antes de tocar Storage o la base. Las obligatorias tienen que estar
    // y cada una tiene que ser la imagen que dice ser; si una falla se rechaza el acta entera y no
    // queda nada subido a medias.
    const selfieInquilinoOmitida = payload.inquilino.selfie_omitida === true;
    const evidencias: Evidencia[] = [
      { rol: 'asesor', archivo: 'firma_asesor.png', tipo: 'image/png', dataUrl: payload.asesor.firma, descripcion: 'la firma del asesor' },
      { rol: 'asesor', archivo: 'selfie_asesor.jpg', tipo: 'image/jpeg', dataUrl: payload.asesor.selfie, descripcion: 'la foto del rostro del asesor' },
      { rol: 'asesor', archivo: 'cedula_asesor.jpg', tipo: 'image/jpeg', dataUrl: payload.asesor.cedula, descripcion: 'la foto de la cédula del asesor' },
      { rol: 'inquilino', archivo: 'firma_inquilino.png', tipo: 'image/png', dataUrl: payload.inquilino.firma, descripcion: 'la firma del inquilino' },
      { rol: 'inquilino', archivo: 'cedula_inquilino.jpg', tipo: 'image/jpeg', dataUrl: payload.inquilino.cedula, descripcion: 'la foto de la cédula del inquilino' }
    ];
    // Si el asesor apagó la foto del rostro del inquilino no se pide, y la que mande el navegador se ignora.
    if (!selfieInquilinoOmitida) {
      evidencias.push({ rol: 'inquilino', archivo: 'selfie_inquilino.jpg', tipo: 'image/jpeg', dataUrl: payload.inquilino.selfie, descripcion: 'la foto del rostro del inquilino' });
    }

    const imagenes: { evidencia: Evidencia; imagen: Buffer }[] = [];
    for (const evidencia of evidencias) {
      const imagen = decodificarImagen(evidencia.dataUrl, evidencia.tipo);
      if (!imagen) {
        const problema = evidencia.dataUrl ? 'no es una imagen válida' : 'no llegó';
        console.error(`[Biometría Backend] Inventario ${inventarioId}: ${evidencia.archivo} ${problema}. No se guardó nada.`);
        // El inquilino puede volver a sus pasos desde la cédula; los del asesor ya no se alcanzan.
        const queHacer = evidencia.rol === 'inquilino' ? 'Repite ese paso.' : 'Cancela y vuelve a empezar la firma.';
        return { success: false, error: `No se guardó nada: ${evidencia.descripcion} ${problema}. ${queHacer}` };
      }
      imagenes.push({ evidencia, imagen });
    }

    const supabaseAdmin = createAdminClient();

    // 2. Asegurar que el bucket exista
    await inicializarBucketBiometria();

    // 3. Obtener el inventario para heredar inmobiliaria_id y leer items anteriores
    const { data: inv, error: invErr } = await supabaseAdmin
      .from('inventarios')
      .select('items, creado_por, inmuebles!inner(inmobiliaria_id)')
      .eq('id', inventarioId)
      .single();

    if (invErr || !inv) {
      console.error('[Biometría Backend] Error recuperando inventario:', invErr?.message);
      return { success: false, error: `No se encontró el inventario: ${invErr?.message || 'No encontrado'}` };
    }

    const inmueble = Array.isArray(inv.inmuebles) ? inv.inmuebles[0] : (inv.inmuebles as any);
    const inmobiliariaId = inmueble?.inmobiliaria_id;

    if (!inmobiliariaId) {
      return { success: false, error: 'No se pudo recuperar la inmobiliaria asociada al inmueble.' };
    }

    console.log(`[Biometría Backend] Procesando subida de archivos para Inventario ${inventarioId}...`);

    // 4. Subir las evidencias ya validadas
    const urls = new Map<string, string>();
    for (const { evidencia, imagen } of imagenes) {
      urls.set(
        evidencia.archivo,
        await subirImagen(supabaseAdmin, inmobiliariaId, inventarioId, evidencia.archivo, imagen, evidencia.tipo)
      );
    }

    if (selfieInquilinoOmitida) {
      // El inquilino no autorizó la foto del rostro: no se guarda ninguna, tampoco la que haya
      // dejado en esta ruta un intento anterior que falló a mitad de camino.
      const { error: removeError } = await supabaseAdmin.storage
        .from('firmas_biometricas')
        .remove([`${inmobiliariaId}/${inventarioId}/selfie_inquilino.jpg`]);
      if (removeError) {
        console.error('[Biometría Backend] No se pudo borrar una selfie previa del inquilino:', removeError.message);
      }
    }

    const firmaAsesorUrl = urls.get('firma_asesor.png') ?? '';
    const selfieAsesorUrl = urls.get('selfie_asesor.jpg') ?? '';
    const cedulaAsesorUrl = urls.get('cedula_asesor.jpg') ?? '';
    const firmaInquilinoUrl = urls.get('firma_inquilino.png') ?? '';
    const selfieInquilinoUrl = urls.get('selfie_inquilino.jpg') ?? ''; // Vacía si se omitió.
    const cedulaInquilinoUrl = urls.get('cedula_inquilino.jpg') ?? '';

    console.log('[Biometría Backend] Archivos biométricos subidos con éxito.');

    // 5. Consolidar la clave 'biometria' dentro de 'items' JSONB
    const itemsActuales = (inv.items as Record<string, any>) || {};

    const firmadoAtAsesor = new Date().toISOString();
    const firmadoAtInquilino = new Date().toISOString();

    // Quién desactivó la selfie sale de la sesión, no de lo que mande el navegador.
    let omisionSelfieInquilino: OmisionSelfie | null = null;
    if (selfieInquilinoOmitida) {
      const { data: perfil } = await supabaseAdmin
        .from('usuarios')
        .select('nombre_completo')
        .eq('id', user.id)
        .maybeSingle();

      omisionSelfieInquilino = {
        selfie_omitida: true,
        selfie_omitida_por: {
          usuario_id: user.id,
          nombre: perfil?.nombre_completo || payload.asesor.ocr_metadata.nombre_completo || user.email || 'Asesor'
        },
        selfie_omitida_at: firmadoAtInquilino
      };
    }

    // Generar hashes SHA-256 de integridad para cada firmante
    const hashAsesor = generarHashIntegridad({
      firmaUrl: firmaAsesorUrl,
      selfieUrl: selfieAsesorUrl,
      cedulaUrl: cedulaAsesorUrl,
      nombreOcr: payload.asesor.ocr_metadata.nombre_completo,
      identidadOcr: payload.asesor.ocr_metadata.numero_identidad,
      firmadoAt: firmadoAtAsesor,
      inventarioId,
      rol: 'asesor'
    });

    const hashInquilino = generarHashIntegridad({
      firmaUrl: firmaInquilinoUrl,
      selfieUrl: selfieInquilinoUrl,
      cedulaUrl: cedulaInquilinoUrl,
      nombreOcr: payload.inquilino.ocr_metadata.nombre_completo,
      identidadOcr: payload.inquilino.ocr_metadata.numero_identidad,
      firmadoAt: firmadoAtInquilino,
      inventarioId,
      rol: 'inquilino',
      omisionSelfie: omisionSelfieInquilino
    });

    console.log(`[Biometría Backend] Hash SHA-256 Asesor: ${hashAsesor.substring(0, 16)}...`);
    console.log(`[Biometría Backend] Hash SHA-256 Inquilino: ${hashInquilino.substring(0, 16)}...`);
    
    const biometria = {
      asesor: {
        firma_url: firmaAsesorUrl,
        selfie_url: selfieAsesorUrl,
        cedula_url: cedulaAsesorUrl,
        ocr_metadata: {
          numero_identidad: payload.asesor.ocr_metadata.numero_identidad,
          nombre_completo: payload.asesor.ocr_metadata.nombre_completo
        },
        firmado_at: firmadoAtAsesor,
        hash_integridad: hashAsesor
      },
      inquilino: {
        firma_url: firmaInquilinoUrl,
        selfie_url: selfieInquilinoUrl,
        cedula_url: cedulaInquilinoUrl,
        ocr_metadata: {
          numero_identidad: payload.inquilino.ocr_metadata.numero_identidad,
          nombre_completo: payload.inquilino.ocr_metadata.nombre_completo
        },
        firmado_at: firmadoAtInquilino,
        hash_integridad: hashInquilino,
        ...(omisionSelfieInquilino ?? {})
      }
    };

    const itemsActualizados = {
      ...itemsActuales,
      // Integrar las firmas también en la clave tradicional 'firmas' para compatibilidad si es necesario
      firmas: {
        ...itemsActuales.firmas,
        arrendador: {
          nombre: payload.asesor.ocr_metadata.nombre_completo,
          cc: payload.asesor.ocr_metadata.numero_identidad
        },
        arrendatario: {
          nombre: payload.inquilino.ocr_metadata.nombre_completo,
          cc: payload.inquilino.ocr_metadata.numero_identidad
        }
      },
      biometria
    };

    // 6. Actualizar inventario en base de datos
    const { error: updateInvErr } = await supabaseAdmin
      .from('inventarios')
      .update({
        items: itemsActualizados,
        estado: 'completado'
      })
      .eq('id', inventarioId);

    if (updateInvErr) {
      console.error('[Biometría Backend] Error al actualizar inventario:', updateInvErr.message);
      return { success: false, error: `Error al actualizar inventario: ${updateInvErr.message}` };
    }

    // 7. Completar la tarea asociada de "Firmar inventario"
    const { error: updateTaskErr } = await supabaseAdmin
      .from('tareas')
      .update({
        estado: 'completada',
        completada_at: new Date().toISOString(),
        completada_por: user.id
      })
      .eq('entidad_id', inventarioId)
      .eq('titulo', 'Firmar inventario');

    if (updateTaskErr) {
      console.warn('[Biometría Backend] Advertencia: No se pudo actualizar la tarea de firma:', updateTaskErr.message);
    }

    console.log('[Biometría Backend] Inventario y Tareas actualizados con éxito.');

    // 8. Revalidar rutas
    revalidatePath('/inventarios');
    revalidatePath('/dashboard');
    revalidatePath('/tareas');

    return { success: true, message: 'La firma biométrica ha sido registrada y el inventario fue completado con éxito.' };

  } catch (error: any) {
    console.error('[Biometría Backend] Excepción total en Server Action:', error);
    return { success: false, error: error.message || 'Error interno del servidor.' };
  }
}
