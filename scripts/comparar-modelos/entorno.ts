// Lo que comparten comparar.ts y conversar.ts: un Supabase de producción con
// las ESCRITURAS simuladas y el mismo envoltorio de fecha que la ruta.
import { RAIZ } from './cargar-env';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '../../lib/supabase/admin';

export const AQUI = process.env.SALIDA || path.join(os.tmpdir(), 'comparar-modelos-comercial');
fs.mkdirSync(AQUI, { recursive: true });

export const supabase = createAdminClient();
const inmo = process.env.CUMBRES_INMOBILIARIA_ID;
if (!inmo) throw new Error('Falta CUMBRES_INMOBILIARIA_ID en .env.local');
export const INMO: string = inmo;

// Las lecturas van a la base real; crear o cancelar citas y solicitudes, y
// crear tareas, devuelve un éxito simulado: el agente cree que agendó, pero
// nada llega a la base.
const ESCRITURAS = new Set(['agendar_cita_por_texto', 'solicitar_apertura_agenda', 'cancelar_cita']);
const tareasSimuladas = { insert: () => Promise.resolve({ error: null }) };

export const supabaseSimulado = new Proxy(supabase, {
  get(obj, prop, receptor) {
    if (prop === 'rpc') {
      return (nombre: string, args: Record<string, unknown>) => {
        if (!ESCRITURAS.has(nombre)) return obj.rpc(nombre, args);
        const data =
          nombre === 'cancelar_cita'
            ? { success: true }
            : {
                success: true,
                cita_id: null,
                fecha: args.p_fecha,
                hora_inicio: args.p_hora_inicio,
                hora_fin: args.p_hora_fin,
                simulada: true,
              };
        return Promise.resolve({ data, error: null });
      };
    }
    if (prop === 'from') {
      return (tabla: string) => (tabla === 'tareas' ? tareasSimuladas : obj.from(tabla));
    }
    const valor: unknown = Reflect.get(obj, prop, receptor);
    return typeof valor === 'function' ? valor.bind(obj) : valor;
  },
}) as SupabaseClient;

// Copia de envolverConFecha (app/api/agentes/comercial-whatsapp/route.ts),
// que no se puede importar sin arrastrar Next. Si la ruta cambia, falla.
const ruta = fs.readFileSync(path.join(RAIZ, 'app/api/agentes/comercial-whatsapp/route.ts'), 'utf8');
if (!ruta.includes('function envolverConFecha')) throw new Error('La ruta cambió: revisar envolverConFecha');

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const bogota = (opciones: Intl.DateTimeFormatOptions, locale = 'en-CA') =>
  new Intl.DateTimeFormat(locale, { timeZone: 'America/Bogota', ...opciones });

function trimestre(fecha: Date): string {
  const [anio, mes] = bogota({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha).split('-').map(Number);
  const enCurso = Math.floor((mes - 1) / 3);
  const cerrado = (enCurso + 3) % 4;
  const anioCerrado = enCurso === 0 ? anio - 1 : anio;
  const i = cerrado * 3;
  return `${MESES[i]}, ${MESES[i + 1]} y ${MESES[i + 2]} de ${anioCerrado}`;
}

export function envolverConFecha(mensaje: string, fecha: Date): string {
  const fechaISO = bogota({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  const dia = bogota({ weekday: 'long' }, 'es-CO').format(fecha);
  const anio = bogota({ year: 'numeric' }).format(fecha);
  const hora = bogota({ hour: '2-digit', minute: '2-digit', hour12: true }, 'es-CO').format(fecha);
  return (
    `Fecha y hora ahora: ${fechaISO} (${dia}) ${hora}, zona America/Bogota. El año actual es ${anio}. ` +
    'Usa esto SOLO para interpretar "hoy", "mañana", "esta tarde" y los días de la semana; las fechas para ' +
    'agendar cópialas del resultado de disponibilidad. ⚠️ No ofrezcas ni des por válido un horario de HOY que ' +
    'ya pasó o que empiece dentro de menos de 30 minutos: el cliente necesita tiempo para llegar. Las ' +
    'herramientas ya ocultan esos bloques, así que ofrece únicamente los que te devuelvan.' +
    `\nEl "último trimestre" de los extractos bancarios es HOY: ${trimestre(fecha)}. ` +
    'Si te preguntan cuáles meses, di exactamente esos tres — no los calcules ni los cambies.' +
    `\n\nMensaje del usuario: ${mensaje}`
  );
}
