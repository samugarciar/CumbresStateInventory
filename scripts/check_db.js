const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local manually
const envPath = path.join(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
  if (match) {
    env[match[1]] = match[2].trim();
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Credentials not found in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('--- USUARIOS ---');
  const { data: usuarios, error: uErr } = await supabase.from('usuarios').select('id, email, nombre_completo, rol, inmobiliaria_id');
  if (uErr) console.error(uErr);
  else console.table(usuarios);

  console.log('--- INMUEBLES ---');
  const { data: inmuebles, error: inmErr } = await supabase.from('inmuebles').select('id, titulo, asesor_id, inmobiliaria_id');
  if (inmErr) console.error(inmErr);
  else console.table(inmuebles);

  console.log('--- INVENTARIOS ---');
  const { data: inventarios, error: invErr } = await supabase.from('inventarios').select('id, titulo, creado_por, inmueble_id, estado, arrendasoft_contrato_id, contrato_id_propuesto');
  if (invErr) console.error(invErr);
  else console.table(inventarios);

  console.log('--- TAREAS PENDIENTES ---');
  const { data: tareas, error: tErr } = await supabase.from('tareas').select('id, titulo, entidad_id, entidad_tipo, estado, usuario_id');
  if (tErr) console.error(tErr);
  else console.table(tareas);
}

main();
