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

// Oraciones del texto visible. «a. m.» y «p. m.» se juntan antes de partir:
// si no, «…a las 3:00 p. m. en Mi Mundo, ¿me confirmas tu nombre?» se parte en
// dos y la pregunta pierde el «para agendar la visita» que la precede.
function oraciones(texto: string): string[] {
  return sinEtiquetaEscalar(texto)
    .replace(/\b([ap])\.\s?m\./gi, '$1m')
    .split(/(?<=[.!?\n])\s+/)
    .map((o) => o.trim())
    .filter(Boolean);
}

// Ojo: con tildes, `\b` no sirve en JavaScript («confirmará» no tiene límite de
// palabra después de la «á»). Por eso estas expresiones usan la bandera `u` y
// miran letras con \p{L}.
const FIN = '(?![\\p{L}\\p{N}])';
const INICIO = '(?<![\\p{L}\\p{N}])';

const DATO = new RegExp(`${INICIO}(?:nombre|tel[eé]fono|n[uú]mero|celular|qu[eé] d[ií]a|qu[eé] hora|a qu[eé] hora)${FIN}`, 'iu');
// «Para compartirte el contacto» es el registro del empalme (compartir_contacto_empalme).
const PARA_REGISTRAR = /(?:regist|agend|visit|cita|separ|apertura|contacto|coordin)/i;
const PIDE_EN_IMPERATIVO = new RegExp(
  `${INICIO}(?:conf[ií]rmame|comp[aá]rteme|reg[aá]lame|ind[ií]came|d[ií]me|env[ií]ame|escr[ií]beme|p[aá]same)${FIN}`,
  'iu'
);

/**
 * ¿El mensaje le pide al cliente un dato para registrar una visita (nombre,
 * teléfono, día u hora)? Si el modelo escala en ese turno, el bot se calla y
 * la respuesta del cliente queda sin atender: en las pruebas de gpt-6-luna
 * (19 nov 2026) pasó en 3 de 24 conversaciones; gpt-4.1 no lo hizo en ninguno
 * de sus 404 escalamientos de noviembre (medido con esta misma función).
 * Cuenta la pregunta («¿me compartes tu nombre…?») y el imperativo
 * («confírmame tu nombre…»), estén donde estén. Acotado a propósito: una
 * queja o una negociación que pregunta algo no entra, porque esa oración no
 * habla de registrar una visita.
 */
export function pideDatoParaRegistrar(texto: string): boolean {
  const os = oraciones(texto);
  // El «para qué» puede venir en la oración siguiente: «¿Me confirmas tu
  // teléfono? Lo necesito para registrar la solicitud».
  return os.some(
    (o, i) =>
      DATO.test(o) &&
      (o.endsWith('?') || PIDE_EN_IMPERATIVO.test(o)) &&
      (PARA_REGISTRAR.test(o) || PARA_REGISTRAR.test(os[i + 1] ?? ''))
  );
}

const VERBO_FUTURO =
  '(?:contactar[aá]n?|escribir[aá]n?|confirmar[aá]n?|llamar[aá]n?|enviar[aá]n?|compartir[aá]n?|ayudar[aá]n?|' +
  'responder[aá]n?|comunicar[aá]n?|dar[aá]n?|revisar[aá]n?|contacta|escribe|confirma|llama|env[ií]a|comparte|ayuda|' +
  'responde|va a (?:contactar|escribir|confirmar|llamar|enviar|compartir|ayudar|responder|revisar))';
const ASESOR = `(?:el|un|una|la|nuestro|nuestra)\\s+asesora?${FIN}`;

const PROMESAS: RegExp[] = [
  // «un asesor (de Cumbres) te contactará / te lo confirma / le va a escribir»
  new RegExp(`${INICIO}asesora?s?${FIN}[^.?!\\n]{0,40}?${INICIO}(?:te|le|les)\\s+(?:(?:lo|la|los|las)\\s+)?${VERBO_FUTURO}${FIN}`, 'iu'),
  // «te lo comparte directamente un asesor», «te la confirma el asesor»
  new RegExp(`${INICIO}(?:te|le)\\s+(?:(?:lo|la|los|las)\\s+)?${VERBO_FUTURO}\\s+(?:directamente\\s+|pronto\\s+)?${ASESOR}`, 'iu'),
  // «(te lo) confirmo / consulto / valido … con el asesor», «le confirmo al asesor»
  new RegExp(`${INICIO}(?:confirmo|consulto|valido|verifico|pregunto|reviso)${FIN}[^.?!\\n]{0,60}?${INICIO}(?:con|al|a\\s+(?:un|una|la|nuestro))\\s+(?:(?:el|un|una|la|nuestro)\\s+)?asesora?${FIN}`, 'iu'),
  // «prefiero confirmártelo con el asesor»
  new RegExp(`${INICIO}prefiero\\s+(?:confirm|valid|verific|consult)\\p{L}*\\s+con\\s+${ASESOR}`, 'iu'),
  // «le paso tu consulta al asesor», «voy a escalar tu caso»
  new RegExp(`${INICIO}(?:le|les)\\s+(?:paso|traslado|comparto|dejo)\\s+(?:tu|su)\\s+(?:consulta|caso|solicitud|inquietud|pregunta)${FIN}`, 'iu'),
  new RegExp(`${INICIO}(?:voy a|vamos a)\\s+escalar${FIN}`, 'iu'),
];

// Una oferta, una pregunta o un condicional no es una promesa.
const OFERTA = new RegExp(
  `[¿?]|^si${FIN}|${INICIO}si\\s+(?:quieres|deseas|necesitas|prefieres|gustas|te\\s+interesa)${FIN}|` +
    `${INICIO}(?:puede|pueden|podr[ií]a|podr[ií]an|puedo)${FIN}|${INICIO}te\\s+gustar[ií]a${FIN}|` +
    `${INICIO}(?:quieres|deseas|prefieres)\\s+que${FIN}`,
  'iu'
);

/**
 * ¿El mensaje le PROMETE al cliente que un asesor lo va a contactar o le va a
 * confirmar algo? Si el bot lo promete y no escala, nadie del equipo se entera
 * y el cliente espera para siempre. Medido en noviembre de 2026 con gpt-4.1:
 * cientos de respuestas así sin [ESCALAR] (ver graph.ts). Decisión de Samuel
 * (19 nov 2026): esas respuestas escalan por código.
 * No cuentan las ofertas ni las preguntas («¿quieres que un asesor te
 * contacte?», «un asesor puede ayudarte») ni los condicionales («si no
 * tienes ese dato, le confirmo al asesor»).
 */
export function prometeAsesor(texto: string): boolean {
  return oraciones(texto).some((o) => !OFERTA.test(o) && PROMESAS.some((r) => r.test(o)));
}

/**
 * El borrador listo para n8n y para el historial: si escala, UNA etiqueta al
 * inicio (n8n hace startsWith('[ESCALAR]')); el resto, limpio.
 */
export function normalizarBorrador(borrador: string, escalar: boolean): string {
  const limpio = sinEtiquetaEscalar(borrador);
  return escalar ? `[ESCALAR] ${limpio}` : limpio;
}
