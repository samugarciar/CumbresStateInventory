const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const envPath = path.join(__dirname, '.env.local');
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

if (!url || !serviceKey) {
  console.error('Error: Faltan variables en .env.local');
  process.exit(1);
}

const supabaseAdmin = createClient(url, serviceKey);

async function run() {
  console.log('Iniciando registro forzado de administrador para evitar límites de correo...');

  const nombreInmobiliaria = 'Inmobiliaria Cumbres';
  const nit = '901552385';
  const nombreCompleto = 'Administrador Cumbres';
  const email = 'arrendamientos.cumbres@gmail.com';
  const password = 'Cumbres2026!'; // Puedes cambiarla después

  try {
    // 1. Limpiar previos para evitar conflictos de duplicado
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    if (existingUsers?.users) {
      for (const u of existingUsers.users) {
        if (u.email === email) {
          await supabaseAdmin.auth.admin.deleteUser(u.id);
          console.log('Limpiado usuario previo duplicado:', email);
        }
      }
    }
    await supabaseAdmin.from('inmobiliarias').delete().eq('nit', nit);

    // 2. Insertar Inmobiliaria
    const { data: inmob, error: inmobError } = await supabaseAdmin
      .from('inmobiliarias')
      .insert({ nombre: nombreInmobiliaria, nit })
      .select('id')
      .single();

    if (inmobError) {
      throw new Error(`Error al crear inmobiliaria: ${inmobError.message}`);
    }
    console.log('✓ Inmobiliaria creada con ID:', inmob.id);

    // 3. Crear usuario en Auth (confirmado directamente, saltando límites y correos)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true // Confirmar correo automáticamente
    });

    if (authError) {
      throw new Error(`Error en Auth: ${authError.message}`);
    }
    const user = authData.user;
    console.log('✓ Usuario de autenticación creado en Auth con ID:', user.id);

    // 4. Crear Perfil en la tabla usuarios
    const { error: profileError } = await supabaseAdmin.from('usuarios').insert({
      id: user.id,
      inmobiliaria_id: inmob.id,
      nombre_completo: nombreCompleto,
      email,
      rol: 'admin'
    });

    if (profileError) {
      // Rollback si falla
      await supabaseAdmin.auth.admin.deleteUser(user.id);
      await supabaseAdmin.from('inmobiliarias').delete().eq('id', inmob.id);
      throw new Error(`Error al crear perfil público: ${profileError.message}`);
    }
    console.log('✓ Perfil administrativo creado con éxito en la tabla "usuarios".');

    console.log('\n==================================================');
    console.log('🎉 ¡REGISTRO EXITOSO COMPLETADO!');
    console.log('Ya puedes iniciar sesión en la aplicación.');
    console.log('Credenciales de acceso:');
    console.log(`- Correo: ${email}`);
    console.log(`- Contraseña: ${password}`);
    console.log('==================================================');

  } catch (e) {
    console.error('❌ ERROR DURANTE EL REGISTRO:', e.message);
  }
}

run();
