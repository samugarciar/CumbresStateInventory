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

async function llamar(cuerpo: Record<string, unknown>): Promise<ResultadoEnvio> {
  if (!estaConfigurado()) {
    return {
      ok: false,
      error:
        'El canal propio todavía no está configurado: falta mover el número a la Cloud API de Meta.',
    };
  }

  try {
    const r = await fetch(
      `${BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
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
export function enviarTexto(telefono: string, texto: string) {
  return llamar({
    to: telefono.replace(/^\+/, ''),
    type: 'text',
    text: { preview_url: true, body: texto },
  });
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
  variables: Record<string, string> = {}
) {
  const parametros = Object.entries(variables).map(([nombre, valor]) => ({
    type: 'text',
    parameter_name: nombre,
    text: valor,
  }));

  return llamar({
    to: telefono.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: nombrePlantilla,
      language: { code: idioma },
      ...(parametros.length
        ? { components: [{ type: 'body', parameters: parametros }] }
        : {}),
    },
  });
}
