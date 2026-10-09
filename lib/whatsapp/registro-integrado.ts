/**
 * El registro integrado de Meta (Embedded Signup v4), sin nada de red.
 *
 * Aquí vive lo que se puede razonar sin hablar con Meta: los
 * identificadores públicos de la app, qué embudos se pueden conectar, cómo
 * leer los eventos que manda la ventana de Meta y cómo elegir el número.
 * Lo importa también el navegador, así que no puede tocar secretos ni
 * nada de servidor: las llamadas a Meta están en `meta.ts`.
 *
 * La coexistencia —el mismo número en la app del celular y en la Cloud
 * API— solo entra por esta puerta. Ver la nota 9 del vault del CRM.
 */

/**
 * Los identificadores de la app de Meta «Inmobiliaria Cumbres» y de la
 * configuración del registro integrado (creada el 8 oct 2026: solo Cloud
 * API, token del usuario del sistema que no vence). No son secretos:
 * viajan al navegador en cada apertura de la ventana. Una variable de
 * entorno los reemplaza si algún día cambian.
 */
export const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID || '767937819514240';
export const CONFIG_REGISTRO_ID =
  process.env.NEXT_PUBLIC_META_ES_CONFIG_ID || '2064994710809725';

/** La versión del SDK de JavaScript que pide la guía de la v4. */
export const VERSION_SDK = 'v25.0';

/**
 * Los embudos que se pueden conectar desde la plataforma.
 *
 * La comercial NO está, a propósito: atiende clientes reales por Kommo y
 * va de última, sola (paso 6 del brief). Habilitarla es añadirla aquí, y
 * la ruta del servidor rechaza cualquier otro embudo aunque el navegador
 * lo pida.
 */
export const EMBUDOS_CONECTABLES = ['administrativa', 'captacion'] as const;

export function esEmbudoConectable(embudo: string): boolean {
  return (EMBUDOS_CONECTABLES as readonly string[]).includes(embudo);
}

/** Lo que cuenta la ventana de Meta sobre cómo terminó. */
export type EventoRegistro =
  | {
      tipo: 'fin';
      wabaId?: string;
      phoneNumberId?: string;
      businessId?: string;
      /** El fin propio de la coexistencia: solo trae el `waba_id`. */
      coexistencia: boolean;
    }
  | { tipo: 'cancelado'; paso?: string; datos: Record<string, unknown> }
  | { tipo: 'error'; codigo?: string; datos: Record<string, unknown> };

function texto(valor: unknown): string | undefined {
  if (typeof valor === 'string' && valor.trim()) return valor.trim();
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return undefined;
}

/**
 * Lee un `message` de la ventana de Meta. Devuelve null si no es suyo.
 *
 * El origen se comprueba por dominio exacto y no con `endsWith('facebook.com')`
 * como en el ejemplo de Meta: ese ejemplo deja pasar `evilfacebook.com`, y
 * por aquí entra el `waba_id` que se guarda como línea de la inmobiliaria.
 */
export function leerEventoRegistro(origen: string, crudo: unknown): EventoRegistro | null {
  let host: string;
  try {
    host = new URL(origen).hostname;
  } catch {
    return null;
  }
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return null;

  let mensaje = crudo;
  if (typeof crudo === 'string') {
    try {
      mensaje = JSON.parse(crudo);
    } catch {
      return null;
    }
  }
  if (!mensaje || typeof mensaje !== 'object') return null;

  const m = mensaje as { type?: unknown; event?: unknown; data?: unknown };
  if (m.type !== 'WA_EMBEDDED_SIGNUP') return null;

  const datos = (m.data && typeof m.data === 'object' ? m.data : {}) as Record<string, unknown>;
  const evento = texto(m.event) ?? '';

  if (
    evento === 'FINISH' ||
    evento === 'FINISH_ONLY_WABA' ||
    evento === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
  ) {
    return {
      tipo: 'fin',
      wabaId: texto(datos.waba_id),
      phoneNumberId: texto(datos.phone_number_id),
      businessId: texto(datos.business_id),
      coexistencia: evento === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    };
  }

  // Meta usa CANCEL para dos cosas distintas: la persona cerró la ventana
  // (trae `current_step`) o el flujo falló por dentro (trae `error_message`
  // y `error_id`). Se separan porque en el registro de intentos una es
  // 'cancelado' y la otra 'error' (decisión 28).
  if (evento === 'CANCEL') {
    if (datos.error_message !== undefined || datos.error_id !== undefined) {
      return { tipo: 'error', codigo: texto(datos.error_id), datos };
    }
    return { tipo: 'cancelado', paso: texto(datos.current_step), datos };
  }

  if (evento === 'ERROR') {
    return { tipo: 'error', codigo: texto(datos.error_id ?? datos.error_code), datos };
  }

  return null;
}

/** Un número de la cuenta de WhatsApp, como lo lista Meta. */
export interface NumeroMeta {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  platform_type?: string;
}

/**
 * Cuál de los números de la cuenta es el que se acaba de conectar.
 *
 * La ventana de la coexistencia solo devuelve el `waba_id`: el número se
 * busca después en la cuenta. Con uno solo no hay duda; con varios y sin
 * pista, se rechaza en vez de adivinar —guardar el número equivocado es
 * mandar mensajes desde otra línea—.
 */
export function elegirNumero(
  numeros: NumeroMeta[],
  preferido?: string
): { numero: NumeroMeta } | { error: string } {
  if (preferido) {
    const elegido = numeros.find((n) => n.id === preferido);
    if (elegido) return { numero: elegido };
  }
  if (numeros.length === 1) return { numero: numeros[0] };
  if (numeros.length === 0) {
    return { error: 'La cuenta de WhatsApp que se compartió no tiene ningún número.' };
  }
  return {
    error: `La cuenta de WhatsApp tiene ${numeros.length} números y Meta no dijo cuál se conectó.`,
  };
}

/** De «+57 320 533 8250» a «+573205338250». Sin dígitos, nada. */
export function aE164(telefono: string | undefined): string | undefined {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  return digitos.length >= 8 ? `+${digitos}` : undefined;
}

/**
 * Las cuentas de WhatsApp que el negocio le compartió a la app, según los
 * permisos del token. Es el respaldo cuando el `waba_id` del evento no
 * llegó: el orden entre el evento y la respuesta de la ventana no está
 * garantizado, y el código no puede esperar (vence a los 30 segundos).
 */
export function cuentasEnPermisos(
  permisos: { scope?: string; target_ids?: string[] }[] | undefined
): string[] {
  const ids = new Set<string>();
  for (const p of permisos ?? []) {
    if (p.scope === 'whatsapp_business_management' || p.scope === 'whatsapp_business_messaging') {
      for (const id of p.target_ids ?? []) ids.add(id);
    }
  }
  return [...ids];
}

/** Si nuestra app aparece entre las suscritas a la cuenta. */
export function appEstaSuscrita(
  apps: { whatsapp_business_api_data?: { id?: string } }[] | undefined,
  appId: string = META_APP_ID
): boolean {
  return (apps ?? []).some((a) => a.whatsapp_business_api_data?.id === appId);
}
