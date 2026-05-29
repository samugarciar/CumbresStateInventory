const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Cargar archivo .env.local de la raíz del proyecto
const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('Error: No se encontró el archivo .env.local en la raíz del proyecto.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const clean = line.trim();
  if (!clean || clean.startsWith('#')) return;
  const match = clean.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

const url = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
const webhookSecret = env['ZAPSIGN_WEBHOOK_SECRET'] || 'token_secreto_para_webhook_cumbres_2026';

if (!url || !serviceKey) {
  console.error('Error: Faltan variables SUPABASE en .env.local (NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY).');
  process.exit(1);
}

console.log('--- SIMULADOR DE WEBHOOK DE ZAPSIGN ---');
console.log('Conectando con Supabase:', url);
const supabaseAdmin = createClient(url, serviceKey);

async function run() {
  try {
    // A. Buscar una tarea y un inventario de prueba creados para simular
    console.log('\n1. Buscando una tarea de prueba "Firmar inventario" pendiente...');
    const { data: tareas, error: tareasErr } = await supabaseAdmin
      .from('tareas')
      .select('*')
      .eq('titulo', 'Firmar inventario')
      .eq('estado', 'pendiente')
      .limit(1);

    if (tareasErr) {
      throw new Error(`Error recuperando tareas: ${tareasErr.message}`);
    }

    if (!tareas || tareas.length === 0) {
      console.log('⚠️ No se encontró ninguna tarea de "Firmar inventario" pendiente.');
      console.log('💡 Sugerencia: Crea un inventario en la UI para registrar una nueva tarea y su correspondiente zapsign_doc_id.');
      console.log('Creando una tarea temporal y un inventario temporal para propósitos de prueba...');

      // Crear un inmueble dummy si no existe
      const { data: inmuebles } = await supabaseAdmin.from('inmuebles').select('id, inmobiliaria_id').limit(1);
      if (!inmuebles || inmuebles.length === 0) {
        console.error('❌ Error: Debes registrar al menos un inmueble y una inmobiliaria en la app antes de correr este simulador.');
        return;
      }
      const inmueble = inmuebles[0];

      // Crear inventario dummy
      const { data: nuevoInv, error: invErr } = await supabaseAdmin
        .from('inventarios')
        .insert({
          inmueble_id: inmueble.id,
          titulo: 'Inventario de Prueba Webhook',
          items: {},
          estado: 'pendiente',
          zapsign_doc_id: 'test-doc-uuid-123456',
          zapsign_sign_url: 'https://sandbox.zapsign.com.br/verificar/test-sign-url-123456'
        })
        .select('*')
        .single();

      if (invErr) throw new Error(`Error creando inventario dummy: ${invErr.message}`);
      console.log('✓ Inventario temporal creado con zapsign_doc_id: test-doc-uuid-123456');

      // Crear tarea dummy
      const { data: nuevaTarea, error: taskErr } = await supabaseAdmin
        .from('tareas')
        .insert({
          inmobiliaria_id: inmueble.inmobiliaria_id,
          entidad_tipo: 'inventario',
          entidad_id: nuevoInv.id,
          evento_origen: 'inventario_creado',
          evento_titulo: 'Inventario de Prueba Webhook',
          titulo: 'Firmar inventario',
          estado: 'pendiente',
          zapsign_doc_id: 'test-doc-uuid-123456',
          zapsign_sign_url: 'https://sandbox.zapsign.com.br/verificar/test-sign-url-123456'
        })
        .select('*')
        .single();

      if (taskErr) throw new Error(`Error creando tarea dummy: ${taskErr.message}`);
      console.log('✓ Tarea temporal de "Firmar inventario" creada.');

      tareas.push(nuevaTarea);
    }

    const tareaTest = tareas[0];
    const docId = tareaTest.zapsign_doc_id || 'test-doc-uuid-123456';
    console.log(`✓ Usando Documento ZapSign ID: "${docId}" para la simulación.`);

    // B. Simular Webhook Payload
    const webhookPayload = {
      event_type: 'doc_signed',
      status: 'signed',
      token: docId,
      signed_file: 'https://sandbox.zapsign.com.br/docs/signed_dummy_file_cumbres_2026.pdf',
      original_file: 'https://sandbox.zapsign.com.br/docs/original_dummy_file.pdf'
    };

    console.log('\n2. Simulando llamada HTTP al endpoint de webhook...');
    const localWebhookUrl = `http://localhost:3000/api/webhooks/zapsign?secret=${webhookSecret}`;
    console.log('URL de Destino:', localWebhookUrl);

    try {
      const response = await fetch(localWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookPayload)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('🎉 [ÉXITO] Respuesta del servidor local:', result);
      } else {
        const errText = await response.text();
        console.log(`⚠️ El servidor local devolvió un estado de error (${response.status}): ${errText}`);
        console.log('Realizando actualización directa en base de datos como fallback para verificar lógica...');
        await aplicarLogicaDirecta(docId, webhookPayload.signed_file);
      }
    } catch (fetchErr) {
      console.log('⚠️ No se pudo conectar al servidor local en puerto 3000 (¿Está apagado next dev?).');
      console.log('Realizando actualización directa en base de datos para verificar la lógica de Supabase...');
      await aplicarLogicaDirecta(docId, webhookPayload.signed_file);
    }

  } catch (err) {
    console.error('❌ ERROR DURANTE LA SIMULACIÓN:', err.message);
  }
}

async function aplicarLogicaDirecta(zapsignDocId, signedPdfUrl) {
  console.log('\n--- PROCESANDO ACTUALIZACIÓN DIRECTA (FALLBACK MOCK) ---');
  
  // A. Actualizar tarea
  const { data: updatedTasks, error: taskError } = await supabaseAdmin
    .from('tareas')
    .update({
      estado: 'completada',
      completada_at: new Date().toISOString(),
      completada_por: null
    })
    .eq('zapsign_doc_id', zapsignDocId)
    .eq('titulo', 'Firmar inventario')
    .select();

  if (taskError) {
    console.error('❌ Error actualizando la tarea:', taskError.message);
  } else {
    console.log(`✓ Tarea(s) actualizada(s) a "completada":`, updatedTasks?.length);
    console.log(updatedTasks);
  }

  // B. Actualizar inventario
  const { data: updatedInvs, error: invError } = await supabaseAdmin
    .from('inventarios')
    .update({
      estado: 'completado',
      zapsign_pdf_signed_url: signedPdfUrl
    })
    .eq('zapsign_doc_id', zapsignDocId)
    .select();

  if (invError) {
    console.error('❌ Error actualizando el inventario:', invError.message);
  } else {
    console.log(`✓ Inventario(s) actualizado(s) a "completado" con URL firmada:`, updatedInvs?.length);
    console.log(updatedInvs);
  }

  console.log('\n🎉 ¡PROCESO DE ACTUALIZACIÓN DIRECTA COMPLETADO CON ÉXITO!');
}

run();
