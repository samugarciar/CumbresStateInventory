import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { createAdminClient } from '@/lib/supabase/admin';
import { construirHistorial } from '@/lib/agente-comercial/historial';
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
  /**
   * Solo por el canal propio: el webhook ya guardó este mensaje, con su
   * wamid, antes de llamar aquí. n8n no lo manda, y por ahí todo sigue
   * igual que siempre.
   */
  wa_message_id?: string | null;
}

// Los extractos bancarios que pide Fianzacrédito son los del ÚLTIMO TRIMESTRE
// CALENDARIO CERRADO, no los de los últimos tres meses corridos: al 31/ago el
// trimestre vigente es abril-mayo-junio, y el 1/oct pasa a ser julio-agosto-
// septiembre. Se calcula acá y se le entrega resuelto al modelo, por la misma
// razón que la fecha y la hora: todo lo que se le pidió deducir de un
// calendario terminó fallando. Escribirlo fijo en el prompt lo dejaría vencido
// el primer día del trimestre siguiente, sin que nadie se entere.
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function trimestreDeExtractos(fecha: Date): string {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(fecha);
  const [anio, mes] = iso.split('-').map(Number);
  // Trimestre calendario en curso (0-3) → el cerrado es el anterior.
  const enCurso = Math.floor((mes - 1) / 3);
  const cerrado = (enCurso + 3) % 4;
  const anioCerrado = enCurso === 0 ? anio - 1 : anio;
  const inicio = cerrado * 3;
  return `${MESES[inicio]}, ${MESES[inicio + 1]} y ${MESES[inicio + 2]} de ${anioCerrado}`;
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
    `\nEl "último trimestre" de los extractos bancarios es HOY: ${trimestreDeExtractos(fecha)}. ` +
    'Si te preguntan cuáles meses, di exactamente esos tres — no los calcules ni los cambies.' +
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

  // Segundo interruptor: por LEAD, no por inmobiliaria. Lo vive el CRM
  // (crm.contactos.bot_activo) y se consulta con una función pensada como
  // contrato del agente: firma estable, SECURITY DEFINER, documentada.
  //
  // La regla de negocio es de Samuel: quien lidera la comunicación con el
  // cliente es el asesor. El bot sigue siendo opt-out —contesta por
  // defecto— pero se calla en cuanto alguien toma la conversación, y se
  // calla solo cuando el lead escala, que es literalmente pedir hablar
  // con una persona.
  //
  // FALLA HACIA "SÍ RESPONDE", A PROPÓSITO. Si la consulta se cae, el
  // cliente recibe respuesta. El daño de que el bot hable de más está
  // acotado —un asesor lo corrige— y el de dejar mudo el canal entero por
  // un error del CRM no lo está. Es la misma dirección que el patrón
  // a prueba de fallos de los triggers de proyección.
  let botSilenciado = false;
  try {
    const { data: puede, error: errorBot } = await supabase
      .schema('crm')
      .rpc('bot_puede_responder', {
        p_inmobiliaria_id: inmobiliariaId,
        p_telefono: telefono,
      });
    if (!errorBot && puede === false) botSilenciado = true;
  } catch (error) {
    console.error('[AgenteComercial] No se pudo consultar el interruptor del CRM:', error);
  }

  // El `return` del silencio NO va aquí, aunque la pregunta sí. Primero se
  // guarda lo que escribió el cliente: cortando antes del upsert, los
  // mensajes que llegaban durante el silencio no quedaban en ninguna parte
  // —ni en agente_comercial_mensajes, ni por tanto en el CRM, que los lee de
  // ahí—, así que el CRM quedaba ciego justo en la ventana donde afirma que
  // un humano atiende, y crm.bot_atendido_desde() no podía ver nada. El
  // corte está más abajo, después de guardar el mensaje.

  // ---- Resolver o crear la conversación (una fila por teléfono) ----
  const { data: conversacionExistente } = await supabase
    .from('agente_comercial_conversaciones')
    .select('id, cliente_nombre, silencio_avisado_at')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('telefono', telefono)
    .maybeSingle();

  let conversacionId: string;
  const clienteNombre = cuerpo.cliente_nombre?.trim() || conversacionExistente?.cliente_nombre || null;
  // Se lee ANTES del UPDATE de abajo, que es quien lo borra cuando el bot
  // recupera la voz.
  const silencioAvisadoAt: string | null = conversacionExistente?.silencio_avisado_at ?? null;

  if (conversacionExistente) {
    conversacionId = conversacionExistente.id;
    await supabase
      .from('agente_comercial_conversaciones')
      .update({
        kommo_lead_id: cuerpo.kommo_lead_id != null ? String(cuerpo.kommo_lead_id) : undefined,
        kommo_contact_id: cuerpo.kommo_contact_id != null ? String(cuerpo.kommo_contact_id) : undefined,
        cliente_nombre: clienteNombre,
        // El sello del aviso se borra en cuanto el bot puede hablar otra vez,
        // aprovechando el UPDATE que ya corría en cada mensaje: ninguna
        // escritura de más. Así el próximo episodio de silencio vuelve a
        // avisar una vez — el silencio por escalamiento caduca y puede
        // repetirse semanas después, y ahí el cliente sí merece el aviso.
        silencio_avisado_at: !botSilenciado && silencioAvisadoAt ? null : undefined,
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
  // Por el canal propio el mensaje nuevo YA está guardado: lo guardó el
  // webhook, con su wamid, antes de llamar aquí — es lo que hace idempotente
  // un reintento de Meta. Se pide uno de más y se aparta ese, para que el
  // modelo no lo lea dos veces: una en el historial y otra como mensaje nuevo.
  const waMessageId = cuerpo.wa_message_id?.trim() || undefined;
  const { data: mensajesPrevios } = await supabase
    .from('agente_comercial_mensajes')
    .select('rol, contenido, created_at, wa_message_id')
    .eq('conversacion_id', conversacionId)
    .order('created_at', { ascending: false })
    .limit(MAX_MENSAJES_HISTORIAL + (waMessageId ? 1 : 0));

  const historial: BaseMessage[] = construirHistorial(mensajesPrevios ?? [], {
    max: MAX_MENSAJES_HISTORIAL,
    excluirWaMessageId: waMessageId,
  });
  const ahora = new Date();
  historial.push(new HumanMessage(envolverConFecha(mensaje, ahora)));

  // Por n8n nadie más lo guarda. Por el canal propio ya lo guardó el webhook,
  // y guardarlo otra vez —sin wamid, así que el índice único no lo frena—
  // lo dejaba duplicado en la conversación del cliente.
  if (!waMessageId) {
    await supabase.from('agente_comercial_mensajes').insert({
      conversacion_id: conversacionId,
      rol: 'usuario',
      contenido: mensaje,
    });
  }

  // ---- El bot está callado para este lead ----
  // Lo que dijo el cliente ya quedó guardado arriba; aquí se decide solo qué
  // se le contesta.
  //
  // La primera vez se le dice que un asesor atiende. De la segunda en
  // adelante, NADA: `response` vacío. Devolver la frase en cada mensaje era
  // el síntoma que se vino a arreglar — el cliente escribía cinco veces y
  // recibía cinco veces la misma línea robótica mientras la asesora le
  // contestaba de verdad por Kommo.
  //
  // Que `response` vacío signifique "no digas nada" está verificado contra el
  // workflow real (3bihDRvaLKEDcQdw, nodo "Prepare Update Payload"): salta
  // las partes vacías y termina en `return parts.map(...)`, así que con cero
  // partes devuelve cero items, "Loop Messages" no itera y "Actualizar Campo
  // y Mover a Pivot" no corre. No hay que tocar n8n.
  //
  // Y eso arregla algo que no se buscaba: ese nodo empaqueta `status_id`
  // junto a cada parte, así que hasta hoy CADA mensaje del silencio devolvía
  // el lead a "Contacto inicial" en Kommo, deshaciendo la etapa que había
  // puesto la asesora. Sin partes no se mueve la etapa. (El primer mensaje
  // del episodio sí la sigue moviendo: quitarlo del todo pide editar ese
  // nodo de n8n.)
  //
  // Por el canal propio no hace falta nada: el webhook pregunta él mismo
  // antes de llamar aquí, y entregarRespuesta() salta las partes vacías.
  //
  // El resto del contrato se mantiene igual que lo devolvía la pausa global
  // (estado 'pausado', etapa, escalado): romperlo dejaría sin canal a
  // clientes reales.
  if (botSilenciado) {
    const yaAvisado = silencioAvisadoAt !== null;
    const texto = yaAvisado ? '' : 'Un asesor está atendiendo personalmente esta conversación.';
    if (!yaAvisado) {
      const { error: errorSello } = await supabase
        .from('agente_comercial_conversaciones')
        .update({ silencio_avisado_at: new Date().toISOString() })
        .eq('id', conversacionId);
      // Si el sello no se pudo poner se avisa igual: repetir la frase es
      // menos malo que dejar al cliente sin saber que ya va una persona.
      if (errorSello) {
        console.warn('[AgenteComercial] No se pudo sellar el aviso de silencio:', errorSello.message);
      }
    }
    return Response.json({
      estado: 'pausado',
      output: texto,
      response: texto ? { part_1: texto } : {},
      etapa: 'CONTACTO INICIAL',
      escalado: false,
      conversacion_id: conversacionId,
    });
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
    // El lead de Kommo de ESTA conversación queda en la cita, y la
    // confirmación lo usa directo. Buscar al cliente por teléfono falla con
    // quienes escriben con usuario (@): llegan a Kommo sin número, n8n no los
    // encontraba y creaba un lead nuevo sin el chat del cliente, así que la
    // cita nunca se confirmaba en el verdadero (34 % de las citas, medido el
    // 2 oct).
    if (cuerpo.kommo_lead_id != null) {
      const { error: errorLead } = await supabase
        .from('citas')
        .update({
          kommo_lead_id: String(cuerpo.kommo_lead_id),
          kommo_contact_id: cuerpo.kommo_contact_id != null ? String(cuerpo.kommo_contact_id) : null,
        })
        .eq('id', cita.cita_id);
      if (errorLead) {
        console.warn('[AgenteComercial] No se pudo guardar el lead de Kommo en la cita:', errorLead.message);
      }
    }

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
