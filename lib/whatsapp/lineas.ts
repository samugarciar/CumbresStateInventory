import type { createAdminClient } from '@/lib/supabase/admin';
import type { CredencialLinea } from './meta';

/**
 * Las líneas de WhatsApp vistas desde la plataforma: con qué token habla
 * cada una y qué pasa cuando Meta lo rechaza.
 *
 * El token vive en Vault y solo lo devuelve `crm.credencial_linea()`, que
 * solo puede llamar `service_role` (decisión 23). No se guarda en ningún
 * otro sitio ni se escribe en un log.
 */

type Supabase = ReturnType<typeof createAdminClient>;

export interface CredencialDeLinea extends CredencialLinea {
  inmobiliariaId: string;
  embudo: string;
}

/**
 * La credencial de la línea de ese número. Null si la línea no pasó por el
 * registro integrado (por ejemplo, el número de prueba registrado a mano):
 * quien llama decide si cae a las variables globales o se niega.
 */
export async function credencialDeLinea(
  supabase: Supabase,
  phoneNumberId: string
): Promise<CredencialDeLinea | null> {
  const { data, error } = await supabase
    .schema('crm')
    .rpc('credencial_linea', { p_wa_phone_number_id: phoneNumberId });
  if (error) {
    console.error('[WhatsApp] No se pudo leer la credencial de la línea:', error.message);
    return null;
  }
  const fila = (Array.isArray(data) ? data[0] : data) as
    | { token?: string | null; inmobiliaria_id?: string; embudo?: string }
    | null
    | undefined;
  if (!fila?.token) return null;
  return {
    phoneNumberId,
    token: fila.token,
    inmobiliariaId: fila.inmobiliaria_id ?? '',
    embudo: fila.embudo ?? '',
  };
}

// ---------------------------------------------------------------------
// Lo que llega por la coexistencia, leído sin red ni base
//
// Dos campos nuevos del webhook: `history` (el historial del celular, que
// se pide una vez al conectar) y `smb_message_echoes` (lo que el equipo
// escribe desde la app o WhatsApp Web, ahora). Aquí solo se decide QUÉ se
// guarda; la ruta del webhook decide cuándo.
// ---------------------------------------------------------------------

export interface MensajeCoexistencia {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
}

export interface FilaMensaje {
  rol: 'usuario' | 'asesor';
  contenido: string;
  wa_message_id: string;
  /** La hora original del mensaje. Sin ella, la base pone la de ahora. */
  created_at?: string;
}

export function soloDigitos(valor?: string | null): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** Igual que el webhook de siempre: Meta manda el número sin el «+». */
export function conMas(numero: string): string {
  return numero.startsWith('+') ? numero : `+${numero}`;
}

/** Meta da los tiempos en segundos Unix, como texto. */
export function momentoDe(timestamp?: string): string | undefined {
  const segundos = Number(timestamp);
  return Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000).toISOString() : undefined;
}

export function contenidoDe(m: MensajeCoexistencia, quien: 'el cliente' | 'el equipo'): string {
  const texto = m.type === 'text' ? m.text?.body?.trim() : undefined;
  return texto || `[${quien} mandó ${m.type ?? 'un mensaje'}, que todavía no sabemos leer]`;
}

/**
 * Un hilo del historial: una fila por mensaje, con su autor y su hora.
 *
 * El hilo es la conversación con UNA persona, y su `id` es el número de
 * esa persona. Lo que ella mandó tiene su número en `from`; lo demás lo
 * mandó el negocio desde la app, o sea alguien del equipo: va como
 * 'asesor', nunca como 'agente'. El bot no escribió nada de esto, y si lo
 * creyera suyo repetiría promesas que hizo una persona (hallazgo 1).
 */
export function filasDeHilo(hilo: { id?: string; messages?: MensajeCoexistencia[] }): {
  telefono: string;
  filas: FilaMensaje[];
} | null {
  const cliente = soloDigitos(hilo.id);
  if (!hilo.id || !cliente) return null;
  const filas: FilaMensaje[] = [];
  for (const m of hilo.messages ?? []) {
    if (!m.id) continue;
    const delCliente = soloDigitos(m.from) === cliente;
    filas.push({
      rol: delCliente ? 'usuario' : 'asesor',
      contenido: contenidoDe(m, delCliente ? 'el cliente' : 'el equipo'),
      wa_message_id: m.id,
      created_at: momentoDe(m.timestamp),
    });
  }
  return { telefono: conMas(hilo.id), filas };
}

/** Un eco: lo que alguien del equipo acaba de mandar desde el celular. */
export function filaDeEco(eco: MensajeCoexistencia): { telefono: string; fila: FilaMensaje } | null {
  if (!eco.id || !eco.to) return null;
  return {
    telefono: conMas(eco.to),
    fila: {
      rol: 'asesor',
      contenido: contenidoDe(eco, 'el equipo'),
      wa_message_id: eco.id,
      created_at: momentoDe(eco.timestamp),
    },
  };
}

export interface ErrorHistorial {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

/**
 * Los errores del historial, vengan en el valor o en un lote. El que más
 * va a salir es 2593109: el negocio apagó compartir el historial en la
 * app. No es un fallo nuestro, y hay que verlo así en el CRM.
 */
export function erroresDeHistorial(valor: {
  errors?: ErrorHistorial[];
  history?: { errors?: ErrorHistorial[] }[];
}): { codigo: number | null; mensaje: string | null }[] {
  const todos = [...(valor.errors ?? []), ...(valor.history ?? []).flatMap((l) => l.errors ?? [])];
  return todos.map((e) => ({
    codigo: typeof e.code === 'number' ? e.code : null,
    mensaje: e.title ?? e.message ?? e.error_data?.details ?? null,
  }));
}

/** Meta usa 190 (con sus subcódigos) para todo token que ya no vale. */
export const TOKEN_INVALIDO = 190;

/**
 * Después de cada llamada a Meta con la credencial de una línea.
 *
 * Un 190 deja la línea en un estado VISIBLE en el CRM («Meta rechaza el
 * token») en vez de fallar en silencio en cada envío. Si después una
 * llamada con esa credencial funciona, se limpia: la función de la base no
 * hace nada si la línea no estaba marcada.
 */
export async function anotarResultadoCredencial(
  supabase: Supabase,
  phoneNumberId: string,
  resultado: { ok: boolean; codigo?: number; error?: string }
) {
  const crm = supabase.schema('crm');
  if (resultado.codigo === TOKEN_INVALIDO) {
    const { error } = await crm.rpc('registrar_estado_linea', {
      p_wa_phone_number_id: phoneNumberId,
      p_evento: 'token_invalido',
      p_error_codigo: TOKEN_INVALIDO,
      p_error: resultado.error ?? null,
    });
    if (error) console.error('[WhatsApp] No se pudo marcar el token inválido:', error.message);
  } else if (resultado.ok) {
    const { error } = await crm.rpc('registrar_estado_linea', {
      p_wa_phone_number_id: phoneNumberId,
      p_evento: 'token_valido',
    });
    if (error) console.error('[WhatsApp] No se pudo marcar el token válido:', error.message);
  }
}
