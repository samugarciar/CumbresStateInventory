/**
 * Cliente de la Cloud API de WhatsApp (Meta).
 *
 * Es la única pieza que habla con Meta. Todo lo demás —el webhook, el
 * emisor, el CRM— pasa por aquí, para que el día que cambie la versión de
 * la API haya un solo sitio donde mirar.
 *
 * NO FUNCIONA HASTA QUE EL NÚMERO ESTÉ EN META. Mientras siga dentro de
 * Kommo, `estaConfigurado()` devuelve false y quien llame recibe un error
 * claro en vez de un fallo raro de red.
 */

import { META_APP_ID, type NumeroMeta } from './registro-integrado';

const VERSION = 'v21.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

export interface ResultadoEnvio {
  ok: boolean;
  /** El wamid que devuelve Meta. Es lo que casa los acuses con la fila. */
  waMessageId?: string;
  /** Código numérico de Meta. Se guarda aparte del texto porque un
   *  número se puede tratar y una frase no. */
  codigo?: number;
  error?: string;
}

export function estaConfigurado(): boolean {
  return Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN
  );
}

/**
 * Los códigos que hay que saber traducir, porque son los que un asesor
 * va a ver y los únicos sobre los que puede hacer algo.
 *
 * Mostrar «error 131047» a alguien que está atendiendo a un cliente en la
 * calle no es informar, es delegar el problema.
 */
export function explicarError(codigo: number | undefined, crudo: string): string {
  switch (codigo) {
    case 131047:
      return 'Pasaron más de 24 horas desde su último mensaje: solo se le puede escribir con una plantilla aprobada.';
    case 131049:
      return 'Meta retuvo el mensaje para cuidar la experiencia del usuario. Esta persona ya recibió demasiado marketing.';
    case 131026:
      return 'Ese número no recibe mensajes de WhatsApp.';
    case 132000:
    case 132001:
      return 'La plantilla no existe o no está aprobada con ese idioma.';
    case 130429:
      return 'Se superó el límite de mensajes por segundo. Hay que reintentar más despacio.';
    case 131031:
      return 'La cuenta de WhatsApp está restringida por Meta.';
    default:
      return crudo || 'WhatsApp rechazó el mensaje.';
  }
}

/**
 * Por qué número sale un mensaje, y con qué token.
 *
 * Cada línea conectada por el registro integrado tiene el suyo, guardado
 * en Vault (decisión 23). Sin credencial se usan las variables globales:
 * es el número de prueba de Meta, que no pasa por esa ventana.
 */
export interface CredencialLinea {
  phoneNumberId: string;
  token: string;
}

async function llamar(
  cuerpo: Record<string, unknown>,
  credencial?: CredencialLinea
): Promise<ResultadoEnvio> {
  const phoneNumberId = credencial?.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = credencial?.token ?? process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !token) {
    return {
      ok: false,
      error:
        'El canal propio todavía no está configurado: falta mover el número a la Cloud API de Meta.',
    };
  }

  try {
    const r = await fetch(
      `${BASE}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
      }
    );

    const datos = await r.json().catch(() => ({}));

    if (!r.ok) {
      const codigo = datos?.error?.code as number | undefined;
      const crudo = (datos?.error?.message as string) ?? `HTTP ${r.status}`;
      return { ok: false, codigo, error: explicarError(codigo, crudo) };
    }

    return { ok: true, waMessageId: datos?.messages?.[0]?.id };
  } catch (error) {
    // Un fallo de red NO es un rechazo de Meta, y confundirlos sería
    // grave: el mensaje puede haber salido igualmente. Se devuelve sin
    // código, y quien llame lo deja 'pendiente' en vez de 'fallido'.
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo hablar con Meta',
    };
  }
}

/**
 * Texto libre. Solo se entrega DENTRO de la ventana de 24 horas desde el
 * último mensaje del cliente; fuera, Meta responde 131047 y el cliente no
 * recibe nada. La regla se comprueba antes en `crm.encolar_envio()`, que
 * revienta: esto es la segunda línea, no la primera.
 */
export function enviarTexto(telefono: string, texto: string, credencial?: CredencialLinea) {
  return llamar(
    {
      to: telefono.replace(/^\+/, ''),
      type: 'text',
      text: { preview_url: true, body: texto },
    },
    credencial
  );
}

/**
 * Plantilla aprobada. Es lo único que se entrega fuera de la ventana.
 *
 * Las variables van NOMBRADAS y no posicionales: Meta admite
 * `parameter_format: NAMED` desde su catálogo de plantillas, y nuestras
 * variables (`nombre`, `asesor`, `inmueble`…) ya cumplen su regla —
 * minúsculas y guiones bajos. Verificado contra la documentación el
 * 17 sep 2026; una nota anterior afirmaba lo contrario y era falsa.
 */
export function enviarPlantilla(
  telefono: string,
  nombrePlantilla: string,
  idioma: string,
  variables: Record<string, string> = {},
  credencial?: CredencialLinea
) {
  const parametros = Object.entries(variables).map(([nombre, valor]) => ({
    type: 'text',
    parameter_name: nombre,
    text: valor,
  }));

  return llamar(
    {
      to: telefono.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: nombrePlantilla,
        language: { code: idioma },
        ...(parametros.length
          ? { components: [{ type: 'body', parameters: parametros }] }
          : {}),
      },
    },
    credencial
  );
}

// ---------------------------------------------------------------------
// Registro integrado (Embedded Signup v4)
//
// Lo que pasa en el servidor después de que alguien conecta su número en
// la ventana de Meta. A diferencia del envío, aquí el token NO es el de
// las variables globales: es el del negocio que acaba de conectarse, y
// se pasa en cada llamada.
// ---------------------------------------------------------------------

/**
 * El error de Meta entero, como llegó. Se guarda tal cual en
 * `crm.intentos_incorporacion` (decisión 28): una versión interpretada no
 * le sirve a su soporte, y el `fbtrace_id` es lo primero que pide.
 */
export interface ErrorMeta {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  [clave: string]: unknown;
}

export type RespuestaMeta<T> = { ok: true; datos: T } | { ok: false; error: ErrorMeta };

async function graph<T>(
  ruta: string,
  opciones: { token?: string; metodo?: 'GET' | 'POST'; cuerpo?: Record<string, unknown> } = {}
): Promise<RespuestaMeta<T>> {
  try {
    const headers: Record<string, string> = {};
    if (opciones.token) headers.Authorization = `Bearer ${opciones.token}`;
    if (opciones.cuerpo) headers['Content-Type'] = 'application/json';
    const r = await fetch(`${BASE}/${ruta}`, {
      method: opciones.metodo ?? (opciones.cuerpo ? 'POST' : 'GET'),
      headers,
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      cache: 'no-store',
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || datos?.error) {
      return { ok: false, error: (datos?.error as ErrorMeta) ?? { message: `HTTP ${r.status}` } };
    }
    return { ok: true, datos: datos as T };
  } catch (error) {
    // Sin respuesta no hay error de Meta que guardar: se marca como de red
    // para no confundirlo con un rechazo.
    return {
      ok: false,
      error: {
        type: 'red',
        message: error instanceof Error ? error.message : 'No se pudo hablar con Meta',
      },
    };
  }
}

function secretoApp(): string | null {
  return process.env.WHATSAPP_APP_SECRET?.trim() || null;
}

const SIN_SECRETO: ErrorMeta = {
  type: 'configuracion',
  message: 'Falta WHATSAPP_APP_SECRET en la plataforma: sin la clave secreta de la app no se puede canjear el código.',
};

/**
 * Canjea el código de la ventana por el token del negocio.
 *
 * El código vence a los 30 segundos: esto va antes que cualquier otra
 * cosa. El token que devuelve es el del usuario del sistema del negocio y,
 * por la configuración elegida, no vence. Nunca se escribe en un log ni
 * sale de este servidor; va directo a Vault con `crm.conectar_linea`.
 */
export function canjearCodigoRegistro(code: string) {
  const secreto = secretoApp();
  if (!secreto) return Promise.resolve({ ok: false as const, error: SIN_SECRETO });
  const params = new URLSearchParams({ client_id: META_APP_ID, client_secret: secreto, code });
  return graph<{ access_token?: string }>(`oauth/access_token?${params}`);
}

/** Los permisos del token, con las cuentas a las que da acceso. */
export function permisosDelToken(token: string) {
  const secreto = secretoApp();
  if (!secreto) return Promise.resolve({ ok: false as const, error: SIN_SECRETO });
  const params = new URLSearchParams({
    input_token: token,
    access_token: `${META_APP_ID}|${secreto}`,
  });
  return graph<{ data?: { granular_scopes?: { scope?: string; target_ids?: string[] }[] } }>(
    `debug_token?${params}`
  );
}

/** Los números de la cuenta de WhatsApp, con su nombre y su estado. */
export function numerosDeCuenta(wabaId: string, token: string) {
  const params = new URLSearchParams({
    fields: 'id,display_phone_number,verified_name,status,platform_type',
  });
  return graph<{ data?: NumeroMeta[] }>(`${encodeURIComponent(wabaId)}/phone_numbers?${params}`, {
    token,
  });
}

/**
 * Suscribe nuestra app a los webhooks de la cuenta. Sin esto, los mensajes
 * de ese número nunca llegan a la plataforma.
 */
export function suscribirApp(wabaId: string, token: string) {
  return graph<{ success?: boolean }>(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    token,
    metodo: 'POST',
  });
}

/** Las apps suscritas a la cuenta: es como se comprueba la suscripción. */
export function appsSuscritas(wabaId: string, token: string) {
  return graph<{ data?: { whatsapp_business_api_data?: { id?: string } }[] }>(
    `${encodeURIComponent(wabaId)}/subscribed_apps`,
    { token }
  );
}

/**
 * Pide a Meta el historial de mensajes de la app del celular.
 *
 * UNA sola vez y dentro de las 24 horas del registro: repetirlo exige
 * desincorporar el número y conectarlo otra vez. Los lotes llegan después
 * por el webhook (`history`), con su progreso y sin el `request_id`, que
 * solo sirve como constancia de que Meta aceptó la solicitud.
 */
export function pedirHistorial(phoneNumberId: string, token: string) {
  return graph<{ request_id?: string }>(`${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
    token,
    cuerpo: { messaging_product: 'whatsapp', sync_type: 'history' },
  });
}
