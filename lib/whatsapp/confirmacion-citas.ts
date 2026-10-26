import type { createAdminClient } from '@/lib/supabase/admin';
import { conversacionDe } from './conversaciones';
import { credencialDeLinea, type CredencialDeLinea } from './lineas';
import {
  crearPlantillaRevision,
  listarPlantillas,
  sanitizarTextoMeta,
} from './meta';

type Admin = ReturnType<typeof createAdminClient>;

/** Una plantilla propia: lo que Meta necesita para crearla y revisarla. */
export interface DefinicionPlantilla {
  nombreMeta: string;
  idioma: string;
  categoria: string;
  cuerpo: string;
  ejemplos: Record<string, string>;
}

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

export const PLANTILLA_CONFIRMACION: DefinicionPlantilla = {
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
};

export interface VariablesConfirmacion {
  inmueble: string;
  dia: string;
  hora: string;
  direccion: string;
  asesor: string;
}

/** El texto que recibe el cliente con una plantilla, para guardarlo igual en su conversación. */
export function textoDePlantilla(def: DefinicionPlantilla, v: Record<string, string>): string {
  return def.cuerpo.replace(/\{\{(\w+)\}\}/g, (_, clave: string) => v[clave] ?? '');
}

export function textoConfirmacion(v: VariablesConfirmacion): string {
  return textoDePlantilla(PLANTILLA_CONFIRMACION, { ...v });
}

/**
 * La línea comercial de la inmobiliaria con su token (de Vault, solo con
 * service_role). Null si no está conectada. El token no sale del servidor.
 */
export async function credencialComercial(admin: Admin, inmobiliariaId: string): Promise<CredencialDeLinea | null> {
  const { data } = await admin
    .schema('crm')
    .from('lineas')
    .select('wa_phone_number_id')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('embudo', 'comercial')
    .eq('activa', true)
    .maybeSingle();
  const numero = data?.wa_phone_number_id as string | undefined;
  return numero ? credencialDeLinea(admin, numero) : null;
}

/**
 * Deja en la conversación del cliente un mensaje que mandó la plataforma,
 * para que se vea en el CRM y su respuesta caiga en el mismo hilo. Sale
 * como del equipo (rol 'asesor') y NO registra relevo: es un aviso
 * automático, el bot sigue atendiendo. Si no se puede guardar, el mensaje
 * igual salió: se anota en el log y se sigue.
 */
export async function guardarEnConversacion(
  admin: Admin,
  inmobiliariaId: string,
  telefono: string,
  texto: string,
  waMessageId: string | undefined,
  phoneNumberId: string
): Promise<void> {
  const conversacionId = await conversacionDe(admin, inmobiliariaId, telefono);
  if (!conversacionId) {
    console.error('[WhatsApp] Aviso enviado, pero no se pudo crear la conversación de', telefono);
    return;
  }
  const { error } = await admin.from('agente_comercial_mensajes').insert({
    conversacion_id: conversacionId,
    rol: 'asesor',
    contenido: texto,
    wa_message_id: waMessageId,
    wa_phone_number_id: phoneNumberId,
  });
  if (error) console.error('[WhatsApp] Aviso enviado pero no registrado:', error.message);
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
 * Dice si una plantilla propia ya se puede usar en la cuenta de la línea.
 * Si no existe, la manda a revisión de Meta (una sola vez: la siguiente
 * consulta ya la encuentra en revisión).
 */
export async function asegurarPlantilla(
  credencial: CredencialDeLinea,
  def: DefinicionPlantilla
): Promise<EstadoPlantilla> {
  if (!credencial.wabaId) {
    return { estado: 'error', mensaje: 'La línea comercial no tiene cuenta de WhatsApp registrada: hay que reconectarla.' };
  }
  const lista = await listarPlantillas(credencial.wabaId, credencial.token);
  if (!lista.ok) {
    return { estado: 'error', mensaje: sanitizarTextoMeta(lista.error.message ?? 'Meta no dejó leer las plantillas.') };
  }
  const existente = (lista.datos.data ?? []).find(
    (p) => p.name === def.nombreMeta && p.language === def.idioma
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
    nombreMeta: def.nombreMeta,
    cuerpo: def.cuerpo,
    categoria: def.categoria,
    idioma: def.idioma,
    ejemplos: { ...def.ejemplos },
  });
  if (!creada.ok) {
    return { estado: 'error', mensaje: sanitizarTextoMeta(creada.error.message ?? 'Meta no aceptó la plantilla.') };
  }
  return { estado: 'enviada_a_revision' };
}

export function asegurarPlantillaConfirmacion(credencial: CredencialDeLinea): Promise<EstadoPlantilla> {
  return asegurarPlantilla(credencial, PLANTILLA_CONFIRMACION);
}
