import crypto from 'node:crypto';
import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enviarTexto } from '@/lib/whatsapp/meta';
import {
  anotarResultadoCredencial,
  credencialDeLinea,
  erroresDeHistorial,
  filaDeEco,
  filasDeHilo,
  type FilaMensaje,
  type MensajeCoexistencia,
} from '@/lib/whatsapp/lineas';

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
      const campo = typeof cambio.field === 'string' ? cambio.field : 'messages';
      const valor = (cambio.value ?? {}) as Record<string, unknown>;
      const metadata = (valor.metadata ?? {}) as { phone_number_id?: string };

      // ── La coexistencia: lo que pasa en la app del celular ─────────
      // Ninguno de los tres despierta al bot. Solo un texto ENTRANTE en vivo
      // lo hace (nota 9, «lo que la plataforma NO debe hacer»).
      if (campo === 'smb_message_echoes') {
        await guardarEcos(
          supabase,
          metadata.phone_number_id,
          (valor.message_echoes ?? []) as MensajeCoexistencia[]
        );
        continue;
      }
      if (campo === 'history') {
        // Un lote puede traer cientos de mensajes. Se guarda después de
        // contestarle a Meta, que reintenta lo que tarda en responderse.
        after(() => guardarHistorial(metadata.phone_number_id, valor));
        continue;
      }
      if (campo === 'smb_app_state_sync') {
        // La libreta de contactos del celular va a una cuarentena que está
        // desconectada a propósito hasta el visto bueno legal de Cumbres
        // (decisión 26). Se descarta sin guardar nada.
        continue;
      }

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
        await guardarEntrante(supabase, linea, m, origen, metadata.phone_number_id!);
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

type Supabase = ReturnType<typeof createAdminClient>;

/** La línea de ese número, o null si no hay ninguna activa. */
async function lineaDe(supabase: Supabase, numero: string | undefined): Promise<Linea | null> {
  if (!numero) return null;
  const { data } = await supabase.schema('crm').rpc('linea_por_numero', { p_wa_phone_number_id: numero });
  return ((Array.isArray(data) ? data[0] : data) as Linea | undefined) ?? null;
}

/**
 * La conversación de esa persona, creándola si no existe. Dos lotes del
 * historial pueden querer crearla a la vez: si el segundo choca con el
 * único, la del primero ya está ahí.
 */
async function conversacionDe(
  supabase: Supabase,
  inmobiliariaId: string,
  telefono: string
): Promise<string | null> {
  const buscar = () =>
    supabase
      .from('agente_comercial_conversaciones')
      .select('id')
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('telefono', telefono)
      .maybeSingle();

  const { data: existente } = await buscar();
  if (existente?.id) return existente.id as string;

  const { data: nueva, error } = await supabase
    .from('agente_comercial_conversaciones')
    .insert({ inmobiliaria_id: inmobiliariaId, telefono })
    .select('id')
    .single();
  if (nueva?.id) return nueva.id as string;
  if (error?.code === '23505') {
    const { data: otra } = await buscar();
    if (otra?.id) return otra.id as string;
  }
  console.error('[WhatsApp] No se pudo crear la conversación:', error?.message);
  return null;
}

/** 'nuevo' si se guardó; 'repetido' si Meta ya lo había mandado. */
async function guardarFila(
  supabase: Supabase,
  conversacionId: string,
  numero: string,
  fila: FilaMensaje
): Promise<'nuevo' | 'repetido' | 'error'> {
  const { error } = await supabase.from('agente_comercial_mensajes').insert({
    conversacion_id: conversacionId,
    rol: fila.rol,
    contenido: fila.contenido,
    wa_message_id: fila.wa_message_id,
    wa_phone_number_id: numero,
    ...(fila.created_at ? { created_at: fila.created_at } : {}),
  });
  if (!error) return 'nuevo';
  // 23505 = choque de único por wa_message_id: un reintento de Meta.
  if (error.code === '23505') return 'repetido';
  console.error('[WhatsApp] No se pudo guardar el mensaje:', error.message);
  return 'error';
}

/**
 * Lo que alguien del equipo acaba de mandar desde la app del celular o
 * desde WhatsApp Web. Meta solo manda ecos de ahí, nunca de lo que sale por
 * la API: un eco es, sin ambigüedad, una persona escribiendo.
 *
 * Se guarda como 'asesor' y calla al bot en esa conversación (relevo,
 * decisión 24). El relevo va DESPUÉS de guardar: guardar es lo que crea el
 * contacto en el CRM si no existía. Un eco repetido no vuelve a anotarlo.
 */
async function guardarEcos(supabase: Supabase, numero: string | undefined, ecos: MensajeCoexistencia[]) {
  if (ecos.length === 0) return;
  const linea = await lineaDe(supabase, numero);
  if (!linea || !numero) {
    console.error('[WhatsApp] Llegó un eco a un número sin línea configurada:', numero);
    return;
  }

  for (const eco of ecos) {
    const leido = filaDeEco(eco);
    if (!leido) continue;
    const conversacionId = await conversacionDe(supabase, linea.inmobiliaria_id, leido.telefono);
    if (!conversacionId) continue;

    if ((await guardarFila(supabase, conversacionId, numero, leido.fila)) !== 'nuevo') continue;

    const { error } = await supabase.schema('crm').rpc('registrar_relevo', {
      p_wa_phone_number_id: numero,
      p_telefono: leido.telefono,
      p_ocurrido_at: leido.fila.created_at ?? new Date().toISOString(),
    });
    if (error) console.error('[WhatsApp] No se pudo anotar el relevo del eco:', error.message);
  }
}

/**
 * Un lote del historial de la app del celular, pedido al conectar la línea.
 *
 * Los lotes llegan desordenados (`chunk_order`) y pueden repetirse: cada
 * mensaje se guarda con su hora original y su wamid, así que el orden lo da
 * la fecha y los repetidos los frena el único. El progreso solo sube en la
 * base, así que un lote viejo no lo hace retroceder.
 *
 * NUNCA despierta al bot ni dispara el relevo: son mensajes del pasado. Un
 * «hola» de hace un año no es alguien escribiendo ahora.
 */
async function guardarHistorial(numero: string | undefined, valor: Record<string, unknown>) {
  try {
    const supabase = createAdminClient();
    const linea = await lineaDe(supabase, numero);
    if (!linea || !numero) {
      console.error('[WhatsApp] Llegó historial a un número sin línea configurada:', numero);
      return;
    }
    const crm = supabase.schema('crm');

    for (const e of erroresDeHistorial(valor as Parameters<typeof erroresDeHistorial>[0])) {
      const { error } = await crm.rpc('registrar_estado_linea', {
        p_wa_phone_number_id: numero,
        p_evento: 'historial_error',
        p_error_codigo: e.codigo,
        p_error: e.mensaje,
      });
      if (error) console.error('[WhatsApp] No se pudo anotar el error del historial:', error.message);
    }

    const lotes = (valor.history ?? []) as {
      metadata?: { progress?: number };
      threads?: { id?: string; messages?: MensajeCoexistencia[] }[];
    }[];

    for (const lote of lotes) {
      for (const hilo of lote.threads ?? []) {
        const leido = filasDeHilo(hilo);
        if (!leido || leido.filas.length === 0) continue;
        const conversacionId = await conversacionDe(supabase, linea.inmobiliaria_id, leido.telefono);
        if (!conversacionId) continue;
        for (const fila of leido.filas) await guardarFila(supabase, conversacionId, numero, fila);
      }

      const progreso = lote.metadata?.progress;
      if (typeof progreso === 'number' && Number.isFinite(progreso)) {
        const { error } = await crm.rpc('registrar_estado_linea', {
          p_wa_phone_number_id: numero,
          p_evento: 'historial_progreso',
          p_progreso: Math.max(0, Math.min(100, Math.round(progreso))),
        });
        if (error) console.error('[WhatsApp] No se pudo anotar el progreso del historial:', error.message);
      }
    }
  } catch (error) {
    console.error('[WhatsApp] Error guardando el historial:', error);
  }
}

async function guardarEntrante(
  supabase: ReturnType<typeof createAdminClient>,
  linea: Linea,
  m: MensajeMeta,
  origen: string,
  numero: string
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
      // Por qué número entró: con varias líneas, la ventana de 24 h y el
      // contexto del bot son por línea.
      wa_phone_number_id: numero,
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
          // El agente solo lee como contexto lo de esta línea.
          wa_phone_number_id: numero,
        }),
      });

      const respuesta = (await r.json().catch(() => null)) as RespuestaAgente | null;
      if (!r.ok && !respuesta?.response) {
        console.error('[WhatsApp] El agente no devolvió respuesta:', r.status);
        return;
      }
      await entregarRespuesta(supabase, numero, telefono, respuesta);
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
 * Sale por la MISMA línea por la que entró el mensaje, con su token de
 * Vault. Una línea sin credencial (el número de prueba de Meta, registrado
 * a mano) sale por las variables de entorno, que son las de ese número.
 */
async function entregarRespuesta(
  supabase: Supabase,
  numero: string,
  telefono: string,
  respuesta: RespuestaAgente | null
) {
  const credencial = await credencialDeLinea(supabase, numero);
  for (const clave of PARTES) {
    const texto = respuesta?.response?.[clave]?.trim();
    if (!texto) continue;

    const r = await enviarTexto(telefono, texto, credencial ?? undefined);
    if (credencial) await anotarResultadoCredencial(supabase, numero, r);
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
