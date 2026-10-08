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

/**
 * Sube una imagen Base64 a Supabase Storage y retorna su URL pública.
 */
async function subirImagenBase64(
  supabaseAdmin: any,
  inmobiliariaId: string,
  inventarioId: string,
  fileName: string,
  base64Data: string,
  contentType: string
): Promise<string> {
  // Limpiar el prefijo de Data URL si existe
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Clean, 'base64');
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

    const supabaseAdmin = createAdminClient();

    // 1. Asegurar que el bucket exista
    await inicializarBucketBiometria();

    // 2. Obtener el inventario para heredar inmobiliaria_id y leer items anteriores
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

    // 3. Subir archivos de Asesor
    let firmaAsesorUrl = '';
    let selfieAsesorUrl = '';
    let cedulaAsesorUrl = '';
    
    if (payload.asesor.firma) {
      firmaAsesorUrl = await subirImagenBase64(
        supabaseAdmin, inmobiliariaId, inventarioId, 'firma_asesor.png', payload.asesor.firma, 'image/png'
      );
    }
    if (payload.asesor.selfie) {
      selfieAsesorUrl = await subirImagenBase64(
        supabaseAdmin, inmobiliariaId, inventarioId, 'selfie_asesor.jpg', payload.asesor.selfie, 'image/jpeg'
      );
    }
    if (payload.asesor.cedula) {
      cedulaAsesorUrl = await subirImagenBase64(
        supabaseAdmin, inmobiliariaId, inventarioId, 'cedula_asesor.jpg', payload.asesor.cedula, 'image/jpeg'
      );
    }

    // 4. Subir archivos de Inquilino
    let firmaInquilinoUrl = '';
    let selfieInquilinoUrl = '';
    let cedulaInquilinoUrl = '';
    const selfieInquilinoOmitida = payload.inquilino.selfie_omitida === true;

    if (payload.inquilino.firma) {
      firmaInquilinoUrl = await subirImagenBase64(
        supabaseAdmin, inmobiliariaId, inventarioId, 'firma_inquilino.png', payload.inquilino.firma, 'image/png'
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
    } else if (payload.inquilino.selfie) {
      selfieInquilinoUrl = await subirImagenBase64(
        supabaseAdmin, inmobiliariaId, inventarioId, 'selfie_inquilino.jpg', payload.inquilino.selfie, 'image/jpeg'
      );
    }
    if (payload.inquilino.cedula) {
      cedulaInquilinoUrl = await subirImagenBase64(
        supabaseAdmin, inmobiliariaId, inventarioId, 'cedula_inquilino.jpg', payload.inquilino.cedula, 'image/jpeg'
      );
    }

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
