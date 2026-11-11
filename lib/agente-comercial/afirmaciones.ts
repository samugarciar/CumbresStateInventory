// CANDADO: el bot no puede decirle al cliente que su visita o su solicitud
// "quedó registrada" si no hay nada registrado.
//
// La regla 8 del prompt ya lo prohíbe y el modelo igual lo hace. Casos reales:
//   - 4 nov, Dariannys: pidió "el sábado" y el modelo lo convirtió en el 8 de
//     noviembre, que era domingo. solicitar_apertura_de_agenda lo rechazó
//     cuatro veces y aun así le dijo "ya quedó registrada tu solicitud para
//     el sábado en la mañana". No se guardó nada.
//   - 4 nov, Yenifer: su solicitud sí se registró, pero el equipo la descartó
//     (descartar borra la fila sin avisar). Ese mismo minuto preguntó "¿sí se
//     agendó la cita?" y el bot, que responde leyendo el historial del chat y
//     no la base, le dijo que quedó registrada.
//
// Lo que sí se puede comprobar es si existe el registro. Si la respuesta
// afirma uno, en el turno ninguna herramienta lo creó y en la base no hay una
// cita vigente ni una solicitud pendiente con el teléfono del cliente, la
// afirmación es falsa.

import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HerramientaUsada } from './graph';
import { AUTORIA_ASESOR } from './historial';

// De qué habla la frase: sin una de estas palabras, "quedó registrado" puede
// ser cualquier otra cosa.
const CONTEXTO_VISITA = /\b(cita|visita|solicitud|espacio|horario|agenda|recorrido|preferencia|cupo)\b/i;

// Afirmaciones en pasado o en estado ya cumplido. A propósito NO entran:
//   - "te separe" (subjuntivo: "¿quieres que te separe el espacio?"): por eso
//     se exige la tilde de "separé";
//   - "te separo" / "te lo registro" (ofrecimiento que todavía espera datos);
//   - "para registrar la cita" (infinitivo).
const AFIRMACIONES = [
  /\b(qued[óo]|ha quedado|han quedado|quedaron|est[áa]|ya est[áa])\s+(ya\s+)?(registrad|agendad|separad|reservad|programad|apartad|confirmad)[oa]s?\b/i,
  /\b(te|la|lo|le|les)\s+(separé|registré|agendé|reservé|programé|aparté)/i,
  /\bregistré\s+(tu|la|el|su|sus|tus)\b/i,
  // Sin \b al final: para JavaScript la "ó" no es letra y el límite no existe.
  /\bya\s+qued[óo](?=[\s,.;:!]|$)/i,
];

// "no quedó registrada", "ni quedó", "aún no está agendada".
const NEGACION_PREVIA = /\b(no|ni|nunca|aún no|todavía no)\s+(se\s+)?(ha\s+)?$/i;

// Se corta en frases solo donde la siguiente empieza en mayúscula: el punto
// de "5:30 p. m. quedó registrada" no termina la frase, y cortándolo ahí la
// afirmación quedaba lejos de la palabra "cita" (caso Yenifer).
const FIN_DE_FRASE = /(?<=[.!?])\s+(?=[¿¡]?[A-ZÁÉÍÓÚÑ])|\n+/;

export function afirmaRegistro(texto: string): boolean {
  const frases = (texto ?? '').split(FIN_DE_FRASE);
  for (const frase of frases) {
    if (!CONTEXTO_VISITA.test(frase)) continue;
    // Una pregunta no afirma nada ("¿quieres que quede registrada?").
    if (frase.trim().endsWith('?')) continue;
    for (const patron of AFIRMACIONES) {
      const m = patron.exec(frase);
      if (!m) continue;
      const antes = frase.slice(Math.max(0, m.index - 20), m.index);
      if (NEGACION_PREVIA.test(antes)) continue;
      return true;
    }
  }
  return false;
}

function exito(h: HerramientaUsada): boolean {
  const s = typeof h.salida === 'string' ? safeParse(h.salida) : h.salida;
  return !!(s && typeof s === 'object' && (s as { success?: boolean }).success === true);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** ¿En este turno una herramienta registró una cita o una solicitud? */
export function registroEnElTurno(bitacora: HerramientaUsada[]): boolean {
  return bitacora.some(
    (h) => (h.nombre === 'agendar_cita' || h.nombre === 'solicitar_apertura_de_agenda') && exito(h)
  );
}

// Celular colombiano, con o sin +57 y con espacios, puntos o guiones en medio:
// "322 8266539", "+57 300-756-8754", "3043279267".
const CELULAR = /(?:\+?57[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/g;

const diezDigitos = (t: string): string | null => {
  const d = t.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * Los números con los que el cliente pudo quedar registrado: el de la
 * conversación, los que él mismo escribió en el chat (Yenifer escribe desde
 * un número y dio otro para la cita) y los que se usaron en las herramientas.
 * Se comparan los últimos 10 dígitos: en citas conviven "3043279267" y
 * "+573043279267".
 */
export function telefonosDelCliente(
  telefono: string,
  historial: BaseMessage[],
  bitacora: HerramientaUsada[]
): string[] {
  const salida = new Set<string>();
  // El BSUID de quien escribe con «@» ("CO.1532686298679987") tiene dígitos
  // pero no es un teléfono.
  if (telefono && !/[a-z]/i.test(telefono)) {
    const d = diezDigitos(telefono);
    if (d) salida.add(d);
  }
  for (const m of historial) {
    if (!HumanMessage.isInstance(m)) continue;
    const texto = typeof m.content === 'string' ? m.content : '';
    // Lo que escribió una persona del equipo no son datos del cliente (puede
    // traer el celular del asesor).
    if (texto.includes(AUTORIA_ASESOR)) continue;
    for (const c of texto.matchAll(CELULAR)) {
      const d = diezDigitos(c[0]);
      if (d) salida.add(d);
    }
  }
  for (const h of bitacora) {
    const tel = (h.entrada as { cliente_telefono?: unknown } | null)?.cliente_telefono;
    if (typeof tel === 'string') {
      const d = diezDigitos(tel);
      if (d) salida.add(d);
    }
  }
  return [...salida];
}

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * ¿Hay a nombre del cliente una cita agendada o una solicitud de apertura
 * pendiente, de hoy en adelante? Devuelve null cuando no se puede saber (sin
 * teléfonos, o la consulta falló): en ese caso NO se bloquea la respuesta.
 * Un candado que se equivoca hacia el lado de callar al bot es peor que el
 * problema que tapa.
 */
export async function tieneAgendaVigente(
  supabase: SupabaseClient,
  inmobiliariaId: string,
  telefonos: string[]
): Promise<boolean | null> {
  if (telefonos.length === 0) return null;
  const hoy = hoyBogota();
  const filtro = telefonos.map((t) => `cliente_telefono.like.*${t}`).join(',');

  const [citas, solicitudes] = await Promise.all([
    supabase
      .from('citas')
      .select('id', { count: 'exact', head: true })
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('estado', 'agendada')
      .gte('fecha', hoy)
      .or(filtro),
    supabase
      .from('solicitudes_apertura')
      .select('id', { count: 'exact', head: true })
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('estado', 'pendiente')
      .gte('fecha', hoy)
      .or(filtro),
  ]);

  if (citas.error || solicitudes.error) {
    console.warn(
      '[AgenteComercial] No se pudo comprobar la agenda del cliente:',
      citas.error?.message ?? solicitudes.error?.message
    );
    return null;
  }
  return (citas.count ?? 0) + (solicitudes.count ?? 0) > 0;
}

// Lo que se le dice al modelo cuando su respuesta afirmó un registro que no
// existe. Va como mensaje humano marcado, igual que la autoría del asesor en
// historial.ts: es contexto, no una instrucción del cliente.
export const AVISO_REGISTRO_SIN_RESPALDO =
  '[Verificación automática del sistema. No la escribió el cliente y no debes mencionarla.] ' +
  'Tu respuesta anterior NO se envió: decía que la visita o la solicitud quedó registrada, pero en la ' +
  'agenda no hay ninguna cita vigente ni solicitud pendiente a nombre de este cliente, y en este turno ' +
  'ninguna herramienta registró nada. Escribe de nuevo tu respuesta para el cliente sin decir que algo ' +
  'quedó registrado, agendado, separado ni confirmado. Si una herramienta falló, revisa el error ' +
  '(por ejemplo, el día de la semana que corresponde a la fecha) y, si ya tienes todos los datos, ' +
  'corrígelo y vuelve a llamarla; solo si devuelve success: true puedes decir que quedó registrada. ' +
  'Si no tienes los datos, dile al cliente con naturalidad que su visita no aparece registrada y ' +
  'pregúntale qué día y hora le sirven.';

// Si ni corrigiendo se arregla, el cliente recibe esto y un asesor toma el caso.
export const RESPUESTA_REGISTRO_SIN_RESPALDO =
  'Para no darte un dato equivocado, prefiero que un asesor revise el estado de tu visita. ' +
  'Te escribe por este chat en un momento.';
