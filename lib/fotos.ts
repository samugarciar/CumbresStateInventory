// Normalización de las URLs de fotos que llegan del ERP (Nuby/Arrendasoft).
//
// El 40% de las fotos guardadas (2.779 de 6.867, en 205 inmuebles) quedó con
// el dominio y la ruta pegados, porque en algún momento el ERP concatenó su
// base con "img/fotos/..." sin la barra intermedia:
//   https://invosadia.arrendasoft.coimg/fotos/...   ← el host "…coimg" NO existe
//   https://invosadia.arrendasoft.co/img/fotos/...  ← correcta, responde 200
// Verificado: la rota ni siquiera resuelve el dominio; la reparada devuelve la
// imagen real. Es data vieja —el ERP hoy las manda bien— así que se repara al
// LEER (para no depender de limpiar la base) y también al escribir en el sync.
//
// La corrupción es UN solo patrón, confirmado contra las 6.867 URLs guardadas:
// dominio terminado en "img" + ruta que arranca en "/fotos/". Se corrige solo
// ese caso; cualquier otra URL se deja intacta.

/** Repara una URL de foto del ERP. Devuelve null si no es utilizable. */
export function normalizarUrlFoto(valor: unknown): string | null {
  const crudo = typeof valor === 'string' ? valor : (valor as { imagen?: string } | null)?.imagen;
  if (typeof crudo !== 'string' || !crudo.trim()) return null;
  const url = crudo.trim();

  const m = /^(https?:\/\/)([^/]+)(\/.*)$/i.exec(url);
  if (!m) return url;
  const [, esquema, dominio, ruta] = m;

  // "…coimg" + "/fotos/…"  →  "…co" + "/img/fotos/…"
  if (/img$/i.test(dominio) && /^\/fotos\//i.test(ruta)) {
    return `${esquema}${dominio.slice(0, -3)}/img${ruta}`;
  }
  return url;
}

/** Lista de fotos utilizables de un inmueble, ya reparadas y sin duplicados. */
export function fotosDeInmueble(imagenes: unknown): string[] {
  if (!Array.isArray(imagenes)) return [];
  const urls = imagenes.map(normalizarUrlFoto).filter((u): u is string => !!u);
  return [...new Set(urls)];
}
