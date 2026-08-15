import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { createAdminClient } from '@/lib/supabase/admin';
import { cargarPromptSistema, contextoVariable } from '@/lib/agente-comercial/prompt';
import { correrAgenteComercial, extraerCitaAgendada } from '@/lib/agente-comercial/graph';
import { calcularCostoUSD } from '@/lib/agente-comercial/costos';

// n8n sigue activando este agente (recibe el mensaje de Kommo, llama acá,
// escribe la respuesta de vuelta a Kommo) — solo el razonamiento se mudó
// aquí. Ver plan de migración: /Users/samug/.claude/plans/compiled-doodling-pancake.md
//
// Contrato de respuesta pensado para que, en la Fase 5, "Prepare Update
// Payload" en n8n solo tenga que repuntar 3 referencias (antes leían del
// nodo "Agente Cumbres AI"/"Verificador de Respuesta", ahora de este nodo
// HTTP): $json.output (crudo, con [ESCALAR] intacto si aplica — así
// "Escalar?"/"Notificar Escalamiento" siguen funcionando sin más cambios),
// $json.response.part_N, $json.etapa. El resto del workflow (partición por
// bytes, campo "msj n8n" de Kommo, mapa de etapa→status_id) NO se toca.
export const maxDuration = 300;

// Igual que "Postgres Chat Memory" en n8n (contextWindowLength: 15).
const MAX_MENSAJES_HISTORIAL = 15;

interface CuerpoPeticion {
  mensaje?: string;
  telefono?: string;
  kommo_lead_id?: string | number;
  kommo_contact_id?: string | number;
  cliente_nombre?: string;
  inmobiliaria_id?: string;
}

function fechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
}

// Los turnos VIEJOS solo necesitan su fecha como ancla para que "mañana" o
// "el martes" sigan significando lo mismo que cuando se escribieron. Antes
// llevaban el preámbulo completo (~60 tokens cada uno): con 15 mensajes de
// historial eran ~400 tokens por llamada, y como el bucle ReAct hace varias
// llamadas por turno, se iban ~1.200 tokens del presupuesto por minuto en
// repetir 15 veces la misma instrucción. La instrucción va una sola vez, en
// el mensaje nuevo (envolverConFecha).
function anclarFecha(mensaje: string, fecha: Date): string {
  return `[${fechaCorta(fecha)}] ${mensaje}`;
}

// Mismo envoltorio que el campo "text" del nodo "Agente Cumbres AI" en n8n:
// "Fecha de hoy: ... \n\nMensaje del usuario: ...". Solo para el mensaje nuevo.
function envolverConFecha(mensaje: string, fecha: Date): string {
  const fechaISO = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
  const dia = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long' }).format(fecha);
  const anio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric' }).format(fecha);
  // La HORA importa tanto como la fecha: sin ella el agente ofrecía visitas
  // que ya habían pasado (12/ago 16:37 → "aún tienes tiempo, 3:00 pm o
  // 3:30 pm", y el cliente respondió "Hoy ya son las 4y38").
  const hora = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(fecha);
  return (
    `Fecha y hora ahora: ${fechaISO} (${dia}) ${hora}, zona America/Bogota. El año actual es ${anio}. ` +
    'Usa esto SOLO para interpretar "hoy", "mañana", "esta tarde" y los días de la semana; las fechas para ' +
    'agendar cópialas del resultado de disponibilidad. ⚠️ No ofrezcas ni des por válido un horario de HOY que ' +
    'ya pasó o que empiece dentro de menos de 30 minutos: el cliente necesita tiempo para llegar. Las ' +
    'herramientas ya ocultan esos bloques, así que ofrece únicamente los que te devuelvan.' +
    `\n\nMensaje del usuario: ${mensaje}`
  );
}

export async function POST(request: Request) {
  const token = request.headers.get('x-webhook-token');
  if (!token || token !== process.env.N8N_AGENTE_COMERCIAL_TOKEN) {
    return Response.json({ estado: 'error', error: 'No autorizado' }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ estado: 'error', error: 'Falta configurar OPENAI_API_KEY' }, { status: 500 });
  }

  const cuerpo: CuerpoPeticion | null = await request.json().catch(() => null);
  const mensaje = cuerpo?.mensaje?.trim();
  const telefono = cuerpo?.telefono?.trim();
  if (!cuerpo || !mensaje || !telefono) {
    return Response.json({ estado: 'error', error: 'Faltan mensaje y/o telefono' }, { status: 400 });
  }

  const inmobiliariaId = cuerpo.inmobiliaria_id || process.env.CUMBRES_INMOBILIARIA_ID;
  if (!inmobiliariaId) {
    return Response.json(
      { estado: 'error', error: 'No hay inmobiliaria_id (ni en el body ni en CUMBRES_INMOBILIARIA_ID)' },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  // Kill switch — sin fila de config = activo (la pausa es una acción
  // explícita del admin desde /agentes). Chequeo temprano: evita gastar
  // tokens del LLM si ya se sabe que está pausado; las RPCs de las tools
  // igual re-chequean del lado de Postgres como segunda línea de defensa.
  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'comercial_whatsapp')
    .maybeSingle();

  if (config && !config.activo) {
    const texto = 'En este momento un asesor humano va a continuar la conversación contigo.';
    return Response.json({ estado: 'pausado', output: texto, response: { part_1: texto }, etapa: 'CONTACTO INICIAL', escalado: false });
  }

  let promptSistema: string;
  try {
    promptSistema = await cargarPromptSistema(inmobiliariaId);
  } catch (error) {
    console.error('[AgenteComercial] Error cargando el prompt:', error);
    return Response.json(
      {
        estado: 'error',
        error: error instanceof Error ? error.message : 'No se pudo cargar el prompt del agente.',
      },
      { status: 500 }
    );
  }

  // ---- Resolver o crear la conversación (una fila por teléfono) ----
  const { data: conversacionExistente } = await supabase
    .from('agente_comercial_conversaciones')
    .select('id, cliente_nombre')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('telefono', telefono)
    .maybeSingle();

  let conversacionId: string;
  const clienteNombre = cuerpo.cliente_nombre?.trim() || conversacionExistente?.cliente_nombre || null;

  if (conversacionExistente) {
    conversacionId = conversacionExistente.id;
    await supabase
      .from('agente_comercial_conversaciones')
      .update({
        kommo_lead_id: cuerpo.kommo_lead_id != null ? String(cuerpo.kommo_lead_id) : undefined,
        kommo_contact_id: cuerpo.kommo_contact_id != null ? String(cuerpo.kommo_contact_id) : undefined,
        cliente_nombre: clienteNombre,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversacionId);
  } else {
    const { data: nueva, error: errorNueva } = await supabase
      .from('agente_comercial_conversaciones')
      .insert({
        inmobiliaria_id: inmobiliariaId,
        telefono,
        kommo_lead_id: cuerpo.kommo_lead_id != null ? String(cuerpo.kommo_lead_id) : null,
        kommo_contact_id: cuerpo.kommo_contact_id != null ? String(cuerpo.kommo_contact_id) : null,
        cliente_nombre: clienteNombre,
      })
      .select('id')
      .single();
    if (errorNueva || !nueva) {
      console.error('[AgenteComercial] Error creando conversación:', errorNueva?.message);
      return Response.json({ estado: 'error', error: 'No se pudo iniciar la conversación.' }, { status: 500 });
    }
    conversacionId = nueva.id;
  }

  // ---- Historial previo (últimos N mensajes) ----
  const { data: mensajesPrevios } = await supabase
    .from('agente_comercial_mensajes')
    .select('rol, contenido, created_at')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(MAX_MENSAJES_HISTORIAL);

  const historial: BaseMessage[] = (mensajesPrevios ?? [])
    .slice()
    .reverse()
    .map((m) =>
      m.rol === 'usuario'
        ? new HumanMessage(anclarFecha(m.contenido, new Date(m.created_at)))
        : new AIMessage(m.contenido)
    );
  const ahora = new Date();
  historial.push(new HumanMessage(envolverConFecha(mensaje, ahora)));

  await supabase.from('agente_comercial_mensajes').insert({
    conversacion_id: conversacionId,
    rol: 'usuario',
    contenido: mensaje,
  });

  const promptCompleto = promptSistema + contextoVariable({ telefono, clienteNombre });

  let resultado;
  try {
    resultado = await correrAgenteComercial({
      supabase,
      inmobiliariaId,
      promptSistema: promptCompleto,
      historial,
      telefono,
    });
  } catch (error) {
    console.error('[AgenteComercial] Error corriendo el agente:', error);
    const mensajeError = error instanceof Error ? error.message : String(error);
    const textoCliente = mensajeError.includes('recursion')
      ? 'Necesito confirmar unos datos más — un asesor va a continuar la conversación contigo.'
      : 'Tuvimos un problema técnico procesando tu mensaje. Un asesor va a continuar la conversación contigo.';
    await supabase.from('agente_comercial_mensajes').insert({
      conversacion_id: conversacionId,
      rol: 'agente',
      contenido: textoCliente,
    });
    return Response.json({
      estado: 'error',
      error: mensajeError,
      output: textoCliente,
      response: { part_1: textoCliente },
      etapa: 'CONTACTO INICIAL',
      escalado: false,
      conversacion_id: conversacionId,
    });
  }

  // El historial reconstruye turnos futuros desde acá: se guarda el borrador
  // CRUDO (con [ESCALAR] si aplica), igual que hacía la memoria de Postgres
  // de n8n (atada directo al nodo del agente, antes del formateo/limpieza).
  await supabase.from('agente_comercial_mensajes').insert({
    conversacion_id: conversacionId,
    rol: 'agente',
    contenido: resultado.output,
    herramientas_usadas: resultado.herramientasUsadas.length > 0 ? resultado.herramientasUsadas : null,
  });

  // Tarea de confirmación de la cita. La confirmación de citas ya existe
  // (confirmarCitas → workflow n8n → Kommo, con insignia en /citas), pero
  // nada avisaba que hubiera una cita nueva esperando: al 11/ago había citas
  // del agente sin confirmar desde hacía días. La tarea aparece en /tareas,
  // donde el equipo ya trabaja, y se completa sola al confirmar la cita.
  const cita = extraerCitaAgendada(resultado.herramientasUsadas);
  if (cita) {
    const cuando = `${cita.fecha} ${cita.hora_inicio}`;
    const { error: errorTarea } = await supabase.from('tareas').insert({
      inmobiliaria_id: inmobiliariaId,
      usuario_id: null, // sin dueño: la ven los admins, igual que las de solicitud_apertura
      entidad_tipo: 'general',
      entidad_id: cita.cita_id,
      evento_origen: 'cita_agendada',
      evento_titulo: `Cita agendada por el agente — ${cita.inmueble}`,
      titulo: `Confirmar cita: ${cita.cliente_nombre} · ${cuando}${cita.asesor ? ` · ${cita.asesor}` : ''}`,
      estado: 'pendiente',
    });
    if (errorTarea) console.warn('[AgenteComercial] No se pudo crear la tarea de la cita:', errorTarea.message);
  }

  if (resultado.uso.length > 0) {
    const filasUso = resultado.uso.map((u) => ({
      inmobiliaria_id: inmobiliariaId,
      conversacion_id: conversacionId,
      modelo: u.modelo,
      tokens_entrada: u.entrada,
      tokens_salida: u.salida,
      tokens_cache: u.cache,
      etapa: resultado.etapa,
      escalado: resultado.escalado,
      costo_usd: calcularCostoUSD(u.modelo, { entrada: u.entrada, salida: u.salida, cache: u.cache }),
    }));
    const { error: errorUso } = await supabase.from('agente_comercial_uso').insert(filasUso);
    if (errorUso) console.warn('[AgenteComercial] No se pudo registrar el uso:', errorUso.message);
  }

  return Response.json({
    estado: 'ok',
    output: resultado.output,
    response: resultado.response,
    etapa: resultado.etapa,
    escalado: resultado.escalado,
    prioridad: resultado.prioridad,
    // lead_caliente = quiso visitar y no había agenda. n8n lo usa para avisarle
    // al asesor SIN mover la etapa de Kommo (moverla dejaría al agente mudo
    // justo cuando todavía debe recibir el día/hora que prefiere el cliente).
    lead_caliente: resultado.leadCaliente,
    cita_agendada: cita !== null, // n8n lo usa para mandar el correo de aviso
    cita,
    contexto: resultado.contexto, // resumen para el correo del asesor — NUNCA para el cliente
    respuesta: resultado.respuesta, // conveniencia: partes unidas (pruebas directas / lectura humana)
    conversacion_id: conversacionId,
    metadata: {
      herramientas_usadas: resultado.herramientasUsadas.map((h) => h.nombre),
    },
  });
}
