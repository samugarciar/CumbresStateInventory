// Tools del agente comercial de WhatsApp — port 1:1 de las tools HTTP que
// hoy usa el nodo langchain de n8n (workflow 3bihDRvaLKEDcQdw) contra las
// mismas RPCs de Supabase. Los contratos (nombres de parámetros, modos de
// respuesta, mensajes de error) están confirmados leyendo directamente las
// migraciones vigentes (supabase/migrations/2026-07-16_agentes_admin.sql y
// 2026-07-09_agendar_unidad.sql) — no son una reconstrucción de memoria.
//
// Las 4 RPCs con efecto (agendar/cancelar/solicitar/consultar disponibilidad)
// ya chequean agente_comercial_pausado() del lado de Postgres: si el switch
// de /agentes está apagado, devuelven {success:false, agente_pausado:true,
// error:'...'} o modo='agente_pausado' en vez de actuar. Estas tools no
// necesitan reimplementar esa guarda, solo propagar la respuesta tal cual.

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

// Postgres `ilike` ignora mayúsculas pero NO tildes: buscar "Niquía" (bien
// escrito) contra un barrio guardado como "Niquia" devuelve CERO resultados.
// Pasó con un cliente real el 11/ago: preguntó por Niquía y el agente le dijo
// que no teníamos nada, habiendo 8 apartamentos. Cada carácter fuera de
// [a-z0-9 espacio] se reemplaza por "_", el comodín de UN carácter en LIKE,
// así "Niquía" matchea tanto "Niquia" como "Niquía" (y "Peñol" ambas formas).
// De paso neutraliza % y _ que el cliente escriba, que serían comodines.
function patronFlexible(v: string): string {
  return [...v.trim()].map((ch) => (/[a-zA-Z0-9 ]/.test(ch) ? ch : '_')).join('');
}

const TIPO_TRANSACCION = z.enum(['arriendo', 'venta']);
const TIPO_INMUEBLE = z.enum(['casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro']);
const ALCANCE = z.enum(['inmueble', 'unidad']);

interface HerramientaUsada {
  nombre: string;
  entrada: unknown;
  salida: unknown;
}

export function crearToolsAgenteComercial(
  supabase: SupabaseClient,
  inmobiliariaId: string,
  bitacora: HerramientaUsada[]
) {
  const registrar = (nombre: string, entrada: unknown, salida: unknown) => {
    bitacora.push({ nombre, entrada, salida });
    return typeof salida === 'string' ? salida : JSON.stringify(salida);
  };

  // Arma la consulta de inventario. `omitirTipo` sirve para el reintento que
  // relaja el tipo de inmueble (ver más abajo).
  const consultaInmuebles = (args: Record<string, unknown>, omitirTipo = false) => {
    let query = supabase
      .from('inmuebles')
      .select('id,titulo,descripcion,tipo_inmueble,tipo_transaccion,precio,direccion,ciudad,barrio,habitaciones,banos,unidad')
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('estado', 'disponible');

    if (args.ciudad) query = query.ilike('ciudad', `%${patronFlexible(String(args.ciudad))}%`);
    if (args.barrio) query = query.ilike('barrio', `%${patronFlexible(String(args.barrio))}%`);
    if (args.habitaciones_min != null) query = query.gte('habitaciones', Number(args.habitaciones_min));
    if (args.precio_max != null) query = query.lte('precio', Number(args.precio_max));
    if (args.tipo_inmueble && !omitirTipo) query = query.eq('tipo_inmueble', String(args.tipo_inmueble));
    if (args.tipo_transaccion) query = query.eq('tipo_transaccion', String(args.tipo_transaccion));
    if (args.texto) {
      // Texto plano del modelo → la sintaxis .or() la arma el código (pedirle
      // al modelo sintaxis PostgREST cruda demostró ser frágil: mandaba
      // "Mi Mundo" literal y la query moría con "failed to parse logic tree").
      // Las comas y paréntesis son sintaxis del .or(), así que se quitan ANTES
      // de volver el resto flexible a las tildes.
      const limpio = String(args.texto).replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim();
      const t = patronFlexible(limpio);
      if (t) query = query.or(`titulo.ilike.%${t}%,descripcion.ilike.%${t}%,unidad.ilike.%${t}%`);
    }
    return query.limit(30);
  };

  const buscarInmuebles = tool(
    async (args) => {
      const { data, error } = await consultaInmuebles(args);
      if (error) return registrar('buscar_inmuebles', args, { error: error.message });

      const resultados = data ?? [];

      // Si el cliente pidió un TIPO concreto y no hay ninguno, no lo dejamos en
      // un callejón sin salida: se reintenta en la MISMA zona y transacción sin
      // el filtro de tipo, para poder ofrecerle lo que sí existe ahí. Caso real
      // (11/ago): pidió casa en arriendo en Niquía — no hay ninguna (ni en todo
      // Bello), pero sí 8 apartamentos en arriendo en ese mismo barrio. Se
      // relaja SOLO el tipo: la zona, el presupuesto y arriendo/venta son
      // requisitos reales del cliente y cambiarlos sería ofrecerle otra cosa.
      if (resultados.length === 0 && args.tipo_inmueble) {
        const { data: alt } = await consultaInmuebles(args, true);
        const alternativas = alt ?? [];
        if (alternativas.length > 0) {
          const tipos = [...new Set(alternativas.map((a) => a.tipo_inmueble))];
          return registrar('buscar_inmuebles', args, {
            sin_resultados_del_tipo_pedido: args.tipo_inmueble,
            mensaje:
              `No hay ${args.tipo_inmueble} con esos criterios, pero en la misma zona sí hay ` +
              `${alternativas.length} inmueble(s) de otro tipo (${tipos.join(', ')}). Ofrécelos como ` +
              `alternativa concreta en el mismo mensaje, sin pedir permiso ni dejar la conversación abierta.`,
            alternativas,
          });
        }
      }

      return registrar('buscar_inmuebles', args, resultados);
    },
    {
      name: 'buscar_inmuebles',
      description:
        'Busca inmuebles DISPONIBLES por filtros (ciudad, barrio, habitaciones mínimas, precio máximo, ' +
        'tipo de inmueble, tipo de transacción). Úsala para explorar el inventario cuando el cliente aún ' +
        'no señala un inmueble puntual. Varios resultados de la misma unidad/edificio son aptos distintos ' +
        'de la misma unidad — agrúpalos al presentarlos, no los listes como opciones sueltas. ' +
        'Si no hay nada del tipo pedido pero sí de otro tipo en la misma zona, la respuesta trae ' +
        '`sin_resultados_del_tipo_pedido` y una lista `alternativas`: presenta esas alternativas como ' +
        'opción concreta en el mismo mensaje (ej. "casas en arriendo en Niquía no tengo, pero sí 8 ' +
        'apartamentos desde $1.600.000, ¿te muestro?"), nunca cierres con un simple "no hay".',
      schema: z.object({
        ciudad: z.string().optional(),
        barrio: z.string().optional(),
        habitaciones_min: z.number().int().optional(),
        precio_max: z.number().optional(),
        tipo_inmueble: TIPO_INMUEBLE.optional(),
        tipo_transaccion: TIPO_TRANSACCION.optional(),
        texto: z
          .string()
          .optional()
          .describe(
            'Búsqueda por texto libre: nombre de la unidad/edificio o palabras del título/descripción ' +
              '(ej. "Mi Mundo", "Vidanta"). Texto plano tal cual — SIN comillas, comodines ni sintaxis especial. ' +
              'Busca en título, descripción y nombre de unidad a la vez.'
          ),
      }),
    }
  );

  const buscarInmueblePorCodigo = tool(
    async (args) => {
      const { data, error } = await supabase.rpc('buscar_inmueble_por_codigo', { p_codigo: args.codigo });
      const salida = error ? { error: error.message } : data;
      return registrar('buscar_inmueble_por_codigo', args, salida);
    },
    {
      name: 'buscar_inmueble_por_codigo',
      description:
        'Busca UN inmueble por su código del ERP Arrendasoft (el cliente lo da como "el código es 2026154" ' +
        'o similar). Devuelve un arreglo vacío si el código no existe. A diferencia de buscar_inmuebles, ' +
        'esta SÍ puede devolver inmuebles no disponibles — revisa el campo estado del resultado.',
      schema: z.object({
        codigo: z.string().describe('El código ERP tal como lo dio el cliente (solo dígitos importan).'),
      }),
    }
  );

  const verificarHorariosDisponibles = tool(
    async (args) => {
      const { data, error } = await supabase.rpc('consultar_disponibilidad_por_texto', {
        p_texto: args.texto,
        p_fecha_desde: args.fecha_desde ?? undefined,
        p_fecha_hasta: args.fecha_hasta ?? undefined,
        p_tipo_transaccion: args.tipo_transaccion ?? undefined,
      });
      const salida = error ? { error: error.message } : data;
      return registrar('verificar_horarios_disponibles', args, salida);
    },
    {
      name: 'verificar_horarios_disponibles',
      description:
        'Consulta la disponibilidad de agenda para un inmueble o unidad, por texto libre (ej. "707 de mi ' +
        'mundo" o "Mi Mundo" para toda la unidad). Devuelve filas con un campo modo: ' +
        '"disponibilidad" (un solo inmueble, hay franjas), "disponibilidad_unidad" (varios aptos de la ' +
        'misma unidad+tipo con franjas COMPARTIDAS — preséntalo como una sola opción "unidad, N aptos", no ' +
        'le pidas al cliente que elija un apto para agendar la visita), "candidatos" (ambiguo, pide más ' +
        'detalle), "sin_disponibilidad" (el inmueble/unidad existe pero no hay franjas en el rango), ' +
        '"sin_resultados" (no encontró nada que coincida), o "agente_pausado" (el agente está pausado por ' +
        'la inmobiliaria — no ofrezcas nada, indica que un asesor humano continuará). Pasa ' +
        'tipo_transaccion siempre que lo sepas para evitar ambigüedad entre unidades mixtas arriendo/venta.',
      schema: z.object({
        texto: z.string(),
        fecha_desde: z.string().optional().describe('YYYY-MM-DD, por defecto hoy.'),
        fecha_hasta: z.string().optional().describe('YYYY-MM-DD, por defecto 14 días después de fecha_desde.'),
        tipo_transaccion: TIPO_TRANSACCION.optional(),
      }),
    }
  );

  const agendarCita = tool(
    async (args) => {
      // Candado de idempotencia. Un mismo mensaje del cliente puede llegar dos
      // veces (visto 12/ago: "Panphillip Prada / 3147255335" entró a las
      // 16:19:53 y otra vez a las 16:20:20) y el agente, que ya tenía todos los
      // datos, agendaba de nuevo: 6 grupos de citas duplicadas en la base, uno
      // con 4 citas. Nadie puede estar en dos visitas a la misma hora, así que
      // teléfono + fecha + hora es una clave segura para detectar el duplicado.
      const { data: yaExiste } = await supabase
        .from('citas')
        .select('id,fecha,hora_inicio,hora_fin,unidad,alcance')
        .eq('inmobiliaria_id', inmobiliariaId)
        .eq('cliente_telefono', args.cliente_telefono.trim())
        .eq('fecha', args.fecha)
        .eq('hora_inicio', args.hora_inicio)
        .eq('estado', 'agendada')
        .maybeSingle();

      if (yaExiste) {
        return registrar('agendar_cita', args, {
          success: true,
          ya_existia: true,
          cita_id: yaExiste.id,
          fecha: yaExiste.fecha,
          hora_inicio: yaExiste.hora_inicio,
          hora_fin: yaExiste.hora_fin,
          alcance: yaExiste.alcance,
          unidad: yaExiste.unidad,
          mensaje:
            'Esta cita YA estaba agendada (mismo cliente, misma fecha y hora). No se creó una nueva. ' +
            'Confírmasela al cliente con naturalidad, como si acabaras de agendarla; NO le digas que ' +
            'estaba repetida ni que hubo un problema.',
        });
      }

      const { data, error } = await supabase.rpc('agendar_cita_por_texto', {
        p_texto: args.texto,
        p_fecha: args.fecha,
        p_hora_inicio: args.hora_inicio,
        p_hora_fin: args.hora_fin,
        p_cliente_nombre: args.cliente_nombre,
        p_cliente_telefono: args.cliente_telefono,
        p_cliente_email: args.cliente_email ?? undefined,
        p_notas: args.notas ?? undefined,
        p_alcance: args.alcance ?? undefined,
        p_tipo_transaccion: args.tipo_transaccion ?? undefined,
      });
      const salida = error ? { success: false, error: error.message } : data;
      return registrar('agendar_cita', args, salida);
    },
    {
      name: 'agendar_cita',
      description:
        'Agenda una cita/visita. NUNCA inventes un id de inmueble: resuelve por texto (igual que ' +
        'buscar_inmuebles/verificar_horarios_disponibles) — esta tool ya resuelve el texto internamente, ' +
        'no necesitas un UUID. Exige nombre y teléfono reales del cliente, confirmados en la conversación. ' +
        'Para agendar a nivel unidad (varios aptos, franjas compartidas) usa alcance="unidad" y el MISMO ' +
        'tipo_transaccion que usaste al consultar disponibilidad — sin eso falla con "no pude identificar ' +
        'una sola unidad y tipo". La hora debe ser una de las franjas devueltas por ' +
        'verificar_horarios_disponibles, en bloques de 30 minutos. Revisa success en la respuesta.',
      schema: z.object({
        texto: z.string(),
        fecha: z.string().describe('YYYY-MM-DD'),
        hora_inicio: z.string().describe('HH:MM'),
        hora_fin: z.string().describe('HH:MM'),
        cliente_nombre: z.string(),
        cliente_telefono: z.string(),
        cliente_email: z.string().optional(),
        notas: z.string().optional(),
        alcance: ALCANCE.optional(),
        tipo_transaccion: TIPO_TRANSACCION.optional(),
      }),
    }
  );

  const solicitarAperturaDeAgenda = tool(
    async (args) => {
      const { data, error } = await supabase.rpc('solicitar_apertura_agenda', {
        p_texto: args.texto,
        p_fecha: args.fecha,
        p_hora_inicio: args.hora_inicio,
        p_hora_fin: args.hora_fin,
        p_cliente_nombre: args.cliente_nombre,
        p_cliente_telefono: args.cliente_telefono,
        p_cliente_email: args.cliente_email ?? undefined,
        p_notas: args.notas ?? undefined,
        p_alcance: args.alcance ?? undefined,
        p_tipo_transaccion: args.tipo_transaccion ?? undefined,
      });
      const salida = error ? { success: false, error: error.message } : data;
      return registrar('solicitar_apertura_de_agenda', args, salida);
    },
    {
      name: 'solicitar_apertura_de_agenda',
      description:
        'Cuando el cliente pide un día/hora específico y verificar_horarios_disponibles NO trae esa hora ' +
        'exacta entre sus franjas (ya sea modo sin_disponibilidad, o disponibilidad/disponibilidad_unidad ' +
        'con franjas que no coinciden), NO lo descartes: ofrécele PROACTIVAMENTE, en el mismo mensaje, ' +
        'registrar una solicitud para que un asesor humano abra ese horario. Requiere nombre y teléfono ' +
        'reales del cliente YA confirmados en la conversación — nunca la llames con datos vacíos o ' +
        'inventados. Si la respuesta trae ya_disponible=true, esa hora en realidad SÍ está cubierta: agenda ' +
        'directo con agendar_cita en vez de insistir en la solicitud. Si trae ya_existia=true, ya había una ' +
        'solicitud idéntica pendiente — informa que sigue en revisión, no la dupliques.',
      schema: z.object({
        texto: z.string(),
        fecha: z.string().describe('YYYY-MM-DD'),
        hora_inicio: z.string().describe('HH:MM'),
        hora_fin: z.string().describe('HH:MM'),
        cliente_nombre: z.string(),
        cliente_telefono: z.string(),
        cliente_email: z.string().optional(),
        notas: z.string().optional(),
        alcance: ALCANCE.optional(),
        tipo_transaccion: TIPO_TRANSACCION.optional(),
      }),
    }
  );

  const cancelarCita = tool(
    async (args) => {
      const { data, error } = await supabase.rpc('cancelar_cita', {
        p_cita_id: args.cita_id,
        p_cliente_telefono: args.cliente_telefono,
      });
      const salida = error ? { success: false, error: error.message } : data;
      return registrar('cancelar_cita', args, salida);
    },
    {
      name: 'cancelar_cita',
      description:
        'Cancela una cita agendada, dado su id y el teléfono del cliente que la agendó (debe coincidir ' +
        'exacto). Solo úsala si el cliente da o confirma el id de la cita; si no lo tiene, no lo inventes.',
      schema: z.object({
        cita_id: z.string().uuid(),
        cliente_telefono: z.string(),
      }),
    }
  );

  const googleMapsLugares = tool(
    async (args) => {
      const key = process.env.GOOGLE_MAPS_API_KEY;
      if (!key) {
        return registrar('google_maps_lugares', args, { error: 'GOOGLE_MAPS_API_KEY no está configurado.' });
      }
      const params = new URLSearchParams({ key, language: 'es', region: 'co', query: args.query });
      if (args.location) params.set('location', args.location);
      if (args.radius) params.set('radius', String(args.radius));
      try {
        const resp = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
        const data = await resp.json();
        return registrar('google_maps_lugares', args, data);
      } catch (error) {
        return registrar('google_maps_lugares', args, { error: error instanceof Error ? error.message : String(error) });
      }
    },
    {
      name: 'google_maps_lugares',
      description:
        'Busca lugares cercanos a una dirección o punto de interés. Úsala cuando el cliente pregunte por ' +
        'referencias de ubicación, qué hay cerca de un inmueble, cómo llegar, o quiera saber sobre colegios, ' +
        'hospitales, supermercados, restaurantes, parques u otros lugares cercanos a una propiedad.',
      schema: z.object({
        query: z
          .string()
          .describe("Qué buscar y en qué zona, ej. 'colegios cerca de Laureles Medellin'."),
        location: z.string().optional().describe('Coordenadas opcionales lat,lng, ej. "6.2442,-75.5812".'),
        radius: z.number().optional().describe('Radio de búsqueda en metros (por defecto 1500).'),
      }),
    }
  );

  return [
    buscarInmuebles,
    buscarInmueblePorCodigo,
    verificarHorariosDisponibles,
    agendarCita,
    solicitarAperturaDeAgenda,
    cancelarCita,
    googleMapsLugares,
  ];
}
