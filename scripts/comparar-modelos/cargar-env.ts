// Carga .env.local en process.env ANTES de que se evalúen los módulos del
// agente (costos.ts lee el modelo al importarse), sin pisar lo que ya venga
// del entorno: así `AGENTE_COMERCIAL_MODELO=… node …` gana sobre el archivo.
// Nunca imprime valores.
import fs from 'node:fs';
import path from 'node:path';

export const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

for (const linea of fs.readFileSync(path.join(RAIZ, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(linea);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
