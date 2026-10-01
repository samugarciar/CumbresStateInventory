import crypto from 'node:crypto';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enviarTexto } from '@/lib/whatsapp/meta';

/**
 * El webhook de la Cloud API de Meta: por aquí entra TODO.
 *
 * Reemplaza el camino actual —Kommo recibe, n8n reenvía al agente— el día
 * que el número se registre en Meta. Hasta entonces este endpoint está
 * desplegado y en silencio: Meta no le manda nada porque no lo conoce.
 *
 * POR QUÉ ATERRIZA EN LA PLATAFORMA Y NO EN EL CRM
 * Meta entrega cada evento a UNA sola URL. La plataforma es dueña de
 * `public`, donde ya viven la conversación y los mensajes, y los triggers
 * de proyección llevan cada fila a `crm` sin código nuevo. Si aterrizara
 * en el CRM, el CRM quedaría en el camino crítico del canal —una caída
 * suya dejaría al bot mudo delante de clientes reales— y además tendría
 * que escribir en `public`, que es la regla que no se rompe.
 *
 * LO QUE ESTE ENDPOINT PROMETE
 * Contestar 200 rápido. Meta reintenta lo que no se responde a tiempo, y
 * un reintento sobre un mensaje ya guardado es un mensaje duplicado en la
 * conversación de un cliente. Por eso lo lento —llamar al agente— va en
 * `after()`, que corre cuando la respuesta ya salió.
 */

export const maxDuration = 300;

// ── Entrada de Meta, solo lo que se usa ──────────────────────────────
interface Referral {
  source_id?: string;
  source_type?: string;
  source_url?: string;
  headline?: string;
  body?: string;
  ctwa_clid?: string;
}

interface MensajeMeta {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body: string };
  referral?: Referral;
}

interface EstadoMeta {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errors?: { code?: number; title?: string; message?: string }[];
}

const ESTADO: Record<string, string> = {
  sent: 'enviado',
  delivered: 'entregado',
  read: 'leido',
  failed: 'fallido',
};

// Lo que devuelve /api/agentes/comercial-whatsapp: el mismo contrato que
// consume n8n. Solo se usa lo que ve el cliente.
const PARTES = ['part_1', 'part_2', 'part_3', 'part_4', 'part_5'] as const;

interface RespuestaAgente {
  estado?: string;
  response?: Partial<Record<(typeof PARTES)[number], string | null>>;
}

/**
 * Verificación del webhook. Meta la hace UNA vez, al configurarlo en el
 * panel, y no vuelve. Si esto falla, el webhook no llega a existir.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const reto = url.searchParams.get('hub.challenge');

  if (modo === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    // Meta espera el reto EN CRUDO, no envuelto en JSON.
    return new Response(reto ?? '', { status: 200 });
  }
  return new Response('Token de verificación incorrecto', { status: 403 });
}

/**
 * La firma no es opcional.
 *
 * Esta URL es pública y por ella entran mensajes que acaban en la
 * conversación de un cliente y despiertan al bot. Sin comprobarla,
 * cualquiera puede inventarse un mensaje entrante — y el bot le
 * respondería a quien le dijeran.
 *
 * `timingSafeEqual` y no `===`: comparar cadenas secretas con cortocircuito
 * filtra información por el tiempo que tarda.
 */
function firmaValida(crudo: string, cabecera: string | null): boolean {
  const secreto = process.env.WHATSAPP_APP_SECRET;
  if (!secreto || !cabecera?.startsWith('sha256=')) return false;

  const esperada = crypto
    .createHmac('sha256', secreto)
    .update(crudo, 'utf8')
    .digest('hex');
  const recibida = cabecera.slice('sha256='.length);

  const a = Buffer.from(esperada, 'hex');
  const b = Buffer.from(recibida, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const crudo = await request.text();

  if (!firmaValida(crudo, request.headers.get('x-hub-signature-256'))) {
    console.error('[WhatsApp] Firma inválida: petición descartada');
    return new Response('Firma inválida', { status: 401 });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = JSON.parse(crudo);
  } catch {
    return Response.json({ ok: true }, { status: 200 });
  }

  // A partir de aquí SIEMPRE se contesta 200, incluso si algo falla por
  // dentro. Un 500 hace que Meta reintente, y reintentar un fallo nuestro
  // solo lo repite: lo que hay que hacer es registrarlo y seguir.
  try {
    await procesar(cuerpo, new URL(request.url).origin);
  } catch (error) {
    console.error('[WhatsApp] Error procesando el webhook:', error);
  }

  return Response.json({ ok: true }, { status: 200 });
}

async function procesar(cuerpo: Record<string, unknown>, origen: string) {
  const supabase = createAdminClient();
  const entradas = (cuerpo.entry ?? []) as Record<string, unknown>[];

  for (const entrada of entradas) {
    for (const cambio of (entrada.changes ?? []) as Record<string, unknown>[]) {
      const valor = (cambio.value ?? {}) as Record<string, unknown>;
      const metadata = (valor.metadata ?? {}) as { phone_number_id?: string };

      // ── Acuses de entrega ────────────────────────────────────────
      // Llegan para TODO lo que sale, incluidos los ~3.900 mensajes
      // mensuales del bot. Es lo que convierte "enviado" en "entregado".
      for (const e of (valor.statuses ?? []) as EstadoMeta[]) {
        const estado = ESTADO[e.status];
        if (!estado) continue;
        const fallo = e.errors?.[0];
        await supabase.schema('crm').rpc('registrar_estado_envio', {
          p_wa_message_id: e.id,
          p_estado: estado,
          p_error_codigo: fallo?.code,
          p_error: fallo?.message ?? fallo?.title,
        });
      }

      // ── Mensajes entrantes ───────────────────────────────────────
      const mensajes = (valor.messages ?? []) as MensajeMeta[];
      if (mensajes.length === 0) continue;

      // De qué línea es este mensaje. El CRM es dueño del concepto de
      // embudo, así que la traducción vive allí: un phone_number_id
      // devuelve la inmobiliaria, el embudo que alimenta y si el bot
      // puede contestar en esa línea.
      //
      // Antes esto miraba `inmobiliarias.wa_phone_number_id`, o sea UN
      // número por inmobiliaria. Son varios —comercial, administrativa,
      // captación—, cada uno con su embudo.
      const { data: lineas } = await supabase
        .schema('crm')
        .rpc('linea_por_numero', {
          p_wa_phone_number_id: metadata.phone_number_id,
        });

      const linea = Array.isArray(lineas) ? lineas[0] : lineas;

      if (!linea) {
        console.error(
          '[WhatsApp] Llegó un mensaje a un número sin línea configurada en crm.lineas:',
          metadata.phone_number_id
        );
        continue;
      }

      for (const m of mensajes) {
        await guardarEntrante(supabase, linea, m, origen);
      }
    }
  }
}

interface Linea {
  inmobiliaria_id: string;
  embudo: string;
  nombre: string;
  bot_atiende: boolean;
}

async function guardarEntrante(
  supabase: ReturnType<typeof createAdminClient>,
  linea: Linea,
  m: MensajeMeta,
  origen: string
) {
  const inmobiliariaId = linea.inmobiliaria_id;
  const telefono = m.from.startsWith('+') ? m.from : `+${m.from}`;

  // Solo texto despierta al agente. Una foto o un audio se guardan para
  // que la conversación no tenga huecos, pero llamar al bot con un
  // marcador de posición le haría contestar sobre algo que no leyó.
  const esTexto = m.type === 'text' && Boolean(m.text?.body);
  const contenido = esTexto
    ? m.text!.body
    : `[el cliente mandó ${m.type}, que todavía no sabemos leer]`;

  const { data: existente } = await supabase
    .from('agente_comercial_conversaciones')
    .select('id, referral_source_id')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('telefono', telefono)
    .maybeSingle();

  let conversacionId = existente?.id as string | undefined;

  // EL REFERIDO LLEGA UNA SOLA VEZ, en el primer mensaje de quien vino de
  // un anuncio, y no hay forma de preguntarlo después. Si no se guarda
  // aquí, ese lead se queda sin atribución para siempre.
  const referido = m.referral
    ? {
        referral_source_id: m.referral.source_id ?? null,
        referral_ctwa_clid: m.referral.ctwa_clid ?? null,
        referral: m.referral,
      }
    : {};

  if (!conversacionId) {
    const { data: nueva, error } = await supabase
      .from('agente_comercial_conversaciones')
      .insert({ inmobiliaria_id: inmobiliariaId, telefono, ...referido })
      .select('id')
      .single();
    if (error || !nueva) {
      console.error('[WhatsApp] No se pudo crear la conversación:', error);
      return;
    }
    conversacionId = nueva.id;
  } else if (m.referral && !existente?.referral_source_id) {
    // Conversación vieja que vuelve por un anuncio: se anota sin pisar
    // una atribución anterior, que sería reescribir de dónde vino.
    await supabase
      .from('agente_comercial_conversaciones')
      .update(referido)
      .eq('id', conversacionId);
  }

  // El índice único sobre wa_message_id es lo que hace idempotente un
  // reintento de Meta. Se ignora el choque en vez de tratarlo como error.
  const { error: errorMensaje } = await supabase
    .from('agente_comercial_mensajes')
    .insert({
      conversacion_id: conversacionId,
      rol: 'usuario',
      contenido,
      wa_message_id: m.id,
    });

  if (errorMensaje) {
    // 23505 = choque de único: es un reintento, no un problema.
    if (errorMensaje.code === '23505') return;
    console.error('[WhatsApp] No se pudo guardar el mensaje:', errorMensaje);
    return;
  }

  if (!esTexto) return;

  // ── Y ahora el bot, si le dejan ──────────────────────────────────
  // Va en after() para que Meta ya tenga su 200: el agente puede tardar
  // segundos, y Meta reintenta lo que no se contesta rápido.
  // La línea manda: en administrativa y en captación no contesta nadie
  // automático, por decisión de producto. Se comprueba ANTES que el
  // interruptor por lead porque es más barato y más categórico.
  if (!linea.bot_atiende) return;

  after(async () => {
    try {
      const { data: puede } = await supabase
        .schema('crm')
        .rpc('bot_puede_responder', {
          p_inmobiliaria_id: inmobiliariaId,
          p_telefono: telefono,
        });

      // Falla hacia "sí responde": si el CRM no contesta, el cliente
      // recibe respuesta igual. Dejar mudo el canal por un error del CRM
      // es peor que un bot que habla de más.
      if (puede === false) return;

      const r = await fetch(`${origen}/api/agentes/comercial-whatsapp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-token': process.env.N8N_AGENTE_COMERCIAL_TOKEN ?? '',
        },
        body: JSON.stringify({
          mensaje: contenido,
          telefono,
          inmobiliaria_id: inmobiliariaId,
          // Ya está guardado (arriba, con su wamid): el agente no debe
          // guardarlo otra vez ni leerlo dos veces.
          wa_message_id: m.id,
        }),
      });

      const respuesta = (await r.json().catch(() => null)) as RespuestaAgente | null;
      if (!r.ok && !respuesta?.response) {
        console.error('[WhatsApp] El agente no devolvió respuesta:', r.status);
        return;
      }
      await entregarRespuesta(telefono, respuesta);
    } catch (error) {
      console.error('[WhatsApp] No se pudo activar el agente:', error);
    }
  });
}

/**
 * Lo que el agente decidió decirle al cliente, entregado por Meta.
 *
 * Por n8n, la respuesta volvía a n8n y n8n la mandaba por Kommo. Por el
 * canal propio no hay nadie más en medio: sin esto, el agente pensaba,
 * guardaba su respuesta, y el cliente no recibía nada.
 *
 * El webhook es TRANSPORTE: entrega, en orden, las partes que el agente
 * devolvió para el cliente, igual que hacía n8n — también el texto de
 * espera cuando el bot está pausado desde /agentes, que la ruta del agente
 * escribe para eso. `output` no se manda nunca: lleva la etiqueta
 * [ESCALAR], que es para nosotros.
 *
 * Si una parte falla, las siguientes no salen: la tercera sin la segunda no
 * se entiende. Y no se reintenta: tras un fallo de red no se sabe si salió,
 * y reintentar a ciegas puede hacerle llegar al cliente lo mismo dos veces.
 *
 * Sale por el número de las variables de entorno, que hoy es el único
 * conectado (el de prueba de Meta). Las credenciales por línea —para que
 * cada línea conteste desde su propio número— son el paso siguiente.
 */
async function entregarRespuesta(telefono: string, respuesta: RespuestaAgente | null) {
  for (const clave of PARTES) {
    const texto = respuesta?.response?.[clave]?.trim();
    if (!texto) continue;

    const r = await enviarTexto(telefono, texto);
    if (!r.ok) {
      console.error(
        '[WhatsApp] La respuesta del agente no le llegó al cliente:',
        r.codigo ?? 'sin código',
        r.error
      );
      return;
    }
  }
}
