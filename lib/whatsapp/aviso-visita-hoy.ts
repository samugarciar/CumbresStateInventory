import type { createAdminClient } from '@/lib/supabase/admin';
import { lugarDeVisita } from '@/lib/lugar-de-visita';
import {
  asegurarPlantilla,
  credencialComercial,
  horaLegible,
  telefonoE164,
  type DefinicionPlantilla,
} from './confirmacion-citas';
import { anotarResultadoCredencial } from './lineas';
import { enviarPlantilla } from './meta';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Aviso al equipo cuando el bot agenda una visita para el MISMO día.
 *
 * El equipo confirma las citas en una o dos rondas al día desde /citas, y
 * /citas no se actualiza sola. Lo que el bot agendaba para esa misma tarde
 * después de la ronda no lo veía nadie a tiempo: desde el 1 nov, de 25
 * citas del mismo día, 10 nunca se confirmaron. Daniela (9 nov) y Esteban
 * (10 nov) llegaron a Vidanta a las 4:30 p. m. y nadie los esperaba.
 *
 * Decisiones de Samuel (13 nov 2026):
 *   - solo las citas del mismo día: las de otros días las recoge la ronda;
 *   - solo avisa: la confirmación al cliente la sigue haciendo el admin desde
 *     /citas, que es quien puede hacerlo;
 *   - les llega al asesor de la franja (el que va a la visita) y a quien
 *     confirma, o sea a los admins activos que tengan teléfono.
 *
 * Sale como plantilla por la línea comercial: al número del asesor no se le
 * puede escribir texto libre fuera de la ventana de 24 horas. No se guarda
 * en ninguna conversación del CRM: es un aviso interno, no una conversación
 * con un cliente.
 */
export const PLANTILLA_AVISO_VISITA_HOY: DefinicionPlantilla = {
  nombreMeta: process.env.WHATSAPP_PLANTILLA_AVISO_VISITA_HOY?.trim() || 'aviso_visita_hoy_equipo',
  idioma: 'es',
  categoria: 'utility',
  cuerpo:
    'Nueva visita para hoy, agendada por el asistente de WhatsApp de Inmobiliaria Cumbres.\n\n' +
    '👤 Cliente: {{cliente}}\n' +
    '📞 Teléfono: {{telefono}}\n' +
    '🕒 Hora: {{hora}}\n' +
    '📍 Lugar: {{lugar}}\n' +
    '🧑‍💼 Asesor: {{asesor}}\n\n' +
    'Todavía no está confirmada. Confírmala en la plataforma para que el cliente reciba los datos del asesor.',
  ejemplos: {
    cliente: 'Laura Gómez',
    telefono: '300 123 4567',
    hora: '4:30 p. m.',
    lugar: 'Vidanta, CL 72 #65B-60',
    asesor: 'Julián Ospina',
  },
};

function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface CitaParaAviso {
  fecha: string;
  hora_inicio: string;
  cliente_nombre: string | null;
  cliente_telefono: string | null;
  unidad: string | null;
  inmuebles: { titulo: string | null; direccion: string | null; unidad: string | null } | null;
  franjas_horarias: {
    usuarios: { nombre_completo: string | null; telefono: string | null; activo: boolean | null } | null;
  } | null;
}

export interface AvisoPreparado {
  destinos: string[];
  variables: Record<string, string>;
}

/**
 * A quién y con qué datos, sin mandar nada. Null si no hay aviso que dar: la
 * cita no es de hoy, ya no está agendada o no hay a quién avisarle.
 */
export async function prepararAvisoVisitaDeHoy(
  admin: Admin,
  inmobiliariaId: string,
  citaId: string,
  hoy: string = hoyBogota()
): Promise<AvisoPreparado | null> {
  const { data, error } = await admin
      .from('citas')
      .select(`
        fecha, hora_inicio, cliente_nombre, cliente_telefono, unidad,
        inmuebles ( titulo, direccion, unidad ),
        franjas_horarias ( usuarios!franjas_horarias_asesor_id_fkey ( nombre_completo, telefono, activo ) )
      `)
    .eq('id', citaId)
    .eq('estado', 'agendada')
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[AvisoVisitaHoy] No se pudo leer la cita:', error.message);
    return null;
  }
  const cita = data as unknown as CitaParaAviso;
  if (cita.fecha !== hoy) return null;

  // ── A quién: el asesor de la franja y los admins con teléfono ───────────
  const asesor = cita.franjas_horarias?.usuarios ?? null;
  const destinos = new Set<string>();
  if (asesor?.activo !== false) {
    const t = telefonoE164(asesor?.telefono);
    if (t) destinos.add(t);
  }
  const { data: admins, error: errorAdmins } = await admin
    .from('usuarios')
    .select('telefono')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('rol', 'admin')
    .eq('activo', true)
    .not('telefono', 'is', null);
  if (errorAdmins) console.warn('[AvisoVisitaHoy] No se pudieron leer los admins:', errorAdmins.message);
  for (const a of admins ?? []) {
    const t = telefonoE164(a.telefono as string | null);
    if (t) destinos.add(t);
  }
  if (destinos.size === 0) {
    console.warn('[AvisoVisitaHoy] Cita de hoy sin nadie a quién avisar (ni asesor ni admin con teléfono):', citaId);
    return null;
  }

  const lugar = lugarDeVisita({ ...cita.inmuebles, unidad: cita.unidad || cita.inmuebles?.unidad });
  return {
    destinos: [...destinos],
    // Meta no acepta variables vacías.
    variables: {
      cliente: cita.cliente_nombre?.trim() || 'Sin nombre',
      telefono: cita.cliente_telefono?.trim() || 'sin teléfono',
      hora: horaLegible(cita.hora_inicio ?? ''),
      lugar: [lugar.nombre, lugar.direccion].filter(Boolean).join(', ') || 'ver en la plataforma',
      asesor: asesor?.nombre_completo?.trim() || 'sin asignar',
    },
  };
}

/**
 * Manda el aviso si la cita es para hoy. Nunca lanza: lo llama la ruta del
 * bot en after(), cuando el cliente ya tiene su respuesta, y un fallo aquí
 * solo se anota en el log.
 */
export async function avisarVisitaDeHoy(admin: Admin, inmobiliariaId: string, citaId: string): Promise<void> {
  try {
    const aviso = await prepararAvisoVisitaDeHoy(admin, inmobiliariaId, citaId);
    if (!aviso) return;

    // ── La línea comercial y la plantilla ─────────────────────────────────
    const credencial = await credencialComercial(admin, inmobiliariaId);
    if (!credencial) {
      console.warn('[AvisoVisitaHoy] La línea comercial no está conectada; no sale el aviso de', citaId);
      return;
    }
    // La primera vez la manda a revisión de Meta; mientras no esté aprobada,
    // el aviso no sale (queda la tarea en /tareas, como hasta ahora).
    const plantilla = await asegurarPlantilla(credencial, PLANTILLA_AVISO_VISITA_HOY);
    if (plantilla.estado !== 'aprobada') {
      console.warn('[AvisoVisitaHoy] La plantilla no está aprobada todavía:', JSON.stringify(plantilla));
      return;
    }

    for (const telefono of aviso.destinos) {
      const r = await enviarPlantilla(
        telefono,
        PLANTILLA_AVISO_VISITA_HOY.nombreMeta,
        PLANTILLA_AVISO_VISITA_HOY.idioma,
        aviso.variables,
        credencial
      );
      await anotarResultadoCredencial(admin, credencial.phoneNumberId, r);
      if (r.ok) console.log('[AvisoVisitaHoy] Aviso enviado a', telefono, 'por la cita', citaId);
      else console.error('[AvisoVisitaHoy] No salió el aviso a', telefono, ':', r.error ?? 'sin respuesta de Meta');
    }
  } catch (error) {
    console.error('[AvisoVisitaHoy] Falló el aviso de la cita', citaId, error);
  }
}
