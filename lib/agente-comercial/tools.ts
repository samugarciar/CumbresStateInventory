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
import { fotosDeInmueble } from '@/lib/fotos';

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

// Normaliza el texto antes de mandárselo al resolver de Postgres. Hoy solo
// arregla la puntuación: el token "málaga," no matchea contra "MALAGA", así
// que "Urb. Málaga, apto 410" fallaba mientras "Urb. Málaga 410" funcionaba.
//
// Hasta el 28/ago esta función TAMBIÉN borraba los códigos del ERP (5+
// dígitos), porque `arrendasoft_id` no estaba entre los campos que buscaba el
// resolver y "Montiara 2026195" no resolvía nunca. Ese arreglo se volvió en
// contra: cuando el código es lo ÚNICO que distingue un apartamento de otro,
// borrarlo vuelve el texto AMBIGUO — "Villas del Sol 2026198" quedaba en
// "Villas del Sol", tres candidatos, y la herramienta se negaba. Fueron 16 de
// los 53 fallos de resolución de esas dos semanas.
// Ahora el resolver compara los códigos exacto contra `arrendasoft_id` y, si
// no encuentra nada, reintenta él mismo sin el código
// (2026-08-28_resolver_codigo_y_ruido.sql). Borrarlos acá le taparía el dato.
export function limpiarTextoInmueble(texto: string): { limpio: string; quitado: string[] } {
  const limpio = texto.replace(/[.,;:]/g, ' ').split(/\s+/).filter(Boolean).join(' ').trim();
  return { limpio, quitado: [] };
}

// Precio EFECTIVO. Un inmueble arrendado que se desocupa se vuelve a ofrecer
// con el canon ajustado por IPC, pero el ERP conserva el del contrato viejo
// hasta que se firma el nuevo; por eso el admin fija `precio_oferta` al
// apretar "Ofertar (desocupado)" en /inmuebles, y ese manda.
//
// Clave: al modelo se le entrega UN SOLO número, no los dos. El 28/ago un
// cliente recibió $1.200.000 por un apartamento de $1.367.600 porque el
// sistema le dio dos precios (la columna y uno escrito a mano dentro de la
// descripción) y eligió el que no era. Pedirle al modelo que elija entre dos
// datos contradictorios es la forma segura de que se equivoque.
function conPrecioEfectivo<T extends { precio?: number | null; precio_oferta?: number | null }>(fila: T): T {
  const { precio_oferta: oferta, ...resto } = fila;
  return { ...resto, precio: oferta ?? fila.precio } as unknown as T;
}

// Colombia es UTC-5 fijo (sin horario de verano), pero el servidor corre en
// UTC: sin esto, "hoy" y "la hora" se corren 5 horas.
function ahoraBogota(): { fecha: string; minutos: number } {
  const ahora = new Date();
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ahora);
  const [h, m] = hhmm.split(':').map(Number);
  return { fecha, minutos: h * 60 + m };
}

// Margen mínimo entre "ahora" y el inicio de una visita que se puede ofrecer o
// agendar. El cliente necesita tiempo para llegar y el asesor para prepararse.
const MARGEN_MIN = 30;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Día de la semana de una fecha 'AAAA-MM-DD'. Las RPC devuelven la fecha pero
// NO el día, y el agente lo calculaba de cabeza: le dijo a un cliente "lunes 18
// de agosto" cuando el 18 era martes, y arrastró el error toda la conversación.
// Los modelos son poco confiables haciendo aritmética de calendario, así que se
// les entrega resuelto.
// OJO con la zona: `new Date('2026-08-18')` es medianoche UTC y al mirarlo desde
// Bogotá (UTC-5) cae el día anterior. Por eso se arma en UTC y se lee en UTC.
function diaSemana(fecha: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha ?? ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return DIAS[d.getUTCDay()] ?? null;
}

// Agrega `dia_semana` a cualquier objeto que tenga `fecha`, para que el agente
// nunca tenga que deducirlo.
function conDiaSemana<T extends Record<string, unknown>>(obj: T): T & { dia_semana?: string } {
  const dia = typeof obj?.fecha === 'string' ? diaSemana(obj.fecha) : null;
  return dia ? { ...obj, dia_semana: dia } : obj;
}

// Los asesores descansan el domingo: no hay visitas. Es un hecho del negocio,
// no un hueco de agenda — en toda la historia hay 0 franjas y 0 citas en
// domingo, sobre 275 franjas y 433 citas. Aun así llegaban solicitudes de
// apertura para domingo, y las 3 que hubo terminaron igual: dos denegadas a
// mano ("el día domingo no prestamos servicio", "es el día de descanso de
// nuestros asesores") y la tercera, aunque figura aprobada, se movió al
// martes. O sea: el 100% se perdió como domingo, después de hacerle creer al
// cliente que su solicitud estaba en trámite.
function esDomingo(fecha: string): boolean {
  return diaSemana(fecha) === 'domingo';
}

// ¿Ese bloque ya pasó, o arranca en menos de MARGEN_MIN minutos?
// Caso real (12/ago 16:37): el agente ofreció "3:00 pm o 3:30 pm" para hoy y
// el cliente respondió "Hoy ya son las 4y38". La RPC devuelve los bloques del
// día aunque la hora ya haya pasado, así que filtrarlos es responsabilidad
// nuestra y se hace en código, no confiando en que el modelo mire el reloj.
function bloqueDemasiadoPronto(fecha: string, horaInicio: string): boolean {
  const ahora = ahoraBogota();
  if (fecha > ahora.fecha) return false; // otro día futuro: siempre válido
  if (fecha < ahora.fecha) return true; // día pasado
  const [h, m] = String(horaInicio).split(':').map(Number);
  return h * 60 + m < ahora.minutos + MARGEN_MIN;
}

const TIPO_TRANSACCION = z.enum(['arriendo', 'venta']);
const TIPO_INMUEBLE = z.enum(['casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro']);
const ALCANCE = z.enum(['inmueble', 'unidad']);

// Cuando el resolver no da con el inmueble, el error de la RPC dice "sé más
// específico", que es lo contrario de lo que le sirve al agente en ese momento.
// Caso del 28/ago (Luis Casallas): con la franja ya encontrada y el cliente
// dando su nombre, reintentó con el MISMO texto que ya le había fallado y la
// cita nunca se creó. Acá se le dice qué probar, sin tocar el contrato de la
// RPC, que también consume el backend.
function conPistaDeReintento(salida: Record<string, unknown>, texto: string): Record<string, unknown> {
  const err = String(salida?.error ?? '');
  if (salida?.success !== false || !err) return salida;

  if (/No encontr/i.test(err)) {
    const palabras = texto.trim().split(/\s+/).filter(Boolean);
    const soloNombre = palabras.filter((p) => !/^\d+$/.test(p)).join(' ');
    if (palabras.length > 1 && soloNombre && soloNombre !== texto.trim()) {
      return {
        ...salida,
        reintenta_con: soloNombre,
        mensaje:
          'Ese texto no resolvió. NO se lo traslades al cliente ni le pidas que sea más específico: ' +
          'vuelve a llamar esta MISMA herramienta con el valor de `reintenta_con`. Escribe solo el ' +
          'nombre del edificio y, si lo sabes, el número de apartamento — nunca palabras como ' +
          '"piso", "torre" o "unidad".',
      };
    }
    return {
      ...salida,
      mensaje:
        'Ese texto no resolvió. Reintenta con el nombre del edificio tal como aparece en el ' +
        'inventario (el que te devolvió buscar_inmuebles), sin adornos. Solo si tampoco así, escala.',
    };
  }

  if (/varios inmuebles|una sola unidad/i.test(err)) {
    return {
      ...salida,
      mensaje:
        'Ese texto coincide con varios inmuebles. Si el cliente ya te dijo cuál (número de ' +
        'apartamento o código), vuelve a llamar la herramienta agregándolo. Pregúntaselo solo si ' +
        'de verdad no lo sabes.',
    };
  }
  return salida;
}

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
      .select('id,titulo,descripcion,tipo_inmueble,tipo_transaccion,precio,precio_oferta,direccion,ciudad,barrio,habitaciones,banos,unidad,estado')
      .eq('inmobiliaria_id', inmobiliariaId)
      // Incluye empalmes (ocupados que muestra el inquilino): el agente los distingue
      // por estado='empalme' y NO los agenda — comparte el contacto vía compartir_contacto_empalme.
      .in('estado', ['disponible', 'empalme']);

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

      const resultados = (data ?? []).map(conPrecioEfectivo);

      // Si el cliente pidió un TIPO concreto y no hay ninguno, no lo dejamos en
      // un callejón sin salida: se reintenta en la MISMA zona y transacción sin
      // el filtro de tipo, para poder ofrecerle lo que sí existe ahí. Caso real
      // (11/ago): pidió casa en arriendo en Niquía — no hay ninguna (ni en todo
      // Bello), pero sí 8 apartamentos en arriendo en ese mismo barrio. Se
      // relaja SOLO el tipo: la zona, el presupuesto y arriendo/venta son
      // requisitos reales del cliente y cambiarlos sería ofrecerle otra cosa.
      if (resultados.length === 0 && args.tipo_inmueble) {
        const { data: alt } = await consultaInmuebles(args, true);
        const alternativas = (alt ?? []).map(conPrecioEfectivo);
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
        p_texto: limpiarTextoInmueble(args.texto).limpio || args.texto,
        p_fecha_desde: args.fecha_desde ?? undefined,
        p_fecha_hasta: args.fecha_hasta ?? undefined,
        p_tipo_transaccion: args.tipo_transaccion ?? undefined,
      });
      if (error) return registrar('verificar_horarios_disponibles', args, { error: error.message });

      const filas = Array.isArray(data) ? data : [];
      // La RPC devuelve los bloques de HOY aunque la hora ya haya pasado. Se
      // filtran acá los que ya no son ofrecibles para que el agente nunca vea
      // —ni pueda ofrecer— un horario imposible.
      const conHorario = filas.filter((f) => f?.fecha && f?.hora_inicio);
      // Se descarta también cualquier bloque en domingo. Hoy no existe ninguno,
      // pero basta que alguien cree una franja por error para que el agente le
      // ofrezca al cliente un día en el que nadie va a ir a abrir el inmueble.
      const vigentes = conHorario.filter(
        (f) => !bloqueDemasiadoPronto(f.fecha, f.hora_inicio) && !esDomingo(f.fecha)
      );
      const descartados = conHorario.length - vigentes.length;

      // Si TODOS los bloques del inmueble ya pasaron, no es que el inmueble no
      // exista: es que hoy ya no hay margen. Se devuelve como
      // `sin_disponibilidad` para que el agente aplique el puente neutro y
      // ofrezca registrar el horario que el cliente prefiera.
      if (conHorario.length > 0 && vigentes.length === 0) {
        const base = conHorario[0];
        return registrar('verificar_horarios_disponibles', args, [
          {
            ...conDiaSemana(base),
            modo: 'sin_disponibilidad',
            franja_id: null,
            fecha: null,
            hora_inicio: null,
            hora_fin: null,
            mensaje:
              `Los ${descartados} horario(s) que quedaban ya pasaron o empiezan en menos de ${MARGEN_MIN} ` +
              'minutos. NO se los ofrezcas. Pregúntale al cliente qué día y hora le sirve y registra la solicitud.',
          },
        ]);
      }

      const salida = (
        vigentes.length > 0 || conHorario.length === 0
          ? [...vigentes, ...filas.filter((f) => !f?.hora_inicio)]
          : filas
      ).map(conDiaSemana);
      return registrar(
        'verificar_horarios_disponibles',
        args,
        descartados > 0
          ? {
              horarios: salida,
              descartados_por_hora: descartados,
              nota: `Se ocultaron ${descartados} bloque(s) de hoy que ya pasaron o empiezan en menos de ${MARGEN_MIN} minutos. Ofrece SOLO los que ves acá.`,
            }
          : salida
      );
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
      // Un horario que ya pasó no se puede agendar aunque el agente lo tuviera
      // de un turno anterior: entre que lo ofreció y el cliente confirmó pudo
      // pasar media hora. La RPC solo valida "fecha pasada", no la hora.
      if (esDomingo(args.fecha)) {
        return registrar('agendar_cita', args, {
          success: false,
          domingo: true,
          error:
            'Los domingos no se hacen visitas: es el día de descanso de los asesores. NO la agendes ni ' +
            'registres una solicitud de apertura para un domingo. Dile al cliente que ese día no ' +
            'atendemos y ofrécele el sábado o el lunes EN EL MISMO MENSAJE, consultando los horarios ' +
            'reales de esos días.',
        });
      }

      if (bloqueDemasiadoPronto(args.fecha, args.hora_inicio)) {
        return registrar('agendar_cita', args, {
          success: false,
          horario_ya_paso: true,
          error:
            `Ese horario ya pasó o empieza en menos de ${MARGEN_MIN} minutos, así que no se puede agendar. ` +
            'Vuelve a consultar disponibilidad y ofrécele al cliente los horarios que siguen vigentes; ' +
            'si ninguno le sirve, pregúntale qué día y hora prefiere y registra la solicitud de apertura.',
        });
      }

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
        p_texto: limpiarTextoInmueble(args.texto).limpio || args.texto,
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
      const salida = error
        ? { success: false, error: error.message }
        : conPistaDeReintento(conDiaSemana((data ?? {}) as Record<string, unknown>), args.texto);
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
      // Un domingo no es un horario que un asesor pueda "abrir": no se trabaja.
      // Registrar la solicitud solo le hace perder el tiempo al cliente y al
      // asesor, que igual la va a denegar.
      if (esDomingo(args.fecha)) {
        return registrar('solicitar_apertura_de_agenda', args, {
          success: false,
          domingo: true,
          error:
            'Los domingos no se hacen visitas: es el día de descanso de los asesores. NO registres la ' +
            'solicitud — el asesor la va a denegar igual. Dile al cliente que ese día no atendemos y ' +
            'ofrécele el sábado o el lunes EN EL MISMO MENSAJE, con horarios reales.',
        });
      }

      const { data, error } = await supabase.rpc('solicitar_apertura_agenda', {
        p_texto: limpiarTextoInmueble(args.texto).limpio || args.texto,
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
      const salida = error
        ? { success: false, error: error.message }
        : conPistaDeReintento(conDiaSemana((data ?? {}) as Record<string, unknown>), args.texto);
      return registrar('solicitar_apertura_de_agenda', args, salida);
    },
    {
      name: 'solicitar_apertura_de_agenda',
      description:
        '⛔ NO la uses si el cliente está aceptando un horario que TÚ le ofreciste desde ' +
        'verificar_horarios_disponibles: eso es agendar_cita, siempre. Esta herramienta es SOLO para ' +
        'horarios que no existen en la agenda. Si ya tienes franja y el nombre y teléfono del cliente, ' +
        'la respuesta correcta es agendar_cita — usar esta en su lugar deja al cliente sin cita. ' +
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

  // Ruido que descarta el resolver de Postgres (resolver_inmuebles_por_texto).
  // Se replica acá SOLO para el diagnóstico de "existe pero ya no está
  // disponible" — el matching de verdad lo hace la RPC, ver abajo.
  const RUIDO_TOKENS = new Set([
    'del', 'las', 'los', 'una', 'con', 'sin', 'por', 'que',
    'apartamento', 'apto', 'casa', 'local', 'oficina', 'bodega', 'lote',
    'arriendo', 'venta', 'alquiler', 'inmueble', 'propiedad',
  ]);

  const tokensDeTexto = (texto: string): string[] =>
    texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !RUIDO_TOKENS.has(t));

  // Las fotos existen (82 de 84 inmuebles disponibles, ~18 c/u, sincronizadas
  // del ERP y públicas), pero el agente no las veía y por eso decía "no tengo
  // fotos cargadas en el sistema" y hasta inventaba URLs que daban 404
  // (auditoría 12/ago). Va como herramienta APARTE y no dentro de
  // `buscar_inmuebles` a propósito: 18 URLs × 30 resultados serían ~13.000
  // tokens por búsqueda, y el cuello de botella hoy es el límite de 30.000
  // tokens por minuto. Así el costo se paga solo cuando el cliente pide fotos.
  //
  // 26/ago — LA falla: esta era la única tool por texto que NO usaba
  // `resolver_inmuebles_por_texto`; reimplementaba el match con un ilike
  // CONTIGUO sobre titulo/direccion/unidad. La dirección del 1509 es
  // "AV 31 #67 -221 APTO 1509" y su unidad es "Mi Mundo": ninguna columna
  // contiene "Mi Mundo 1509" seguido, así que la consulta devolvía CERO
  // teniendo el inmueble 30 fotos, y el cliente oía "no tengo fotos".
  // 69 de 287 llamadas (24%) fallaron así desde el 17/jul, con un patrón
  // exacto: fallaban TODAS las que traían unidad + número de apto (Villas del
  // Sol 1713 trece veces, Mi Mundo 1509 siete) y funcionaban solo las de
  // unidad pelada — hasta el ejemplo de esta misma descripción, "Mi Mundo
  // 707", devolvía cero. Ahora resuelve por la MISMA RPC que agendar y
  // consultar horarios, así las fotos que se mandan son por construcción las
  // del inmueble del que el agente acaba de dar precio y horarios.
  const obtenerFotos = tool(
    async (args) => {
      const limpio = limpiarTextoInmueble(args.texto).limpio || args.texto;
      const normalizado = limpio.replace(/[.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();

      // Fuente ÚNICA del matching: tokeniza, ignora tildes y exige que TODOS
      // los tokens aparezcan en titulo+direccion+unidad+barrio+ciudad. Solo
      // devuelve inmuebles con estado 'disponible'.
      const { data: resueltos, error } = await supabase.rpc('resolver_inmuebles_por_texto', {
        p_texto: normalizado,
      });
      if (error) return registrar('obtener_fotos', args, { error: error.message });

      const ids: string[] = (Array.isArray(resueltos) ? resueltos : [])
        .map((r: { id?: string }) => r?.id)
        .filter((id: string | undefined): id is string => !!id);

      if (ids.length === 0) {
        // Diagnóstico, NO es el resolver. Como la RPC solo mira disponibles,
        // un cero significa dos cosas muy distintas para el cliente: que no
        // existe, o que existe y ya lo arrendaron. Se repite el AND de tokens
        // acá para escalar con el motivo correcto en vez de con un genérico.
        // Si alguna vez discreparan, manda la RPC: esto solo elige el texto.
        // Sin tokens útiles no hay nada que preguntar: una consulta sin
        // filtros devolvería tres inmuebles cualquiera y le haría creer al
        // agente que el que pidió el cliente está arrendado.
        const tokens = tokensDeTexto(normalizado);
        let consulta = supabase
          .from('inmuebles')
          .select('titulo,unidad,direccion,estado')
          .eq('inmobiliaria_id', inmobiliariaId)
          .neq('estado', 'disponible');
        for (const tok of tokens) {
          const p = patronFlexible(tok);
          consulta = consulta.or(
            `titulo.ilike.%${p}%,direccion.ilike.%${p}%,unidad.ilike.%${p}%,barrio.ilike.%${p}%,ciudad.ilike.%${p}%`
          );
        }
        const { data: fueraDeInventario } = tokens.length > 0
          ? await consulta.limit(3)
          : { data: null };

        if (fueraDeInventario && fueraDeInventario.length > 0) {
          const estados = [...new Set(fueraDeInventario.map((p) => p.estado))].join('/');
          return registrar('obtener_fotos', args, {
            inmueble_no_disponible: true,
            estado: estados,
            direccion: fueraDeInventario[0].direccion,
            mensaje:
              `Ese inmueble existe pero su estado es "${estados}": ya NO está disponible. No le mandes ` +
              'fotos ni le ofrezcas visita. Dile con claridad que ya no está disponible y ofrécele ' +
              'alternativas reales de la misma zona con buscar_inmuebles, en el mismo mensaje.',
          });
        }

        return registrar('obtener_fotos', args, {
          sin_coincidencias: true,
          mensaje:
            'Ese texto no coincide con ningún inmueble del inventario. NO le digas al cliente que "no hay ' +
            'fotos en el sistema". Si no estás seguro de a cuál se refiere, pregúntale el edificio y el ' +
            'número de apartamento; si ya se lo preguntaste, ESCALA.',
        });
      }

      const { data, error: errorInmuebles } = await supabase
        .from('inmuebles')
        .select('titulo,unidad,direccion,precio,precio_oferta,tipo_transaccion,imagenes,arrendasoft_id')
        .eq('inmobiliaria_id', inmobiliariaId)
        .in('id', ids);
      if (errorInmuebles) return registrar('obtener_fotos', args, { error: errorInmuebles.message });

      const props = (data ?? [])
        .map(conPrecioEfectivo)
        .map((p) => ({ ...p, fotosOk: fotosDeInmueble(p.imagenes) }))
        .filter((p) => p.fotosOk.length > 0 && p.arrendasoft_id);

      if (props.length === 0) {
        // El inmueble existe Y está disponible; lo que falta son las fotos.
        // Hoy le pasa a 2 de los 84 disponibles, y es la ÚNICA situación en
        // la que "no tengo fotos" sería literalmente cierto.
        return registrar('obtener_fotos', args, {
          sin_fotos_cargadas: true,
          mensaje:
            'Encontré el inmueble y sí está disponible, pero no tiene fotos cargadas. NO le digas al ' +
            'cliente que "no hay fotos en el sistema": ofrécele que un asesor se las envía y ESCALA.',
        });
      }

      // Un enlace a la galería en vez de las URLs crudas del ERP: el campo de
      // Kommo admite 256 caracteres y cada URL del ERP mide ~99, así que solo
      // cabía una por mensaje. Este enlace mide ~52, cabe con texto, se ve con
      // la marca y muestra TODAS las fotos (~18) en vez de las 4 que cabían.
      // El resolver no sabe de arriendo/venta, y en Mi Mundo conviven 6
      // arriendos con 2 ventas de $280 millones: sin esto, un cliente que
      // pregunta por arriendo puede recibir la galería de un apartamento en
      // venta. Es un filtro sobre el conjunto YA resuelto, no un segundo
      // matcher. Si ninguno es del tipo pedido se devuelven igual, pero
      // diciéndolo, para que el agente no lo presente como lo que no es.
      const pedido = args.tipo_transaccion;
      const delTipo = pedido ? props.filter((p) => p.tipo_transaccion === pedido) : props;
      const ningunoDelTipo = !!pedido && delTipo.length === 0;
      const elegibles = delTipo.length > 0 ? delTipo : props;

      const base = process.env.NEXT_PUBLIC_APP_URL || 'https://cumbres-state-inventory.vercel.app';
      const mostrados = elegibles.slice(0, 3);

      // Un texto de unidad pelada ("Mi Mundo") resuelve a 8 inmuebles y antes
      // se devolvían 3 en silencio, siempre los mismos: si el cliente estaba
      // preguntando por el 1509, recibía las fotos del 1003. Mandarle fotos
      // del apartamento equivocado es peor que no mandarle ninguna, así que
      // la ambigüedad ahora se declara en vez de resolverse a dedo.
      const ambiguo = ids.length > 1;

      return registrar('obtener_fotos', args, {
        coincidencias: ids.length,
        inmuebles: mostrados.map((p) => ({
          titulo: p.titulo,
          unidad: p.unidad,
          direccion: p.direccion,
          precio: p.precio,
          tipo_transaccion: p.tipo_transaccion,
          total_fotos: p.fotosOk.length,
          galeria: `${base}/f/${p.arrendasoft_id}`,
        })),
        mensaje:
          (ningunoDelTipo
            ? `NINGUNO de los que coinciden es de ${pedido}: los de abajo son de otro tipo de ` +
              'transacción. Si se los muestras, dilo explícitamente; no los presentes como ' +
              `${pedido}. `
            : '') +
          (ambiguo
            ? `Ojo: "${args.texto}" coincide con ${ids.length} inmuebles y abajo van ${mostrados.length}. ` +
              'Si el cliente está preguntando por UNO en concreto, NO le mandes estos enlaces: vuelve a ' +
              'llamar esta tool agregando el número de apartamento. Si pidió ver opciones en general, ' +
              'ofrécele máximo 2 de estos enlaces. '
            : '') +
          'Comparte el enlace de `galeria` TAL CUAL — ahí el cliente ve todas las fotos del inmueble. ' +
          'Un enlace por inmueble, nunca más de 2 en el mismo mensaje. PROHIBIDO inventar o modificar la URL.',
      });
    },
    {
      name: 'obtener_fotos',
      description:
        'Devuelve las fotos REALES de un inmueble o unidad, por el mismo texto que usas para consultar ' +
        'horarios (ej. "Montiara", "Mi Mundo 707"). Si el cliente está hablando de UN apartamento ' +
        'concreto, incluye SIEMPRE su número: con el nombre pelado del edificio te devuelve otros de la ' +
        'misma unidad. Úsala SIEMPRE que el cliente pida fotos, imágenes, "cómo se ve", o más detalle ' +
        'visual. NUNCA inventes URLs de fotos ni digas que no hay fotos sin haber llamado esta ' +
        'herramienta primero.',
      schema: z.object({
        texto: z
          .string()
          .describe('Nombre del edificio/unidad y el número de apto, igual que en verificar_horarios_disponibles.'),
        tipo_transaccion: TIPO_TRANSACCION.optional().describe(
          'Pásalo SIEMPRE que sepas si el cliente busca arriendo o venta: en la misma unidad conviven ' +
            'ambos y evita mandarle la galería de un inmueble en venta a quien busca arriendo.'
        ),
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

  // Empalme: inmueble ocupado que muestra el inquilino de salida. No se agenda;
  // se comparte el teléfono del inquilino (solo cuando el lead califica) y se avisa
  // al admin. El número NO viaja en buscar_inmuebles: solo se revela aquí.
  const compartirContactoEmpalme = tool(
    async (args) => {
      const codigo = String(args.codigo ?? '').replace(/\D/g, '');
      if (!codigo) {
        return registrar('compartir_contacto_empalme', args, { error: 'Falta el código del inmueble.' });
      }

      const { data: inm, error } = await supabase
        .from('inmuebles')
        .select('id, titulo, direccion, unidad, estado, empalme_contacto_nombre, empalme_contacto_telefono')
        .eq('inmobiliaria_id', inmobiliariaId)
        .eq('arrendasoft_id', Number(codigo))
        .maybeSingle();

      if (error) return registrar('compartir_contacto_empalme', args, { error: error.message });
      if (!inm) {
        return registrar('compartir_contacto_empalme', args, { error: `No encontré el inmueble con código ${codigo}.` });
      }
      if (inm.estado !== 'empalme') {
        return registrar('compartir_contacto_empalme', args, {
          es_empalme: false,
          mensaje:
            'Este inmueble NO es un empalme: se maneja con visita agendada normal. Usa ' +
            'verificar_horarios_disponibles / agendar_cita y NO compartas ningún contacto.',
        });
      }
      if (!inm.empalme_contacto_telefono) {
        return registrar('compartir_contacto_empalme', args, {
          error:
            'Es un empalme pero no hay teléfono del inquilino cargado todavía. Dile al cliente que un ' +
            'asesor le confirma el contacto y ESCALA.',
        });
      }

      // Aviso al admin (cola sin dueño, como las tareas de solicitud/cita agendada).
      const clienteNombre = String(args.cliente_nombre ?? '').trim();
      const etiqueta = inm.unidad || inm.titulo || inm.direccion || `#${codigo}`;
      const { error: errorTarea } = await supabase.from('tareas').insert({
        inmobiliaria_id: inmobiliariaId,
        usuario_id: null,
        entidad_tipo: 'inmueble',
        entidad_id: inm.id,
        evento_origen: 'empalme_contacto_compartido',
        evento_titulo: `Empalme — ${etiqueta}`,
        titulo: `Se compartió el contacto del inquilino (empalme, cód ${codigo}) con ${clienteNombre || 'un interesado'}`,
        estado: 'pendiente',
      });
      if (errorTarea) {
        console.warn('[AgenteComercial] No se pudo crear la tarea de empalme:', errorTarea.message);
      }

      return registrar('compartir_contacto_empalme', args, {
        es_empalme: true,
        contacto_nombre: inm.empalme_contacto_nombre,
        contacto_telefono: inm.empalme_contacto_telefono,
        instruccion:
          'Comparte ESTE teléfono con el cliente y explícale que el inmueble lo muestra directamente el ' +
          'inquilino de salida (empalme), así que coordine la visita con esa persona por ese número. NO ' +
          'agendes cita ni ofrezcas horarios. Un asesor ya quedó avisado.',
      });
    },
    {
      name: 'compartir_contacto_empalme',
      description:
        'SOLO para inmuebles en EMPALME (verás estado="empalme" en buscar_inmuebles/buscar_inmueble_por_codigo): ' +
        'no se agenda visita porque lo muestra el inquilino de salida directamente. Llama esta tool ÚNICAMENTE ' +
        'cuando el cliente ya dio su nombre y confirmó interés real en visitar ese inmueble puntual. Devuelve el ' +
        'teléfono del inquilino para que se lo compartas y avisa a un asesor. NUNCA la uses para inmuebles ' +
        'disponibles normales (esos se agendan con agendar_cita).',
      schema: z.object({
        codigo: z.union([z.string(), z.number()]).describe('Código del inmueble (el que aparece como código / arrendasoft_id).'),
        cliente_nombre: z.string().optional().describe('Nombre del cliente interesado, para el aviso al asesor.'),
      }),
    }
  );

  return [
    buscarInmuebles,
    compartirContactoEmpalme,
    buscarInmueblePorCodigo,
    verificarHorariosDisponibles,
    agendarCita,
    solicitarAperturaDeAgenda,
    cancelarCita,
    obtenerFotos,
    googleMapsLugares,
  ];
}
