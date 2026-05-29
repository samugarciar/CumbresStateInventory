const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('Error: No se encontró el archivo .env.local');
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

const supabaseAdmin = createClient(url, serviceKey);

async function run() {
  console.log('--- REVISANDO SUPABASE ---');
  
  // 1. Listar buckets de storage
  const { data: buckets, error: storageErr } = await supabaseAdmin.storage.listBuckets();
  if (storageErr) {
    console.error('Error al listar buckets:', storageErr.message);
  } else {
    console.log('Buckets existentes:', buckets.map(b => b.name));
  }

  // 2. Revisar si la columna `firma_biometrica` existe en `inventarios`
  // Haremos una consulta rápida de un inventario
  const { data: invs, error: invErr } = await supabaseAdmin.from('inventarios').select('*').limit(1);
  if (invErr) {
    console.error('Error al consultar inventarios:', invErr.message);
  } else {
    console.log('Columnas de inventarios (de la muestra):', invs.length > 0 ? Object.keys(invs[0]) : 'Sin registros');
  }
}

run();
