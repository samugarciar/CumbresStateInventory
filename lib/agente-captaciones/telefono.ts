// Extracción de teléfonos colombianos del texto de un anuncio.
//
// POR QUÉ: en Facebook no existe forma de obtener el contacto por API, pero una
// parte de los dueños escribe su celular —o pega un link de wa.me— en el propio
// título o en la descripción. Hoy eso se ignoraba y el prospecto entraba como
// 'revisar_manual' aunque el número estuviera a la vista. Se encontró uno así
// en la bandeja: "Hermoso apartamento en Sabanetahttps://wa.me/3215150213".
//
// APLICA TAMBIÉN A MERCADO LIBRE, contra lo que parecía. Una primera prueba
// sobre 14 descripciones no encontró ninguna y se concluyó que ML los filtraba;
// repetida sobre los 99 anuncios reales aparecieron 3, así que la conclusión
// anterior era un artefacto de la muestra pequeña.
//
// Detalle útil: los 3 de ML resultaron ser de agencias ("Asesor Jorge mazo",
// "Código APA9566"). Tiene sentido —el profesional publica su número aunque la
// plataforma lo desincentive— así que encontrar teléfono en una descripción de
// ML es, si acaso, un indicio LEVE de agencia. No se usa como señal: el
// calificador ya juzga eso con el texto completo.
//
// SOLO CELULARES (3XX XXX XXXX). Los fijos quedan fuera a propósito: el destino
// de este dato es un chat de WhatsApp, y un fijo no sirve para eso.

/** Un celular colombiano son 10 dígitos que empiezan por 3. */
const MOVIL = /(?<!\d)(?:\+?57[\s.\-]?)?(3\d{2})[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/g;

/** Links de WhatsApp: wa.me/573001234567, api.whatsapp.com/send?phone=… */
const ENLACE_WA = /(?:wa\.me|whatsapp\.com\/send\?phone=|api\.whatsapp\.com\/send\?phone=)\/?(?:\+?57)?(3\d{9})(?!\d)/gi;

/**
 * Devuelve los celulares encontrados en el texto, sin repetir y en orden de
 * aparición. Los de un enlace de WhatsApp van primero: que alguien publique su
 * wa.me es la señal más explícita de por dónde quiere que le escriban.
 *
 * Las guardas (?<!\d) y (?!\d) son lo que impide que un precio se lea como
 * teléfono: sin ellas, "3.500.000" o un número largo pueden producir una
 * coincidencia a mitad de la cifra.
 */
export function extraerCelulares(...textos: Array<string | null | undefined>): string[] {
  const texto = textos.filter(Boolean).join(' \n ');
  if (!texto.trim()) return [];

  const encontrados: string[] = [];
  const agregar = (n: string) => {
    if (!encontrados.includes(n)) encontrados.push(n);
  };

  for (const m of texto.matchAll(ENLACE_WA)) agregar(m[1]);
  for (const m of texto.matchAll(MOVIL)) agregar(m[1] + m[2] + m[3]);

  return encontrados;
}

/** El celular más probable del anuncio, o null. */
export function celularDelAnuncio(...textos: Array<string | null | undefined>): string | null {
  return extraerCelulares(...textos)[0] ?? null;
}
