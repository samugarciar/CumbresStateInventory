// Extracción de anuncios desde los correos de alerta de los portales
// (búsquedas guardadas de Mercado Libre, FincaRaíz, Metrocuadrado, Ciencuadras…).
//
// POR QUÉ ASÍ: cada portal manda su propia plantilla HTML y cambiarlas les
// cuesta nada, así que parsear con regex por portal se rompe solo. En vez de
// eso se normaliza el HTML a texto CONSERVANDO los enlaces y se le pide al LLM
// que extraiga los anuncios. Es robusto entre plantillas y entre portales.
//
// Y lo más importante: el correo YA trae los datos (título, precio, zona), así
// que no hace falta abrir ni raspar ninguna página — la plataforma nos los
// envió a nosotros.

import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage, type AIMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { MODELO_CALIFICAR } from '../config';
import type { UsoRegistrado } from '../tipos';

// Tope de anuncios por correo: un digest puede traer decenas y cada uno gasta
// LLM. Si se recorta, el endpoint lo reporta (nunca truncar en silencio).
export const MAX_ANUNCIOS_POR_CORREO = 25;

// Recordatorio: los structured outputs estrictos de OpenAI exigen que TODAS las
// propiedades estén en `required` → los campos "opcionales" van .nullable(),
// nunca .optional().
const EsquemaCorreo = z.object({
  es_alerta_de_inmuebles: z.boolean(),
  anuncios: z.array(
    z.object({
      titulo: z.string(),
      url: z.string().nullable(),
      precio: z.number().nullable(),
      ciudad: z.string().nullable(),
      barrio: z.string().nullable(),
      area_m2: z.number().nullable(),
      habitaciones: z.number().nullable(),
      detalles: z.string().nullable(),
      contacto_telefono: z.string().nullable(),
      contacto_nombre: z.string().nullable(),
    })
  ),
});

type AnuncioDeCorreo = z.infer<typeof EsquemaCorreo>['anuncios'][number];

const PROMPT = `Extraes anuncios de inmuebles de los correos de alerta que envían los portales inmobiliarios colombianos (Mercado Libre, FincaRaíz, Metrocuadrado, Ciencuadras, Properati, OLX) cuando hay publicaciones nuevas para una búsqueda guardada.

Instrucciones:
- Devuelve un elemento por cada INMUEBLE anunciado en el correo.
- "url": el enlace del anuncio tal como aparece en el correo (los enlaces vienen marcados como [URL] justo después de su texto). Si el anuncio no tiene enlace, deja null.
- "precio": solo el número en pesos colombianos, sin puntos ni símbolos (ej. 245000000). Si dice "245 millones", conviértelo. Si no hay precio, null.
- "area_m2" y "habitaciones": números; null si no aparecen.
- "detalles": TODO el texto descriptivo del anuncio, TAL CUAL aparece y sin resumir ni omitir nada.
  **CRÍTICO — nunca elimines las frases sobre QUIÉN VENDE.** Se usan después para decidir si el anuncio
  es de un dueño directo o de una agencia, así que deben conservarse literales, por ejemplo:
  "vendo directamente", "sin intermediarios", "propietario vende", "dueño directo", "no agencias",
  "trato directo", y también las señales contrarias: "Cod. 12345", "contacte a nuestro asesor",
  nombres de inmobiliarias o constructoras. Si dudas si una frase sirve, INCLÚYELA.
- "contacto_telefono" / "contacto_nombre": si el anuncio muestra teléfono o el nombre de quien publica,
  cópialos; si no aparecen, null (no los inventes).
- IGNORA todo lo que no sea un inmueble: banners de publicidad, enlaces de "ver más resultados", "administrar mis alertas", "darse de baja", pies de página, redes sociales, apps móviles.
- Si el correo NO es una alerta de inmuebles (newsletter, factura, promoción, etc.), pon es_alerta_de_inmuebles=false y devuelve la lista vacía.
- NO inventes datos: si un campo no está en el correo, va null.`;

/**
 * Normaliza el cuerpo del correo a texto plano CONSERVANDO los enlaces, para
 * que el modelo pueda asociar cada anuncio con su URL.
 */
function htmlATextoConEnlaces(html: string): string {
  return html
    // <a href="X">texto</a>  →  texto [X]
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => {
      const limpio = String(txt).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return `${limpio} [${href}] `;
    })
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Saca el cuerpo de un mensaje con la forma que devuelve la API de Gmail
 * (`payload` con `parts` anidadas y `body.data` en base64url).
 *
 * POR QUÉ: el trigger de Gmail de n8n entrega el correo con esta estructura y
 * los nombres de campo cambian según la versión y la opción "Simplify".
 * Adivinar el mapeo en el workflow es la causa más común de que el flujo no
 * funcione, así que n8n reenvía el objeto COMPLETO y lo desciframos acá.
 */
export function cuerpoDesdePayloadGmail(payload: unknown): { html: string; texto: string } {
  let html = '';
  let texto = '';

  const decodificar = (data: string): string => {
    try {
      return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {
      return '';
    }
  };

  const recorrer = (p: any, profundidad = 0) => {
    if (!p || typeof p !== 'object' || profundidad > 12) return;
    const mime: string = p.mimeType ?? '';
    const data: string | undefined = p.body?.data;
    if (data) {
      if (mime.includes('html') && !html) html = decodificar(data);
      else if (mime.includes('plain') && !texto) texto = decodificar(data);
    }
    for (const hijo of p.parts ?? []) recorrer(hijo, profundidad + 1);
  };

  recorrer(payload);
  return { html, texto };
}

/** Asunto desde los headers de un payload de Gmail. */
export function asuntoDesdePayloadGmail(payload: unknown): string | undefined {
  const headers = (payload as any)?.headers;
  if (!Array.isArray(headers)) return undefined;
  const h = headers.find((x) => String(x?.name).toLowerCase() === 'subject');
  return h?.value;
}

/** Quita parámetros de tracking (utm_*, etc.) para que el dedup por URL funcione. */
function limpiarUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|gclid|fbclid|mkt_|pk_|_ga|trk|tracking)/i.test(p)) u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

interface ResultadoExtraccion {
  esAlerta: boolean;
  anuncios: AnuncioDeCorreo[];
  recortados: number; // cuántos se dejaron fuera por el tope
  uso: UsoRegistrado[];
}

export async function extraerAnunciosDeCorreo(params: {
  asunto?: string;
  html?: string;
  texto?: string;
}): Promise<ResultadoExtraccion> {
  const cuerpo = params.html ? htmlATextoConEnlaces(params.html) : (params.texto ?? '');
  if (!cuerpo.trim()) return { esAlerta: false, anuncios: [], recortados: 0, uso: [] };

  // Los correos pueden ser enormes; el encabezado es lo que importa.
  const recorte = cuerpo.slice(0, 24000);

  const modelo = new ChatOpenAI({ model: MODELO_CALIFICAR, temperature: 0, maxRetries: 3 });
  const r = await modelo.withStructuredOutput(EsquemaCorreo, { includeRaw: true }).invoke([
    new SystemMessage(PROMPT),
    new HumanMessage(`Asunto: ${params.asunto ?? '(sin asunto)'}\n\nCuerpo:\n${recorte}`),
  ]);

  const parsed = r.parsed as z.infer<typeof EsquemaCorreo>;
  const todos = parsed.anuncios ?? [];
  const anuncios = todos.slice(0, MAX_ANUNCIOS_POR_CORREO).map((a) => ({
    ...a,
    url: a.url ? limpiarUrl(a.url) : null,
  }));

  const um = (r.raw as AIMessage | undefined)?.usage_metadata;
  const cache = um?.input_token_details?.cache_read ?? 0;
  const uso: UsoRegistrado[] = um
    ? [{
        modelo: MODELO_CALIFICAR,
        entrada: Math.max(0, (um.input_tokens ?? 0) - cache),
        salida: um.output_tokens ?? 0,
        cache,
      }]
    : [];

  return {
    esAlerta: parsed.es_alerta_de_inmuebles,
    anuncios,
    recortados: Math.max(0, todos.length - anuncios.length),
    uso,
  };
}
