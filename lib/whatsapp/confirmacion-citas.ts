import {
  crearPlantillaRevision,
  listarPlantillas,
  sanitizarTextoMeta,
} from './meta';
import type { CredencialDeLinea } from './lineas';

/**
 * Confirmar citas por la línea comercial, sin Kommo ni n8n.
 *
 * Hasta el 25 oct 2026 la confirmación salía así: la app llamaba al flujo
 * de n8n «Confirmacion citas cumbres», n8n movía el lead de Kommo a «Cita
 * Confirmada» y Kommo mandaba la plantilla por el 324. Con el 324 fuera
 * de Kommo ese camino respondía «confirmada» sin que el mensaje saliera.
 * Ahora la plantilla sale por la Cloud API desde la línea comercial (el
 * 312), con su token de Vault, y se marca confirmada solo si Meta la
 * acepta.
 *
 * El texto es el de la plantilla que usaba Kommo («Te escribe Inmobiliaria
 * Cumbres para confirmar la cita…»), con el día explícito: la de Kommo
 * decía «el día de hoy» y solo servía para confirmar el mismo día.
 */

export const PLANTILLA_CONFIRMACION = {
  nombreMeta: process.env.WHATSAPP_PLANTILLA_CONFIRMAR_CITA?.trim() || 'confirmacion_cita_visita',
  idioma: 'es',
  categoria: 'utility',
  cuerpo:
    '¡Hola! Te escribe Inmobiliaria Cumbres para confirmar tu visita a {{inmueble}}.\n\n' +
    '📅 Día: {{dia}}\n' +
    '🕒 Hora: {{hora}}\n' +
    '📍 Dirección: {{direccion}}\n' +
    '👤 Asesor encargado: {{asesor}}\n\n' +
    'Cualquier inquietud, puedes comunicarte directamente con el asesor o responder este mensaje.',
  ejemplos: {
    inmueble: 'Apartamento en Laureles',
    dia: 'lunes 27 de octubre',
    hora: '4:30 p. m.',
    direccion: 'Calle 33 # 76-20',
    asesor: 'Julián Ospina (300 123 4567)',
  },
} as const;

export interface VariablesConfirmacion {
  inmueble: string;
  dia: string;
  hora: string;
  direccion: string;
  asesor: string;
}

/** El texto que recibe el cliente, para guardarlo igual en su conversación. */
export function textoConfirmacion(v: VariablesConfirmacion): string {
  return PLANTILLA_CONFIRMACION.cuerpo.replace(/\{\{(\w+)\}\}/g, (_, clave: keyof VariablesConfirmacion) => v[clave] ?? '');
}

/**
 * «lunes 27 de octubre». La fecha de la cita es un día del calendario,
 * sin hora: se arma en UTC y se lee en UTC para que no se corra un día.
 */
export function diaLegible(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha ?? '');
  if (!m) return fecha;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(d)
    .replace(',', '');
}

/** «4:30 p. m.» a partir de «16:30» o «16:30:00». */
export function horaLegible(hora: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora ?? '');
  if (!m) return hora;
  const h = Number(m[1]);
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${sufijo}`;
}

/**
 * Teléfono en E.164, con las reglas de crm.normalizar_telefono: un número
 * colombiano de 10 dígitos que empieza por 3 recibe el +57. Lo que no se
 * pueda leer como teléfono devuelve null («pendiente», usuarios con @).
 */
export function telefonoE164(telefono: string | null | undefined): string | null {
  if (!telefono) return null;
  let marca = telefono.trim().startsWith('+');
  let d = telefono.replace(/\D/g, '');
  if (d.startsWith('00')) {
    d = d.slice(2);
    marca = true;
  }
  if (!d) return null;
  if (marca) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.length === 10 && d.startsWith('3')) return `+57${d}`;
  if (d.length === 12 && d.startsWith('57')) return `+${d}`;
  return null;
}

export type EstadoPlantilla =
  | { estado: 'aprobada' }
  | { estado: 'en_revision'; desde?: string }
  | { estado: 'rechazada'; motivo?: string }
  | { estado: 'enviada_a_revision' }
  | { estado: 'error'; mensaje: string };

/**
 * Dice si la plantilla de confirmación ya se puede usar en la cuenta de la
 * línea. Si no existe, la manda a revisión de Meta (una sola vez: la
 * siguiente consulta ya la encuentra en revisión).
 */
export async function asegurarPlantillaConfirmacion(credencial: CredencialDeLinea): Promise<EstadoPlantilla> {
  if (!credencial.wabaId) {
    return { estado: 'error', mensaje: 'La línea comercial no tiene cuenta de WhatsApp registrada: hay que reconectarla.' };
  }
  const lista = await listarPlantillas(credencial.wabaId, credencial.token);
  if (!lista.ok) {
    return { estado: 'error', mensaje: sanitizarTextoMeta(lista.error.message ?? 'Meta no dejó leer las plantillas.') };
  }
  const existente = (lista.datos.data ?? []).find(
    (p) => p.name === PLANTILLA_CONFIRMACION.nombreMeta && p.language === PLANTILLA_CONFIRMACION.idioma
  );
  if (existente) {
    const status = String(existente.status ?? '').toUpperCase();
    if (status === 'APPROVED') return { estado: 'aprobada' };
    if (status === 'REJECTED') {
      return { estado: 'rechazada', motivo: existente.rejected_reason ? String(existente.rejected_reason) : undefined };
    }
    return { estado: 'en_revision' };
  }

  const creada = await crearPlantillaRevision(credencial.wabaId, credencial.token, {
    nombreMeta: PLANTILLA_CONFIRMACION.nombreMeta,
    cuerpo: PLANTILLA_CONFIRMACION.cuerpo,
    categoria: PLANTILLA_CONFIRMACION.categoria,
    idioma: PLANTILLA_CONFIRMACION.idioma,
    ejemplos: { ...PLANTILLA_CONFIRMACION.ejemplos },
  });
  if (!creada.ok) {
    return { estado: 'error', mensaje: sanitizarTextoMeta(creada.error.message ?? 'Meta no aceptó la plantilla.') };
  }
  return { estado: 'enviada_a_revision' };
}
