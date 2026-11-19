import { existsSync, statSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PADRE = pathToFileURL(RAIZ + '/package.json').href;
function conExtension(p) {
  for (const c of [p, p + '.ts', p + '.tsx', p + '/index.ts']) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    const f = conExtension(path.join(RAIZ, spec.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) {
    const base = path.dirname(fileURLToPath(ctx.parentURL));
    const f = conExtension(path.resolve(base, spec));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('file:') && !spec.startsWith('node:')) {
    return next(spec, { ...ctx, parentURL: PADRE });
  }
  return next(spec, ctx);
}
