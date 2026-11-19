// Arma lotes en Markdown para calificar caso por caso con rubrica.md.
//   node para-revisar.mjs <carpeta> <etiqueta-con-detalle> [otras-etiquetas...] [--lote 24]
// Escribe <carpeta>/revisar-N.md. Los casos traen datos reales de clientes:
// la carpeta debe quedar fuera del repo.
import fs from 'node:fs';

const args = process.argv.slice(2);
const i = args.indexOf('--lote');
const LOTE = i >= 0 ? Number(args.splice(i, 2)[1]) : 24;
const [D, principal, ...otras] = args;
const casos = JSON.parse(fs.readFileSync(`${D}/casos.json`, 'utf8'));
const cargar = (e) => Object.fromEntries(JSON.parse(fs.readFileSync(`${D}/res-${e}.json`, 'utf8')).map((r) => [r.id, r]));
const P = cargar(principal);
const O = otras.map((e) => [e, cargar(e)]);
const corto = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const bloques = casos.map((c, k) => {
  const r = P[c.id] ?? {};
  const previos = [...c.previos].slice(0, 4).reverse().map((m) => `- ${m.rol}: ${corto(m.contenido, 300)}`).join('\n');
  const herramientas = (r.detalle ?? [])
    .map((h) => `  - \`${h.nombre}\` entrada ${corto(JSON.stringify(h.entrada), 250)}\n    salida ${corto(h.salida, 1200)}`)
    .join('\n');
  const otrasCorridas = O.map(([e, m]) => {
    const x = m[c.id];
    if (!x) return `- ${e}: (sin dato)`;
    if (x.error) return `- ${e}: ERROR ${corto(x.error, 200)}`;
    return `- ${e} [${(x.herramientas ?? []).join(', ')}]: ${corto((x.partes ?? [x.output]).join(' / '), 600)}`;
  }).join('\n');
  return `## Caso ${k + 1} · \`${c.id}\` · ${new Date(c.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}

**Contexto (últimos mensajes):**
${previos || '- (primer mensaje)'}

**Cliente:** ${corto(c.mensaje, 600)}

**REAL (gpt-4.1, en su momento)** [${c.herramientas_original.join(', ')}]: ${corto(c.original, 900)}

**LUNA (${principal})** — herramientas:
${herramientas || '  - (ninguna)'}
- Borrador: ${corto(r.error ? 'ERROR ' + r.error : r.output, 900)}
- Lo que recibe el cliente: ${corto((r.partes ?? []).join(' / '), 900)}
- Etapa: ${r.etapa ?? '—'} · escalado: ${r.escalado ?? '—'}

**Otras corridas de LUNA (consistencia):**
${otrasCorridas || '- (ninguna)'}
`;
});

let n = 0;
for (let k = 0; k < bloques.length; k += LOTE) {
  n++;
  fs.writeFileSync(`${D}/revisar-${n}.md`, bloques.slice(k, k + LOTE).join('\n---\n\n'));
}
console.log(`${bloques.length} casos en ${n} lotes (${D}/revisar-*.md)`);
