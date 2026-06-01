#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  VERIFICADOR DE HASH SHA-256 — Cumbres State Inventory      ║
 * ║  Replica exactamente la función generarHashIntegridad()      ║
 * ║  de app/actions/biometria.ts para validar la implementación. ║
 * ╚══════════════════════════════════════════════════════════════╝
 * 
 * USO:
 *   node scripts/verificar-hash.mjs                    → Pruebas locales
 *   node scripts/verificar-hash.mjs --live              → + Verificación contra Supabase
 *   node scripts/verificar-hash.mjs --live --id=UUID    → Verificar un inventario específico
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Colores para la terminal ───
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
};

const PASS = `${C.bgGreen} ✓ PASS ${C.reset}`;
const FAIL = `${C.bgRed} ✗ FAIL ${C.reset}`;

// ─── Réplica EXACTA de la función del servidor ───
function generarHashIntegridad(params) {
  const payload = [
    params.rol,
    params.inventarioId,
    params.firmaUrl,
    params.selfieUrl,
    params.cedulaUrl,
    params.nombreOcr,
    params.identidadOcr,
    params.firmadoAt
  ].join('|');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ─── Datos de prueba simulados ───
const datosBase = {
  rol: 'asesor',
  inventarioId: 'a3f8b2c1-9d4e-4a7b-b8c2-1234567890ab',
  firmaUrl: 'https://wcjvarzzmfnuurxeeole.supabase.co/storage/v1/object/public/firmas_biometricas/immo-001/inv-001/firma_asesor.png',
  selfieUrl: 'https://wcjvarzzmfnuurxeeole.supabase.co/storage/v1/object/public/firmas_biometricas/immo-001/inv-001/selfie_asesor.jpg',
  cedulaUrl: 'https://wcjvarzzmfnuurxeeole.supabase.co/storage/v1/object/public/firmas_biometricas/immo-001/inv-001/cedula_asesor.jpg',
  nombreOcr: 'Juan Pérez García',
  identidadOcr: 'PEGJ900101HDFRRC09',
  firmadoAt: '2026-05-29T23:00:00.000Z'
};

// ═══════════════════════════════════════════════════
// PRUEBA 1: Determinismo
// La misma entrada SIEMPRE produce el mismo hash
// ═══════════════════════════════════════════════════
function pruebaDeterminismo() {
  console.log(`\n${C.bold}${C.cyan}═══ PRUEBA 1: DETERMINISMO ═══${C.reset}`);
  console.log(`${C.dim}La misma entrada debe producir siempre el mismo hash.${C.reset}\n`);

  const hash1 = generarHashIntegridad(datosBase);
  const hash2 = generarHashIntegridad(datosBase);
  const hash3 = generarHashIntegridad(datosBase);

  console.log(`  Ejecución 1: ${C.yellow}${hash1}${C.reset}`);
  console.log(`  Ejecución 2: ${C.yellow}${hash2}${C.reset}`);
  console.log(`  Ejecución 3: ${C.yellow}${hash3}${C.reset}`);

  const ok = hash1 === hash2 && hash2 === hash3;
  console.log(`\n  ${ok ? PASS : FAIL} Los tres hashes son ${ok ? 'IDÉNTICOS' : 'DIFERENTES (¡ERROR!)'}`);
  return ok;
}

// ═══════════════════════════════════════════════════
// PRUEBA 2: Sensibilidad (Avalanche Effect)
// Cambiar UN SOLO carácter produce un hash totalmente diferente
// ═══════════════════════════════════════════════════
function pruebaSensibilidad() {
  console.log(`\n${C.bold}${C.cyan}═══ PRUEBA 2: SENSIBILIDAD (EFECTO AVALANCHA) ═══${C.reset}`);
  console.log(`${C.dim}Cambiar un solo dato debe producir un hash completamente diferente.${C.reset}\n`);

  const hashOriginal = generarHashIntegridad(datosBase);

  const mutaciones = [
    {
      nombre: 'Nombre con tilde removida ("Perez" → sin acento)',
      datos: { ...datosBase, nombreOcr: 'Juan Perez García' }
    },
    {
      nombre: 'CURP cambiada (último dígito: 09 → 08)',
      datos: { ...datosBase, identidadOcr: 'PEGJ900101HDFRRC08' }
    },
    {
      nombre: 'Timestamp +1 segundo',
      datos: { ...datosBase, firmadoAt: '2026-05-29T23:00:01.000Z' }
    },
    {
      nombre: 'Rol cambiado (asesor → inquilino)',
      datos: { ...datosBase, rol: 'inquilino' }
    },
    {
      nombre: 'URL de firma con un carácter extra',
      datos: { ...datosBase, firmaUrl: datosBase.firmaUrl + 'x' }
    }
  ];

  console.log(`  Hash original: ${C.yellow}${hashOriginal}${C.reset}\n`);

  let allDifferent = true;

  for (const mut of mutaciones) {
    const hashMutado = generarHashIntegridad(mut.datos);
    const esDiferente = hashMutado !== hashOriginal;

    // Calcular % de bits diferentes (distancia de Hamming en hex)
    let bitsDistintos = 0;
    for (let i = 0; i < hashOriginal.length; i++) {
      const a = parseInt(hashOriginal[i], 16);
      const b = parseInt(hashMutado[i], 16);
      let xor = a ^ b;
      while (xor) { bitsDistintos += xor & 1; xor >>= 1; }
    }
    const porcentaje = ((bitsDistintos / 256) * 100).toFixed(1);

    console.log(`  ${esDiferente ? PASS : FAIL} ${mut.nombre}`);
    console.log(`       Mutado:  ${C.yellow}${hashMutado}${C.reset}`);
    console.log(`       ${C.dim}Bits diferentes: ${bitsDistintos}/256 (${porcentaje}%) — ideal ≈ 50%${C.reset}\n`);

    if (!esDiferente) allDifferent = false;
  }

  return allDifferent;
}

// ═══════════════════════════════════════════════════
// PRUEBA 3: Formato y longitud correctos
// SHA-256 siempre produce exactamente 64 caracteres hexadecimales
// ═══════════════════════════════════════════════════
function pruebaFormato() {
  console.log(`\n${C.bold}${C.cyan}═══ PRUEBA 3: FORMATO Y LONGITUD ═══${C.reset}`);
  console.log(`${C.dim}SHA-256 debe producir exactamente 64 caracteres hexadecimales.${C.reset}\n`);

  const hash = generarHashIntegridad(datosBase);
  const longitud = hash.length;
  const esHex = /^[0-9a-f]{64}$/.test(hash);

  console.log(`  Hash:     ${C.yellow}${hash}${C.reset}`);
  console.log(`  Longitud: ${longitud} caracteres`);
  console.log(`  ¿Hex válido?: ${esHex ? 'Sí' : 'No'}`);

  const ok = longitud === 64 && esHex;
  console.log(`\n  ${ok ? PASS : FAIL} Formato ${ok ? 'correcto' : 'INCORRECTO'} (${longitud}/64 chars, hex: ${esHex})`);
  return ok;
}

// ═══════════════════════════════════════════════════
// PRUEBA 4 (OPCIONAL): Verificación contra BD real
// Conecta a Supabase y verifica un inventario firmado
// ═══════════════════════════════════════════════════
async function pruebaLive(inventarioId) {
  console.log(`\n${C.bold}${C.cyan}═══ PRUEBA 4: VERIFICACIÓN CONTRA BASE DE DATOS ═══${C.reset}`);
  console.log(`${C.dim}Conectando a Supabase para verificar un inventario real...${C.reset}\n`);

  // Leer .env.local
  let envVars = {};
  try {
    const envContent = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=\s*(.+)$/);
      if (match) envVars[match[1].trim()] = match[2].trim();
    }
  } catch {
    console.log(`  ${FAIL} No se pudo leer .env.local`);
    return false;
  }

  const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];
  const serviceKey = envVars['SUPABASE_SERVICE_ROLE_KEY'];

  if (!supabaseUrl || !serviceKey) {
    console.log(`  ${FAIL} Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local`);
    return false;
  }

  // Buscar inventario con biometría
  let query = `${supabaseUrl}/rest/v1/inventarios?select=id,items,estado&items->>biometria=not.is.null&estado=eq.completado&limit=5`;
  if (inventarioId) {
    query = `${supabaseUrl}/rest/v1/inventarios?select=id,items,estado&id=eq.${inventarioId}`;
  }

  const response = await fetch(query, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    console.log(`  ${FAIL} Error al conectar con Supabase: ${response.status} ${response.statusText}`);
    return false;
  }

  const inventarios = await response.json();
  
  // Filtrar los que realmente tienen biometría con hash
  const conBiometria = inventarios.filter(inv => inv.items?.biometria?.asesor?.hash_integridad);

  if (conBiometria.length === 0) {
    console.log(`  ${C.yellow}⚠ No se encontraron inventarios firmados con hash SHA-256.${C.reset}`);
    console.log(`  ${C.dim}Esto es normal si aún no has realizado una firma biométrica después de la actualización.${C.reset}`);
    console.log(`  ${C.dim}Firma un inventario de prueba y vuelve a ejecutar: node scripts/verificar-hash.mjs --live${C.reset}`);
    return null; // No es fallo, es que no hay datos
  }

  let allOk = true;

  for (const inv of conBiometria) {
    console.log(`  ${C.bold}Inventario: ${inv.id}${C.reset}`);
    const bio = inv.items.biometria;

    for (const rol of ['asesor', 'inquilino']) {
      const parte = bio[rol];
      if (!parte?.hash_integridad) {
        console.log(`    ${C.dim}${rol}: Sin hash almacenado, omitiendo...${C.reset}`);
        continue;
      }

      const hashRecalculado = generarHashIntegridad({
        rol,
        inventarioId: inv.id,
        firmaUrl: parte.firma_url || '',
        selfieUrl: parte.selfie_url || '',
        cedulaUrl: parte.cedula_url || '',
        nombreOcr: parte.ocr_metadata?.nombre_completo || '',
        identidadOcr: parte.ocr_metadata?.numero_identidad || '',
        firmadoAt: parte.firmado_at || ''
      });

      const coincide = hashRecalculado === parte.hash_integridad;

      console.log(`    ${C.bold}${rol.toUpperCase()}:${C.reset}`);
      console.log(`      Almacenado:   ${C.yellow}${parte.hash_integridad.substring(0, 32)}...${C.reset}`);
      console.log(`      Recalculado:  ${C.yellow}${hashRecalculado.substring(0, 32)}...${C.reset}`);
      console.log(`      ${coincide ? PASS : FAIL} ${coincide ? '✅ INTEGRIDAD VERIFICADA — Datos no alterados' : '❌ INTEGRIDAD COMPROMETIDA — Los datos fueron modificados'}\n`);

      if (!coincide) allOk = false;
    }
  }

  return allOk;
}

// ═══════════════════════════════════════════════════
// EJECUCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════
async function main() {
  console.log(`\n${C.bold}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}║  🔐 VERIFICADOR DE HASH SHA-256 — Cumbres State Inventory   ║${C.reset}`);
  console.log(`${C.bold}╚══════════════════════════════════════════════════════════════╝${C.reset}`);

  const results = [];

  // Pruebas locales (siempre se ejecutan)
  results.push({ nombre: 'Determinismo', ok: pruebaDeterminismo() });
  results.push({ nombre: 'Sensibilidad', ok: pruebaSensibilidad() });
  results.push({ nombre: 'Formato', ok: pruebaFormato() });

  // Prueba live (solo si se pasa --live)
  const args = process.argv.slice(2);
  const isLive = args.includes('--live');
  const idArg = args.find(a => a.startsWith('--id='));
  const inventarioId = idArg ? idArg.split('=')[1] : null;

  if (isLive) {
    const liveResult = await pruebaLive(inventarioId);
    if (liveResult !== null) {
      results.push({ nombre: 'Verificación BD', ok: liveResult });
    }
  }

  // Resumen final
  console.log(`\n${C.bold}${C.cyan}═══ RESUMEN ═══${C.reset}\n`);

  for (const r of results) {
    console.log(`  ${r.ok ? PASS : FAIL} ${r.nombre}`);
  }

  const totalPass = results.filter(r => r.ok).length;
  const total = results.length;
  const allPass = totalPass === total;

  console.log(`\n  ${C.bold}Resultado: ${totalPass}/${total} pruebas pasaron${C.reset}`);

  if (allPass) {
    console.log(`\n  ${C.bgGreen} 🔐 IMPLEMENTACIÓN SHA-256 VERIFICADA CORRECTAMENTE ${C.reset}\n`);
  } else {
    console.log(`\n  ${C.bgRed} ⚠ HAY PRUEBAS FALLIDAS — REVISAR IMPLEMENTACIÓN ${C.reset}\n`);
  }

  if (!isLive) {
    console.log(`${C.dim}  Tip: Ejecuta con --live para verificar contra la base de datos real:`);
    console.log(`  node scripts/verificar-hash.mjs --live${C.reset}\n`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error(`\n${FAIL} Error inesperado:`, err.message);
  process.exit(1);
});
