import OpenAI, { toFile } from 'openai';
import type { createAdminClient } from '@/lib/supabase/admin';
import { sanitizarTextoMeta, type CredencialLinea } from './meta';

/**
 * Fotos, audios, videos y documentos que mandan los clientes por WhatsApp.
 *
 * Meta no manda el archivo: manda un `id` que se cambia por una URL que
 * dura unos minutos y que solo abre con el token de la línea. Por eso el
 * archivo se baja en cuanto llega el webhook y se guarda en el bucket
 * privado `whatsapp_medios`, en `<inmobiliaria>/<teléfono>/<wamid>.<ext>`:
 * la carpeta de la inmobiliaria es la que mira la política de lectura,
 * así el CRM solo ve lo de la suya.
 *
 * Lo que el bot y el CRM leen sigue siendo `contenido`, en texto: la nota
 * de voz llega transcrita y la foto descrita. El bot no cambia, y el
 * historial y la proyección al CRM tampoco.
 */

export const BUCKET_MEDIOS = 'whatsapp_medios';

const GRAPH = 'https://graph.facebook.com/v21.0';
/** Lo más grande que se baja. Meta deja hasta 16 MB en audio y video. */
const TOPE_BYTES = 20 * 1024 * 1024;

const MODELO_TRANSCRIPCION = process.env.WHATSAPP_MODELO_TRANSCRIPCION || 'gpt-4o-mini-transcribe';
const MODELO_VISION = process.env.WHATSAPP_MODELO_VISION || 'gpt-4.1-mini';

export type TipoMedio = 'image' | 'audio' | 'video' | 'document' | 'sticker';
const TIPOS: readonly TipoMedio[] = ['image', 'audio', 'video', 'document', 'sticker'];

/** El objeto de medio de Meta, solo lo que se usa. */
export interface MedioMeta {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
  /** true en las notas de voz. */
  voice?: boolean;
}

/** Lo que queda en `agente_comercial_mensajes.medio`. */
export interface MedioGuardado {
  tipo: TipoMedio;
  mime: string | null;
  /** Ruta en el bucket. Null si no se pudo bajar. */
  ruta: string | null;
  bytes: number | null;
  caption: string | null;
  nombre: string | null;
  voz: boolean;
  /** La transcripción o la descripción, si se hizo. */
  texto: string | null;
  error: string | null;
}

export interface MedioPreparado {
  contenido: string;
  /** Si hay algo que el bot pueda leer: despierta al bot igual que un texto. */
  esTexto: boolean;
  medio: MedioGuardado;
}

type Supabase = ReturnType<typeof createAdminClient>;

/** El medio de un mensaje de Meta, o null si es texto u otra cosa. */
export function medioDe(m: { type: string } & Record<string, unknown>): { tipo: TipoMedio; meta: MedioMeta } | null {
  if (!(TIPOS as readonly string[]).includes(m.type)) return null;
  const meta = m[m.type];
  if (!meta || typeof meta !== 'object') return null;
  return { tipo: m.type as TipoMedio, meta: meta as MedioMeta };
}

const EXTENSIONES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

function extension(mime: string | null, nombre: string | null): string {
  const base = mime?.split(';')[0].trim().toLowerCase() ?? '';
  if (EXTENSIONES[base]) return EXTENSIONES[base];
  const delNombre = nombre?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  return delNombre ? delNombre.toLowerCase() : 'bin';
}

/** Baja el archivo de Meta: primero la URL del id, luego el binario. */
async function bajar(mediaId: string, token: string): Promise<{ datos: Buffer; mime: string | null }> {
  const r = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const info = (await r.json().catch(() => ({}))) as { url?: string; mime_type?: string; file_size?: number; error?: { message?: string } };
  if (!r.ok || !info.url) throw new Error(`Meta no dio la URL del medio: ${info.error?.message ?? r.status}`);
  if (info.file_size && info.file_size > TOPE_BYTES) throw new Error(`El archivo pesa ${info.file_size} bytes; el tope es ${TOPE_BYTES}`);

  const archivo = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!archivo.ok) throw new Error(`Meta no dejó bajar el medio: ${archivo.status}`);
  const datos = Buffer.from(await archivo.arrayBuffer());
  if (datos.length > TOPE_BYTES) throw new Error(`El archivo pesa ${datos.length} bytes; el tope es ${TOPE_BYTES}`);
  return { datos, mime: info.mime_type ?? archivo.headers.get('content-type') };
}

function clienteOpenAI(): OpenAI | null {
  const llave = process.env.OPENAI_API_KEY?.trim();
  return llave ? new OpenAI({ apiKey: llave }) : null;
}

async function transcribir(openai: OpenAI, datos: Buffer, mime: string | null, ext: string): Promise<string> {
  const archivo = await toFile(datos, `nota.${ext}`, { type: mime?.split(';')[0] ?? 'audio/ogg' });
  const r = await openai.audio.transcriptions.create({ file: archivo, model: MODELO_TRANSCRIPCION, language: 'es' });
  return r.text.trim();
}

async function describir(openai: OpenAI, datos: Buffer, mime: string | null, caption: string | null): Promise<string> {
  const url = `data:${mime?.split(';')[0] ?? 'image/jpeg'};base64,${datos.toString('base64')}`;
  const r = await openai.chat.completions.create({
    model: MODELO_VISION,
    max_tokens: 160,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Un cliente le mandó esta foto por WhatsApp a una inmobiliaria de Medellín. Describe en español, ' +
              'en una o dos frases y sin inventar, lo que muestra (por ejemplo un inmueble, un anuncio, un ' +
              'comprobante de pago, un documento o una captura). Si hay texto legible importante (precio, ' +
              'dirección, código), cópialo.' +
              (caption ? ` El cliente escribió junto a la foto: «${caption}».` : ''),
          },
          { type: 'image_url', image_url: { url, detail: 'low' } },
        ],
      },
    ],
  });
  return r.choices[0]?.message?.content?.trim() ?? '';
}

/** Cómo queda el medio en el texto de la conversación. */
function textoDe(tipo: TipoMedio, medio: MedioGuardado): { contenido: string; esTexto: boolean } {
  const caption = medio.caption ? ` ${medio.caption}` : '';
  switch (tipo) {
    case 'audio':
      return medio.texto
        ? { contenido: `[nota de voz] ${medio.texto}`, esTexto: true }
        : { contenido: '[nota de voz que no se pudo transcribir]', esTexto: false };
    case 'image':
      if (medio.texto) return { contenido: `[foto]${caption}\n(La foto muestra: ${medio.texto})`, esTexto: true };
      return { contenido: `[foto]${caption}`, esTexto: Boolean(medio.caption) };
    case 'video':
      return { contenido: `[video]${caption}`, esTexto: Boolean(medio.caption) };
    case 'document':
      return {
        contenido: `[documento${medio.nombre ? `: ${medio.nombre}` : ''}]${caption}`,
        esTexto: Boolean(medio.caption),
      };
    default:
      return { contenido: '[sticker]', esTexto: false };
  }
}

/**
 * Baja, guarda y, si se puede, transcribe o describe el medio.
 *
 * Nunca lanza: si algo falla, el mensaje se guarda igual con lo que se
 * sepa y el motivo en `medio.error`, para que la conversación no tenga
 * huecos.
 */
export async function prepararMedio(
  supabase: Supabase,
  credencial: CredencialLinea | null,
  inmobiliariaId: string,
  telefono: string,
  waMessageId: string,
  tipo: TipoMedio,
  meta: MedioMeta
): Promise<MedioPreparado> {
  const medio: MedioGuardado = {
    tipo,
    mime: meta.mime_type ?? null,
    ruta: null,
    bytes: null,
    caption: meta.caption?.trim() || null,
    nombre: meta.filename?.trim() || null,
    voz: Boolean(meta.voice),
    texto: null,
    error: null,
  };

  const token = credencial?.token ?? process.env.WHATSAPP_TOKEN;
  try {
    if (!meta.id) throw new Error('El mensaje no trae el id del medio');
    if (!token) throw new Error('La línea no tiene token para bajar el medio');

    const { datos, mime } = await bajar(meta.id, token);
    medio.mime = mime ?? medio.mime;
    medio.bytes = datos.length;
    const ext = extension(medio.mime, medio.nombre);
    const ruta = `${inmobiliariaId}/${telefono.replace(/\D/g, '')}/${waMessageId}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET_MEDIOS)
      .upload(ruta, datos, { contentType: medio.mime ?? 'application/octet-stream', upsert: true });
    if (error) throw new Error(`No se pudo guardar el medio: ${error.message}`);
    medio.ruta = ruta;

    const openai = tipo === 'audio' || tipo === 'image' ? clienteOpenAI() : null;
    if (openai) {
      try {
        medio.texto =
          tipo === 'audio'
            ? await transcribir(openai, datos, medio.mime, ext)
            : await describir(openai, datos, medio.mime, medio.caption);
        medio.texto = medio.texto || null;
      } catch (e) {
        medio.error = `No se pudo ${tipo === 'audio' ? 'transcribir' : 'describir'}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } catch (e) {
    medio.error = sanitizarTextoMeta(e instanceof Error ? e.message : String(e));
  }

  if (medio.error) console.error('[WhatsApp] Medio con problemas:', waMessageId, medio.error);
  return { ...textoDe(tipo, medio), medio };
}
