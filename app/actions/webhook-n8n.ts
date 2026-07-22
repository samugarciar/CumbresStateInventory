'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export interface WebhookResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Server Action para procesar la captación de inmuebles y retransmitirla de forma segura a n8n.
 * Registra cada intento en la tabla public.webhook_logs para auditoría y trazabilidad.
 */
export async function enviarCaptacionWebhook(prevState: any, formData: FormData): Promise<WebhookResult> {
  const supabase = await createClient();

  // 1. Validar sesión de usuario
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, message: 'Sesión no válida. Por favor, inicia sesión de nuevo.' };
  }

  // 2. Obtener perfil e inmobiliaria
  const { data: profile, error: profileErr } = await supabase
    .from('usuarios')
    .select('inmobiliaria_id, nombre_completo')
    .eq('id', user.id)
    .single();

  if (profileErr || !profile) {
    return { success: false, message: 'No se pudo verificar el perfil del usuario.' };
  }

  // 3. Extraer y validar campos obligatorios
  const tituloCaptacion = formData.get('Titulo Captacion') as string;
  const direccion = formData.get('Direccion') as string;
  const barrio = formData.get('Barrio') as string;
  const precioRaw = formData.get('Precio(COP)') as string;
  const asesor = formData.get('Asesor') as string;

  // Campos nuevos de captación (todos obligatorios)
  const tipoOperacion = formData.get('Tipo Operacion') as string;
  const emailProp = formData.get('Email prop') as string;
  const estratoRaw = formData.get('Estrato') as string;
  const municipio = formData.get('Municipio') as string;

  if (!tituloCaptacion || !direccion || !barrio || !precioRaw || !asesor || !tipoOperacion || !emailProp || !estratoRaw || !municipio) {
    return { success: false, message: 'Por favor, completa todos los campos requeridos.' };
  }

  const precio = Number(precioRaw);
  if (isNaN(precio) || precio <= 0) {
    return { success: false, message: 'El precio debe ser un número positivo válido.' };
  }

  // Validar valores enumerados y formato para que lleguen a n8n exactamente como se espera
  const tiposOperacionValidos = ['arriendo', 'venta', 'venta y arriendo'];
  if (!tiposOperacionValidos.includes(tipoOperacion)) {
    return { success: false, message: 'El tipo de operación seleccionado no es válido.' };
  }

  const municipiosValidos = ['Medellin', 'Bello', 'Sabaneta', 'Envigado'];
  if (!municipiosValidos.includes(municipio)) {
    return { success: false, message: 'El municipio seleccionado no es válido.' };
  }

  const estratoNum = Number(estratoRaw);
  if (!Number.isInteger(estratoNum) || estratoNum < 1 || estratoNum > 6) {
    return { success: false, message: 'El estrato debe ser un número entre 1 y 6.' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(emailProp)) {
    return { success: false, message: 'El email del propietario no tiene un formato válido.' };
  }

  // 4. Agrupar campos para guardar en el payload del log
  const payloadJson: Record<string, any> = {};
  formData.forEach((value, key) => {
    // Las fotos se manejan por separado, no en el JSON del payload
    if (key !== 'Fotos') {
      payloadJson[key] = value;
    }
  });

  // 5. Procesar archivos (Fotos) y calcular pesos
  const fotos = formData.getAll('Fotos') as File[];
  let totalSizeBytes = 0;
  const validFiles: File[] = [];

  for (const foto of fotos) {
    if (foto && foto.size > 0) {
      totalSizeBytes += foto.size;
      validFiles.push(foto);
    }
  }

  // 6. Insertar registro inicial en public.webhook_logs en estado 'enviando'
  const { data: logRecord, error: logInsertError } = await supabase
    .from('webhook_logs')
    .insert({
      inmobiliaria_id: profile.inmobiliaria_id,
      usuario_id: user.id,
      titulo_captacion: tituloCaptacion,
      asesor_nombre: asesor,
      precio: precio,
      estado: 'enviando',
      payload: payloadJson,
      files_count: validFiles.length,
      files_size_bytes: totalSizeBytes
    })
    .select('id')
    .single();

  if (logInsertError || !logRecord) {
    console.error('Error al registrar log de webhook:', logInsertError);
    return { success: false, message: 'Fallo al registrar la auditoría en la base de datos local.' };
  }

  const logId = logRecord.id;

  // 7. Preparar la retransmisión Multipart/Form-Data a n8n
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nWebhookUrl) {
    const errorMsg = 'URL del Webhook de n8n no configurada en las variables de entorno (.env.local)';
    await supabase
      .from('webhook_logs')
      .update({ estado: 'fallido', error_detalles: errorMsg })
      .eq('id', logId);

    return { success: false, message: 'Error de configuración interna del servidor.', error: errorMsg };
  }

  try {
    const n8nFormData = new FormData();

    // Mapear campos EXACTAMENTE como los espera el flujo n8n, incluyendo espacios al final de las llaves
    n8nFormData.append('Titulo Captacion', tituloCaptacion);
    n8nFormData.append('Unidad', (formData.get('Unidad') as string) || 'n/a');
    n8nFormData.append('Direccion', direccion);
    n8nFormData.append('Apartamento', (formData.get('Apartamento') as string) || 'n/a');
    n8nFormData.append('Barrio', barrio);
    n8nFormData.append('Precio(COP)', precioRaw);
    n8nFormData.append('Asesor', asesor);

    // Campos nuevos: viajan en el mismo body con las llaves exactas que espera n8n
    n8nFormData.append('Tipo Operacion', tipoOperacion);
    n8nFormData.append('Municipio', municipio);
    n8nFormData.append('Estrato', String(estratoNum));

    n8nFormData.append('num de habitaciones', (formData.get('num de habitaciones') as string) || '0');
    n8nFormData.append('num de baños', (formData.get('num de baños') as string) || '0');
    // NOTA CRÍTICA: Mantener el espacio al final del nombre 'num de closet ' tal como lo tiene el código de n8n
    n8nFormData.append('num de closet ', (formData.get('num de closet') as string) || '0');
    n8nFormData.append('Area', (formData.get('Area') as string) || '0');

    // NOTA CRÍTICA: Mantener el espacio al final del nombre 'Cocina ' tal como lo tiene el código de n8n
    n8nFormData.append('Cocina ', (formData.get('Cocina') as string) || 'No aplica');
    n8nFormData.append('Parqueadero', (formData.get('Parqueadero') as string) || 'No');

    // Comodidades Si/No
    const comodidades = [
      'Sala', 'Sala comedor', 'Estudio', 'Comedor', 'Barra', 
      'Instalación de gas', 'Calentador', 'Balcon', 'Cuarto Util', 
      'Unidad Cerrada', 'Piscina', 'Cancha', 'Gimnasio'
    ];

    comodidades.forEach(com => {
      const val = formData.get(com) === 'on' || formData.get(com) === 'Si' ? 'Si' : 'No';
      n8nFormData.append(com, val);
    });

    n8nFormData.append('Otra Zona común', (formData.get('Otra Zona común') as string) || 'n/a');

    // Datos Propietario / Internos
    n8nFormData.append('Nombre prop', (formData.get('Nombre prop') as string) || 'Sin nombre');
    n8nFormData.append('Num Prop', (formData.get('Num Prop') as string) || 'Sin número');
    n8nFormData.append('Email prop', emailProp);
    n8nFormData.append('Comision(portero)', (formData.get('Comision(portero)') as string) || 'n/a');
    n8nFormData.append('Observaciones', (formData.get('Observaciones') as string) || 'n/a');

    // Mapear archivos como fotos binarias individuales con prefijos secuenciales para n8n
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      // Creamos un Blob a partir del Buffer en el servidor
      const fileBlob = new Blob([buffer], { type: file.type });
      
      // Adjuntar como Fotos_N para emular el comportamiento del disparador de formularios n8n
      n8nFormData.append(`Fotos_${i}`, fileBlob, file.name);
    }

    console.log(`[Webhook] Retransmitiendo captación a n8n: POST ${n8nWebhookUrl} con ${validFiles.length} fotos (${(totalSizeBytes / (1024 * 1024)).toFixed(2)} MB)...`);

    // Hacer la petición POST a n8n
    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      body: n8nFormData,
      // Desactivar caché y añadir timeout de 90 segundos para subidas pesadas
      cache: 'no-store',
      signal: AbortSignal.timeout(90000)
    });

    if (!response.ok) {
      const errText = await response.text();
      const errorMsg = `n8n respondió con error (${response.status}): ${errText}`;
      
      await supabase
        .from('webhook_logs')
        .update({ estado: 'fallido', error_detalles: errorMsg })
        .eq('id', logId);

      return { success: false, message: 'El flujo de n8n retornó un error de procesamiento.', error: errorMsg };
    }

    // 8. Actualizar log a 'exito'
    await supabase
      .from('webhook_logs')
      .update({ estado: 'exito' })
      .eq('id', logId);

    // Generar tareas automáticas de captación para el equipo administrativo
    await supabase
      .from('tareas')
      .insert([
        {
          inmobiliaria_id: profile.inmobiliaria_id,
          usuario_id: user.id,
          entidad_tipo: 'captacion',
          entidad_id: logId,
          evento_origen: 'captacion_creada',
          evento_titulo: direccion || tituloCaptacion,
          titulo: 'Subir a marketplace',
          estado: 'pendiente'
        },
        {
          inmobiliaria_id: profile.inmobiliaria_id,
          usuario_id: user.id,
          entidad_tipo: 'captacion',
          entidad_id: logId,
          evento_origen: 'captacion_creada',
          evento_titulo: direccion || tituloCaptacion,
          titulo: 'Subir a ERP',
          estado: 'pendiente'
        }
      ]);

    revalidatePath('/inmuebles');
    return { success: true, message: 'Captación enviada con éxito. El flujo de automatización (Google Drive, Docs y Facebook) ha iniciado.' };

  } catch (error: any) {
    console.error('Error durante el envío de captación a n8n:', error);
    const errorMsg = error.name === 'TimeoutError' 
      ? 'Tiempo de espera de red agotado (90s). El servidor de n8n tardó demasiado en responder.' 
      : `Excepción de red: ${error.message}`;

    await supabase
      .from('webhook_logs')
      .update({ estado: 'fallido', error_detalles: errorMsg })
      .eq('id', logId);

    return { success: false, message: 'Fallo en la comunicación de red con el servidor de automatización.', error: errorMsg };
  }
}
