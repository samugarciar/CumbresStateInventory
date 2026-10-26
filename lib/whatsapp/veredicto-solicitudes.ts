import type { createAdminClient } from '@/lib/supabase/admin';
import {
  PLANTILLA_CONFIRMACION,
  asegurarPlantilla,
  credencialComercial,
  diaLegible,
  guardarEnConversacion,
  horaLegible,
  telefonoE164,
  textoDePlantilla,
  type DefinicionPlantilla,
} from './confirmacion-citas';
import { anotarResultadoCredencial } from './lineas';
import { enviarPlantilla, enviarTexto, type ResultadoEnvio } from './meta';

/**
 * El aviso al cliente cuando el equipo aprueba o niega su solicitud de
 * apertura de agenda, por la línea comercial y sin Kommo ni n8n.
 *
 * Hasta el 25 oct lo mandaba un salesbot de Kommo por el 324, como mensaje
 * normal: el cliente venía de hablar con el bot, así que la ventana de
 * 24 h casi siempre estaba abierta. Aquí se hace igual (texto libre, sin
 * costo) y, si Meta responde que la ventana se cerró (131047), se usa una
 * plantilla: la de confirmación de visita para una aprobada y una propia
 * para una negada.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface Veredicto {
  resultado: 'aprobada' | 'denegada';
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  /** El título del inmueble, o la unidad cuando la solicitud es por unidad. */
  inmueble: string;
  direccion: string;
  alcance: string;
  aptos_count: number | null;
  fecha: string;
  hora_inicio: string;
  asesor: string | null;
  telefono_asesor: string | null;
  motivo: string | null;
}

export const PLANTILLA_NO_DISPONIBLE: DefinicionPlantilla = {
  nombreMeta: process.env.WHATSAPP_PLANTILLA_SOLICITUD_NEGADA?.trim() || 'solicitud_visita_no_disponible',
  idioma: 'es',
  categoria: 'utility',
  cuerpo:
    'Hola, te escribe Inmobiliaria Cumbres sobre tu solicitud de visita a {{inmueble}} el {{dia}} a las {{hora}}: {{motivo}}\n\n' +
    'Responde este mensaje y te ayudamos a encontrar otro horario.',
  ejemplos: {
    inmueble: 'Apartamento en Laureles',
    dia: 'martes 27 de octubre',
    hora: '4:30 p. m.',
    motivo: 'a esa hora no tenemos asesor disponible, pero podemos recibirte a las 2:00 p. m.',
  },
};

/** El primer nombre, si lo que hay parece un nombre y no un marcador. */
function primerNombre(nombre: string | null): string | null {
  const limpio = (nombre ?? '').trim();
  if (!limpio || /pendiente|sin nombre|cliente/i.test(limpio) || /^\(/.test(limpio)) return null;
  return limpio.split(/\s+/)[0];
}

function nombreDelInmueble(v: Veredicto): string {
  if (v.alcance === 'unidad') {
    return v.aptos_count ? `${v.inmueble} (${v.aptos_count} aptos disponibles)` : `${v.inmueble} (unidad)`;
  }
  return v.inmueble || 'el inmueble';
}

/** Una variable de plantilla no puede ir vacía ni traer saltos de línea. */
function paraVariable(texto: string, respaldo: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio || respaldo;
}

export function textoLibreVeredicto(v: Veredicto): string {
  const nombre = primerNombre(v.cliente_nombre);
  const saludo = nombre ? `¡Hola, ${nombre}!` : '¡Hola!';
  const dia = diaLegible(v.fecha);
  const hora = horaLegible(v.hora_inicio);
  if (v.resultado === 'aprobada') {
    const asesor = v.asesor ? (v.telefono_asesor ? `${v.asesor} (${v.telefono_asesor})` : v.asesor) : 'nuestro equipo';
    return (
      `${saludo} Te escribe Inmobiliaria Cumbres: tu visita quedó agendada ✅\n\n` +
      `🏠 ${nombreDelInmueble(v)}\n` +
      `📅 Día: ${dia}\n` +
      `🕒 Hora: ${hora}\n` +
      `📍 Dirección: ${v.direccion || 'te la compartimos por este medio'}\n` +
      `👤 Asesor encargado: ${asesor}\n\n` +
      'Si necesitas cambiar algo, responde este mensaje.'
    );
  }
  return (
    `${saludo} Te escribe Inmobiliaria Cumbres sobre tu solicitud de visita a ${nombreDelInmueble(v)} ` +
    `el ${dia} a las ${hora}${hora.endsWith('.') ? '' : '.'}\n\n` +
    `${(v.motivo ?? '').trim() || 'Ese horario no está disponible.'}\n\n` +
    'Responde este mensaje y te ayudamos a encontrar otro horario.'
  );
}

function plantillaDelVeredicto(v: Veredicto): { def: DefinicionPlantilla; variables: Record<string, string> } {
  const dia = diaLegible(v.fecha);
  const hora = horaLegible(v.hora_inicio);
  if (v.resultado === 'aprobada') {
    return {
      def: PLANTILLA_CONFIRMACION,
      variables: {
        inmueble: paraVariable(nombreDelInmueble(v), 'el inmueble'),
        dia,
        hora,
        direccion: paraVariable(v.direccion, 'te la compartimos por este medio'),
        asesor: paraVariable(
          v.asesor ? (v.telefono_asesor ? `${v.asesor} (${v.telefono_asesor})` : v.asesor) : '',
          'nuestro equipo'
        ),
      },
    };
  }
  return {
    def: PLANTILLA_NO_DISPONIBLE,
    variables: {
      inmueble: paraVariable(nombreDelInmueble(v), 'el inmueble'),
      dia,
      hora,
      motivo: paraVariable(v.motivo ?? '', 'ese horario no está disponible.'),
    },
  };
}

/**
 * Manda el veredicto. Nunca lanza: devuelve si salió y, si no, un aviso
 * para quien decidió, que ya quedó guardado en la base.
 */
export async function enviarVeredictoPorWhatsApp(
  admin: Admin,
  inmobiliariaId: string,
  v: Veredicto
): Promise<{ enviado: boolean; aviso?: string }> {
  try {
    const telefono = telefonoE164(v.cliente_telefono);
    if (!telefono) {
      return {
        enviado: false,
        aviso: `Decisión guardada, pero el teléfono «${v.cliente_telefono || 'vacío'}» no es un número de WhatsApp válido: avísale al cliente a mano.`,
      };
    }
    const credencial = await credencialComercial(admin, inmobiliariaId);
    if (!credencial) {
      return {
        enviado: false,
        aviso: 'Decisión guardada, pero la línea comercial de WhatsApp no está conectada: avísale al cliente a mano.',
      };
    }

    // 1 · Texto libre: es lo que hacía Kommo y no cuesta dentro de la ventana.
    let texto = textoLibreVeredicto(v);
    let r: ResultadoEnvio = await enviarTexto(telefono, texto, credencial);

    // 2 · Ventana cerrada: con plantilla.
    if (!r.ok && r.codigo === 131047) {
      const { def, variables } = plantillaDelVeredicto(v);
      const estado = await asegurarPlantilla(credencial, def);
      if (estado.estado !== 'aprobada') {
        return {
          enviado: false,
          aviso:
            'Decisión guardada, pero el cliente no escribe hace más de 24 horas y la plantilla para avisarle ' +
            (estado.estado === 'enviada_a_revision' || estado.estado === 'en_revision'
              ? 'está en revisión de Meta'
              : 'no está disponible') +
            ': avísale a mano.',
        };
      }
      texto = textoDePlantilla(def, variables);
      r = await enviarPlantilla(telefono, def.nombreMeta, def.idioma, variables, credencial);
    }
    await anotarResultadoCredencial(admin, credencial.phoneNumberId, r);

    if (!r.ok) {
      return {
        enviado: false,
        aviso: r.codigo
          ? `Decisión guardada, pero WhatsApp no entregó el aviso: ${r.error}. Avísale al cliente a mano.`
          : 'Decisión guardada, pero falló la conexión con WhatsApp y no se sabe si el aviso salió: revisa su chat en el CRM antes de escribirle.',
      };
    }

    await guardarEnConversacion(admin, inmobiliariaId, telefono, texto, r.waMessageId, credencial.phoneNumberId);
    return { enviado: true };
  } catch (e) {
    console.error('[Solicitudes] Error al mandar el veredicto:', e instanceof Error ? e.message : e);
    return { enviado: false, aviso: 'Decisión guardada, pero no se pudo mandar el aviso por WhatsApp: avísale al cliente a mano.' };
  }
}
