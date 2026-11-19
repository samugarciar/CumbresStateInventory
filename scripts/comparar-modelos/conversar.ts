// Conversaciones COMPLETAS contra el agente comercial: un cliente simulado
// (otro modelo, con una persona y un objetivo) le escribe turno a turno hasta
// lograr su objetivo, que el bot escale o se acaben los turnos. Prueba lo que
// un turno suelto no prueba: que el bot llegue a agendar, que pida el
// teléfono, que no repita, que escale cuando toca.
//
// Las lecturas van a la base real (inventario y agenda de hoy); las
// escrituras son simuladas (ver entorno.ts).
//
//   AGENTE_COMERCIAL_MODELO=gpt-6-luna AGENTE_COMERCIAL_RAZONAMIENTO=none \
//     node --import ./registrar.mjs conversar.ts <etiqueta> [repeticiones] [escenario...]
// → conv-<etiqueta>.json en SALIDA. Opcional: PROMPT_ARCHIVO, CLIENTE_MODELO.
//
// Al escalar, la conversación termina: en producción el bot se calla
// (relevo / silencio) y sigue una persona.
import { AQUI, INMO, supabaseSimulado, envolverConFecha } from './entorno';
import fs from 'node:fs';
import path from 'node:path';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { construirHistorial, type MensajeGuardado } from '../../lib/agente-comercial/historial';
import { cargarPromptSistema, contextoVariable } from '../../lib/agente-comercial/prompt';
import { correrAgenteComercial } from '../../lib/agente-comercial/graph';
import { calcularCostoUSD, opcionesDeModelo, MODELO_PRINCIPAL } from '../../lib/agente-comercial/costos';

interface Escenario {
  id: string;
  telefono: string;
  nombre: string | null; // nombre conocido por el CRM (contextoVariable)
  persona: string; // instrucciones para el cliente simulado
  primerMensaje: string;
  esperado: string; // qué debe pasar, para quien califique
}

// Teléfonos ficticios (300 000 000X): las escrituras son simuladas y nada se envía.
const TEL = '+573000000001';

export const ESCENARIOS: Escenario[] = [
  {
    id: 'codigo-agenda',
    telefono: TEL,
    nombre: null,
    persona:
      'Te llamas Laura Gómez. Viste el aviso del código 2026198 y quieres visitarlo. Acepta el PRIMER horario que te ' +
      'ofrezcan. Da tu nombre completo y tu teléfono (3000000001) solo cuando te los pidan.',
    primerMensaje: 'Hola, me interesa el código 2026198',
    esperado:
      'Busca el código, ofrece horarios reales en el mismo turno, pide nombre y teléfono, llama agendar_cita y dice ' +
      'que la visita quedó REGISTRADA (no confirmada), nombrando la unidad sin número de apto, y que un asesor ' +
      'confirmará por este chat. Escala tras agendar.',
  },
  {
    id: 'codigo-arrendado',
    telefono: TEL,
    nombre: 'Andrés',
    persona:
      'Te llamas Andrés. Preguntas por el código 2026243. Si ya no está, quieres algo parecido en Bello, de 2 o 3 ' +
      'habitaciones, hasta 2.000.000. Cuando te muestren opciones, pide fotos de una de ellas. No quieres agendar todavía.',
    primerMensaje: 'Buenas, el código 2026243 todavía está?',
    esperado:
      'Dice que ese inmueble ya no está disponible, busca similares en Bello dentro del presupuesto, presenta opciones ' +
      'reales, manda enlaces de fotos de obtener_fotos. NO escala.',
  },
  {
    id: 'busqueda-zona',
    telefono: TEL,
    nombre: null,
    persona:
      'Te llamas Camilo Restrepo, teléfono 3000000002. Buscas apartamento en arriendo en Niquía, 3 habitaciones, ' +
      'hasta 1.700.000. Cuando te muestren opciones, quieres visitar el sábado en la mañana. Si no hay sábado, acepta ' +
      'el horario más cercano que te ofrezcan.',
    primerMensaje: 'Hola, busco apto en arriendo en Niquía de 3 habitaciones, hasta 1.700.000',
    esperado:
      'Busca con esos filtros, agrupa por unidad, ofrece horarios reales y agenda con nombre y teléfono; visita ' +
      'registrada, no confirmada.',
  },
  {
    id: 'horario-inexistente',
    telefono: TEL,
    nombre: null,
    persona:
      'Te llamas Paola Ríos, teléfono 3000000003. Te interesa el código 2026249. Primero pides ir el DOMINGO a las 4 ' +
      'pm. Si te dicen que no, pides un día entre semana a las 6:30 pm. Insiste en esa hora: es la única que puedes.',
    primerMensaje: 'Hola, quiero ver el código 2026249, puedo el domingo a las 4pm?',
    esperado:
      'Explica que los domingos no hay visitas. Para las 6:30 pm entre semana (si no está en las franjas) NO dice que ' +
      'no hay: ofrece registrar una solicitud para que un asesor abra ese horario, pide nombre y teléfono, llama ' +
      'solicitar_apertura_de_agenda y ESCALA. Nunca registra una solicitud para domingo.',
  },
  {
    id: 'requisitos-comision',
    telefono: TEL,
    nombre: 'Marta',
    persona:
      'Te llamas Marta. Preguntas qué requisitos piden para arrendar. Luego preguntas cuáles meses de extractos ' +
      'exactamente. Luego preguntas cuánto cobran de comisión y cuánto vale el estudio.',
    primerMensaje: 'Buenas tardes, qué requisitos piden para arrendar?',
    esperado:
      'Explica los requisitos (tomador y codeudor que ganen el doble, extractos del último trimestre, cédula, ' +
      'formulario, paz y salvo). Los meses deben ser julio, agosto y septiembre de 2026. Comisión y estudio: no los ' +
      'inventa y ESCALA.',
  },
  {
    id: 'negociacion',
    telefono: TEL,
    nombre: 'Jorge',
    persona:
      'Te llamas Jorge. Te interesa el código 2024213 pero te parece caro: quieres que te lo dejen en 1.500.000. ' +
      'Insiste en negociar el precio.',
    primerMensaje: 'Me interesa el código 2024213 pero me lo dejan en 1.500.000?',
    esperado: 'No negocia ni promete descuentos; ESCALA a un asesor por ser negociación de precio.',
  },
  {
    id: 'queja',
    telefono: TEL,
    nombre: 'Sandra',
    persona:
      'Te llamas Sandra y estás molesta: ayer fuiste a una visita en Vidanta a las 4:30 pm y nadie llegó. Quieres que ' +
      'alguien te responda por eso.',
    primerMensaje: 'Muy mal servicio, ayer fui a la visita en Vidanta y nadie llegó!!',
    esperado: 'Responde con empatía, sin excusas inventadas, y ESCALA por ser una queja.',
  },
  {
    id: 'empalme',
    telefono: TEL,
    nombre: null,
    persona:
      'Te llamas Diana Mejía. Buscas algo económico en Bello de 3 habitaciones, alrededor de 1.400.000. Si te ofrecen ' +
      'uno en Mirasol, te interesa visitarlo y das tu nombre cuando te lo pidan.',
    primerMensaje: 'Hola, tienen algo en Bello de 3 habitaciones por ahí de 1.400.000?',
    esperado:
      'Ofrece el de Mirasol y explica que es un empalme (lo muestra el inquilino de salida). Cuando la clienta da su ' +
      'nombre y confirma interés, llama compartir_contacto_empalme y comparte ESE teléfono. No agenda cita ni ofrece ' +
      'horarios para el empalme.',
  },
  {
    id: 'mascotas-estrato',
    telefono: TEL,
    nombre: 'Felipe',
    persona:
      'Te llamas Felipe. Te interesa el código 2026254. Preguntas si aceptan mascotas (tienes un perro grande) y qué ' +
      'estrato es. Necesitas la respuesta antes de visitar.',
    primerMensaje: 'Hola, el código 2026254 acepta mascotas? tengo un perro grande. Y qué estrato es?',
    esperado:
      'NO especula sobre mascotas ni estrato (solo lo que diga la descripción); dice que lo confirma con un asesor y ' +
      'ESCALA.',
  },
  {
    id: 'sin-telefono',
    telefono: 'CO.0000PRUEBA0000000001',
    nombre: null,
    persona:
      'Te llamas Natalia Ochoa. Quieres visitar el código 2026210. Aceptas el primer horario. Das tu nombre cuando te ' +
      'lo pidan. Tu teléfono es 3000000004, pero SOLO lo das si te lo piden explícitamente.',
    primerMensaje: 'Hola quiero visitar el código 2026210',
    esperado:
      'El cliente escribe con «@», sin número: el bot debe PEDIR el teléfono antes de agendar y agendar con ' +
      '3000000004. Nunca usa el identificador CO.… como teléfono.',
  },
  {
    id: 'venta',
    telefono: TEL,
    nombre: null,
    persona:
      'Te llamas Ricardo Peña, teléfono 3000000005. Quieres COMPRAR un apartamento en Bello, presupuesto hasta ' +
      '300.000.000. Pides ver opciones y luego quieres visitar una.',
    primerMensaje: 'Buenas, quiero comprar apartamento en Bello, tengo hasta 300 millones',
    esperado:
      'Busca inmuebles en VENTA (no arriendo) dentro del presupuesto, los presenta con precio de venta y ofrece visita ' +
      'con horarios reales o solicitud de apertura.',
  },
  {
    id: 'despedida',
    telefono: TEL,
    nombre: 'Luisa',
    persona:
      'Te llamas Luisa. Preguntas por el código 2026249 y el precio. Después dices que lo vas a pensar y que gracias. ' +
      'Si te ofrecen algo más, dices que no, gracias, y te despides.',
    primerMensaje: 'Hola cuánto vale el código 2026249?',
    esperado: 'Da precio y datos reales, ofrece visita una vez, y ante la despedida se despide cordial SIN escalar.',
  },
];

const CLIENTE_MODELO = process.env.CLIENTE_MODELO || 'gpt-6-luna';
const MAX_TURNOS = 7;

function promptCliente(e: Escenario): string {
  return (
    'Eres un cliente que escribe por WhatsApp a una inmobiliaria de Medellín (Colombia). ' +
    e.persona +
    '\nEscribe como una persona real por WhatsApp: mensajes cortos, español colombiano, sin listas ni formalidades. ' +
    'Responde SOLO con tu siguiente mensaje. Si ya lograste lo que querías, te despediste, o te dijeron que un ' +
    'asesor te contacta y no tienes nada más que decir, responde exactamente [FIN].'
  );
}

interface Turno {
  cliente: string;
  borrador: string; // con [ESCALAR] si aplica
  partes: string[]; // lo que recibe el cliente
  herramientas: { nombre: string; entrada: unknown; salida: unknown }[];
  etapa: string;
  escalado: boolean;
  segundos: number;
  costo: number;
}

interface Conversacion {
  escenario: string;
  repeticion: number;
  esperado: string;
  turnos: Turno[];
  fin: 'objetivo' | 'escalo' | 'max_turnos' | 'error';
  error?: string;
}

async function conversar(e: Escenario, repeticion: number, promptSistema: string): Promise<Conversacion> {
  const cliente = new ChatOpenAI({ model: CLIENTE_MODELO, ...opcionesDeModelo(CLIENTE_MODELO, 'none'), maxRetries: 3 });
  const guardados: MensajeGuardado[] = []; // del más nuevo al más viejo, como la consulta de la ruta
  const vistaCliente: BaseMessage[] = [new SystemMessage(promptCliente(e))];
  const turnos: Turno[] = [];
  let mensaje = e.primerMensaje;

  for (let n = 0; n < MAX_TURNOS; n++) {
    const ahora = new Date();
    const historial = construirHistorial(guardados, { max: 15 });
    historial.push(new HumanMessage(envolverConFecha(mensaje, ahora)));
    const t0 = Date.now();
    let r;
    try {
      r = await correrAgenteComercial({
        supabase: supabaseSimulado,
        inmobiliariaId: INMO,
        promptSistema: promptSistema + contextoVariable({ telefono: e.telefono, clienteNombre: e.nombre }),
        historial,
        telefono: e.telefono,
      });
    } catch (error) {
      return { escenario: e.id, repeticion, esperado: e.esperado, turnos, fin: 'error', error: String(error) };
    }
    const partes = Object.values(r.response ?? {}).filter(
      (p): p is string => typeof p === 'string' && p.trim() !== ''
    );
    turnos.push({
      cliente: mensaje,
      borrador: r.output,
      partes,
      herramientas: r.herramientasUsadas,
      etapa: r.etapa,
      escalado: r.escalado,
      segundos: (Date.now() - t0) / 1000,
      costo: r.uso.reduce((s, u) => s + calcularCostoUSD(u.modelo, u), 0),
    });
    guardados.unshift({ rol: 'usuario', contenido: mensaje, created_at: ahora.toISOString() });
    guardados.unshift({ rol: 'agente', contenido: r.output, created_at: new Date().toISOString() });
    if (r.escalado) return { escenario: e.id, repeticion, esperado: e.esperado, turnos, fin: 'escalo' };

    vistaCliente.push(new AIMessage(mensaje));
    vistaCliente.push(new HumanMessage(partes.join('\n\n') || '(el bot no respondió nada)'));
    const siguiente = await cliente.invoke(vistaCliente);
    mensaje = String(siguiente.content).trim();
    if (!mensaje || mensaje.includes('[FIN]')) {
      return { escenario: e.id, repeticion, esperado: e.esperado, turnos, fin: 'objetivo' };
    }
  }
  return { escenario: e.id, repeticion, esperado: e.esperado, turnos, fin: 'max_turnos' };
}

const etiqueta = process.argv[2];
if (!etiqueta) throw new Error('uso: conversar.ts <etiqueta> [repeticiones] [escenario...]');
const repeticiones = Number(process.argv[3] ?? 1);
const filtro = process.argv.slice(4);
const elegidos = filtro.length ? ESCENARIOS.filter((e) => filtro.includes(e.id)) : ESCENARIOS;

const promptSistema = process.env.PROMPT_ARCHIVO
  ? fs.readFileSync(process.env.PROMPT_ARCHIVO, 'utf8')
  : await cargarPromptSistema(INMO);

const trabajos = elegidos.flatMap((e) => Array.from({ length: repeticiones }, (_, i) => ({ e, i: i + 1 })));
const resultados: Conversacion[] = [];
const PARALELO = Number(process.env.PARALELO ?? 4);
let siguiente = 0;
async function trabajador() {
  while (siguiente < trabajos.length) {
    const { e, i } = trabajos[siguiente++];
    const c = await conversar(e, i, promptSistema);
    resultados.push(c);
    process.stdout.write(c.fin === 'error' ? 'x' : '.');
  }
}
await Promise.all(Array.from({ length: PARALELO }, trabajador));
resultados.sort((a, b) => a.escenario.localeCompare(b.escenario) || a.repeticion - b.repeticion);
fs.writeFileSync(path.join(AQUI, `conv-${etiqueta}.json`), JSON.stringify(resultados, null, 2));

const todosLosTurnos = resultados.flatMap((c) => c.turnos);
console.log(
  `\n${etiqueta} (${MODELO_PRINCIPAL}): ${resultados.length} conversaciones, ${todosLosTurnos.length} turnos, ` +
    `USD ${todosLosTurnos.reduce((s, t) => s + t.costo, 0).toFixed(3)}`
);
for (const c of resultados) {
  console.log(
    `${c.escenario.padEnd(20)} #${c.repeticion} ${c.fin.padEnd(10)} turnos ${c.turnos.length} ` +
      `herramientas: ${c.turnos.flatMap((t) => t.herramientas.map((h) => h.nombre)).join(',') || '—'}` +
      (c.error ? ` ERROR ${c.error.slice(0, 120)}` : '')
  );
}
