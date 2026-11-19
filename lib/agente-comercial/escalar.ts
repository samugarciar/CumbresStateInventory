// La etiqueta [ESCALAR] del borrador: dónde se busca y cómo se quita.
//
// El protocolo pide que vaya AL INICIO, y el código solo la buscaba ahí. Los
// modelos no siempre cumplen. Medido en producción (gpt-4.1, 20 oct – 19 nov
// 2026): de 587 borradores con la etiqueta, 19 la traían EN MEDIO —el bot no
// escalaba y la etiqueta podía llegarle al cliente— y 150 la traían REPETIDA,
// casi siempre porque el modelo duplicó el mensaje entero («[ESCALAR] Lamento…
// \n-[ESCALAR] Lamento…»), y la segunda copia sí se le mandaba. En las pruebas
// de gpt-6-luna pasó lo mismo.
//
// Regla: si la etiqueta aparece en cualquier parte, se escala; al cliente
// nunca le llega, ni las copias del mismo párrafo que deja la duplicación.

const ETIQUETA = /\[\s*ESCALAR\s*\]/gi;

export function tieneEtiquetaEscalar(texto: string): boolean {
  return new RegExp(ETIQUETA.source, 'i').test(texto);
}

// Para comparar líneas: sin viñeta inicial, sin espacios extra, sin mayúsculas.
function normalizar(linea: string): string {
  return linea.replace(/^[\s\-•*·]+/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Palabras de una línea, para comparar dos versiones del mismo párrafo.
function palabras(linea: string): Set<string> {
  return new Set(normalizar(linea).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean));
}

// ¿Dos líneas largas dicen casi lo mismo? Pasa cuando el modelo duplica el
// mensaje al escalar pero reescribe la copia («Voy a escalarlo para que un
// asesor revise…» / «Un asesor revisará…»). Solo líneas de 12 palabras o más:
// las de una lista («- Mi Mundo: $1.600.000») se parecen entre sí y no son copias.
function casiIguales(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 12 || b.size < 12) return false;
  let comunes = 0;
  for (const p of a) if (b.has(p)) comunes++;
  return comunes / (a.size + b.size - comunes) >= 0.6;
}

/**
 * El texto sin la etiqueta en ninguna parte y sin líneas repetidas: lo que
 * puede ver el cliente. Las líneas vacías se conservan (separan párrafos);
 * una línea que, normalizada, ya apareció antes, se descarta, y si el texto
 * traía la etiqueta, también la que es casi igual a una anterior (la copia
 * reescrita). Si al quitar la etiqueta queda una viñeta sola («-»), también.
 */
export function sinEtiquetaEscalar(texto: string): string {
  const conEtiqueta = tieneEtiquetaEscalar(texto);
  const vistas = new Set<string>();
  const largas: Set<string>[] = [];
  const lineas: string[] = [];
  for (const cruda of texto.replace(ETIQUETA, ' ').split('\n')) {
    const linea = cruda.replace(/[ \t]+/g, ' ').trimEnd();
    const clave = normalizar(linea);
    if (clave === '' && /\S/.test(linea)) continue; // viñeta huérfana
    if (clave !== '') {
      if (vistas.has(clave)) continue;
      const p = palabras(linea);
      if (conEtiqueta && largas.some((q) => casiIguales(p, q))) continue;
      vistas.add(clave);
      largas.push(p);
    }
    lineas.push(clave === '' ? '' : linea.replace(/^[ \t]+/, ''));
  }
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * ¿El mensaje le pide al cliente un dato para registrar una visita (nombre,
 * teléfono, día u hora)? Si el modelo escala en ese turno, el bot se calla y
 * la respuesta del cliente queda sin atender: en las pruebas de gpt-6-luna
 * (19 nov 2026) pasó en 3 de 24 conversaciones; gpt-4.1 no lo hizo en ninguno
 * de sus 404 escalamientos de noviembre (medido con esta misma función). Se mira cada pregunta del mensaje,
 * no solo la última («…me compartes tu nombre? Ya tengo tu teléfono»).
 * Acotado a propósito: una queja o una negociación que pregunta algo no
 * entra, porque la pregunta no habla de registrar una visita.
 */
export function pideDatoParaRegistrar(texto: string): boolean {
  const preguntas = sinEtiquetaEscalar(texto)
    .split(/(?<=[.!?\n])\s+/)
    .filter((o) => o.trim().endsWith('?'));
  return preguntas.some(
    (q) =>
      /\b(nombre|tel[eé]fono|n[uú]mero|celular|qu[eé] d[ií]a|qu[eé] hora|a qu[eé] hora)\b/i.test(q) &&
      /(regist|agend|visit|cita|separ|apertura)/i.test(q)
  );
}

/**
 * El borrador listo para n8n y para el historial: si escala, UNA etiqueta al
 * inicio (n8n hace startsWith('[ESCALAR]')); el resto, limpio.
 */
export function normalizarBorrador(borrador: string, escalar: boolean): string {
  const limpio = sinEtiquetaEscalar(borrador);
  return escalar ? `[ESCALAR] ${limpio}` : limpio;
}
