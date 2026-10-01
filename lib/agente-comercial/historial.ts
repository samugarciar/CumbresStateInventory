import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

/**
 * El historial que ve el agente, armado desde agente_comercial_mensajes.
 *
 * TRES VOCES, NO DOS. Hasta el canal propio solo hablaban el cliente
 * ('usuario') y el bot ('agente'), y todo lo que no era del cliente entraba
 * como dicho por el bot. Con el canal propio aparece una tercera: una
 * persona del equipo ('asesor'), que escribe desde el CRM o desde la app
 * del celular. Mapeada como bot, el agente "recordaba" haber prometido lo
 * que prometió el asesor —un precio, una visita, una condición de pago— y
 * con el relevo lo retomaba a las 6 horas, delante del cliente, como
 * compromiso propio.
 *
 * El asesor entra como mensaje HUMANO con su autoría escrita, y no como
 * mensaje de sistema: lo que escribe una persona del equipo es contexto
 * para el bot, nunca una instrucción. Qué debe hacer el bot con lo que
 * prometió un asesor es política, y esa vive en el prompt editable desde
 * /agentes, no aquí.
 */

const FECHA_CORTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Los turnos VIEJOS solo necesitan su fecha como ancla para que "mañana" o
// "el martes" sigan significando lo mismo que cuando se escribieron. Antes
// llevaban el preámbulo completo (~60 tokens cada uno): con 15 mensajes de
// historial eran ~400 tokens por llamada, y como el bucle ReAct hace varias
// llamadas por turno, se iban ~1.200 tokens del presupuesto por minuto en
// repetir 15 veces la misma instrucción. La instrucción va una sola vez, en
// el mensaje nuevo (envolverConFecha, en la ruta).
export function anclarFecha(mensaje: string, fecha: Date): string {
  return `[${FECHA_CORTA.format(fecha)}] ${mensaje}`;
}

export const AUTORIA_ASESOR =
  '[Mensaje de una persona del equipo de Cumbres al cliente. No lo escribiste tú.]';

export interface MensajeGuardado {
  rol: string;
  contenido: string;
  created_at: string;
  wa_message_id?: string | null;
}

/**
 * @param mensajes del MÁS NUEVO al más viejo, tal como salen de la consulta.
 * @param opciones.excluirWaMessageId el mensaje que llega ahora, cuando ya
 *   está guardado (canal propio): el modelo lo recibe aparte, envuelto con
 *   la fecha, y no debe leerlo dos veces. Se filtra aquí y no en la consulta
 *   porque `wa_message_id <> x` en SQL también deja fuera los NULL — o sea,
 *   todo el histórico que entró por Kommo.
 */
export function construirHistorial(
  mensajes: MensajeGuardado[],
  opciones: { max: number; excluirWaMessageId?: string }
): BaseMessage[] {
  return mensajes
    .filter(
      (m) => !opciones.excluirWaMessageId || m.wa_message_id !== opciones.excluirWaMessageId
    )
    .slice(0, opciones.max)
    .reverse()
    .map((m) => {
      const fecha = new Date(m.created_at);
      switch (m.rol) {
        case 'usuario':
          return new HumanMessage(anclarFecha(m.contenido, fecha));
        case 'asesor':
          return new HumanMessage(anclarFecha(`${AUTORIA_ASESOR} ${m.contenido}`, fecha));
        default:
          // Solo queda 'agente': el CHECK de la tabla no admite otro rol.
          return new AIMessage(m.contenido);
      }
    });
}
