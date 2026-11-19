// Chequeos automáticos sobre las corridas de comparar.ts. No reemplazan leer
// las respuestas: cuentan lo que se puede contar sin criterio.
//   node puntaje.mjs <carpeta> <etiqueta>...
import fs from 'node:fs';

const D = process.argv[2];
const casos = JSON.parse(fs.readFileSync(`${D}/casos.json`, 'utf8'));
const APTO = /\b(apto|apartamento|ap)\.?\s*\d{3,4}\b/i;
const CODIGO = /c[oó]digo\s*\d{6,}/i;
const percentil = (xs, p) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length ? o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))] : 0;
};

function fila(nombre, get, real = false) {
  const m = {
    n: 0, errores: 0, escala: 0, apto: 0, codigo: 0, codigoHorarios: 0,
    fuga: 0, vacias: 0, sinFormato: 0, partes: 0, largo: 0, costo: 0, seg: [],
  };
  for (const c of casos) {
    const r = get(c);
    if (!r) continue;
    m.n++;
    if (r.error) { m.errores++; continue; }
    const out = r.output ?? '';
    const partes = r.partes ?? [out];
    const texto = partes.join(' ');
    if (/^\s*\[ESCALAR\]/.test(out)) m.escala++;
    if (APTO.test(texto)) m.apto++;
    if (/\[ESCALAR\]/i.test(texto)) m.fuga++; // la etiqueta llegó al cliente
    if (!texto.trim()) m.vacias++;
    // Formateador caído: una sola parte idéntica al borrador sin etiqueta.
    if (!real && partes.length === 1 && partes[0] === out.replace(/^\s*\[ESCALAR\]\s*/i, '').trim()) m.sinFormato++;
    m.partes += partes.length;
    m.largo += texto.length;
    if (CODIGO.test(c.mensaje)) {
      m.codigo++;
      if ((r.herramientas ?? []).includes('verificar_horarios_disponibles')) m.codigoHorarios++;
    }
    if (r.costo) m.costo += r.costo;
    if (r.segundos) m.seg.push(r.segundos);
  }
  const ok = m.n - m.errores;
  console.log(
    nombre.padEnd(16),
    `ok ${ok}/${m.n}`,
    `| escala ${m.escala}`,
    `| apto ${m.apto}`,
    `| [ESCALAR] al cliente ${m.fuga}`,
    `| vacías ${m.vacias}`,
    real ? '' : `| sin formato ${m.sinFormato}`,
    `| código→horarios ${m.codigoHorarios}/${m.codigo}`,
    `| partes prom ${(m.partes / Math.max(1, ok)).toFixed(1)}`,
    `| largo prom ${Math.round(m.largo / Math.max(1, ok))}`,
    real ? '' : `| USD/turno ${(m.costo / Math.max(1, ok)).toFixed(4)} | demora p50 ${percentil(m.seg, 50).toFixed(1)} s p95 ${percentil(m.seg, 95).toFixed(1)} s`
  );
}

// La respuesta real guardada es el borrador: las partes enviadas no quedan en la base.
fila('real (prod)', (c) => ({ output: c.original, herramientas: c.herramientas_original }), true);
for (const e of process.argv.slice(3)) {
  const m = Object.fromEntries(JSON.parse(fs.readFileSync(`${D}/res-${e}.json`, 'utf8')).map((r) => [r.id, r]));
  fila(e, (c) => m[c.id]);
}
