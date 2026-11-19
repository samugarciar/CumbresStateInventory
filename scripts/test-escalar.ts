import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tieneEtiquetaEscalar,
  sinEtiquetaEscalar,
  normalizarBorrador,
  pideDatoParaRegistrar,
  prometeAsesor,
} from '../lib/agente-comercial/escalar.ts';

test('la etiqueta al inicio, como pide el protocolo', () => {
  const b = '[ESCALAR] Gracias, un asesor te contacta por este chat.';
  assert.equal(tieneEtiquetaEscalar(b), true);
  assert.equal(sinEtiquetaEscalar(b), 'Gracias, un asesor te contacta por este chat.');
});

test('la etiqueta en medio también escala y no le llega al cliente (caso real, gpt-6-luna)', () => {
  const b =
    'Hola, Felipe. No tengo información confirmada sobre mascotas ni estrato; prefiero verificarlos con un ' +
    'asesor. [ESCALAR] Te contactarán por este chat.';
  assert.equal(tieneEtiquetaEscalar(b), true);
  assert.equal(sinEtiquetaEscalar(b).includes('ESCALAR'), false);
  assert.equal(sinEtiquetaEscalar(b).includes('Te contactarán por este chat.'), true);
});

test('el mensaje duplicado con la etiqueta repetida queda una sola vez (caso real, queja)', () => {
  const b =
    '[ESCALAR] Lamento mucho lo ocurrido, Sandra. Un asesor te contactará por este mismo chat.\n' +
    '-[ESCALAR] Lamento mucho lo ocurrido, Sandra. Un asesor te contactará por este mismo chat.';
  assert.equal(sinEtiquetaEscalar(b), 'Lamento mucho lo ocurrido, Sandra. Un asesor te contactará por este mismo chat.');
});

test('variantes de escritura de la etiqueta', () => {
  assert.equal(tieneEtiquetaEscalar('[ escalar ] hola'), true);
  assert.equal(sinEtiquetaEscalar('[ escalar ] hola'), 'hola');
});

test('sin etiqueta no se toca nada: listas y párrafos se conservan', () => {
  const b = 'Tengo estas opciones:\n\n- Mi Mundo: $1.600.000\n- Vidanta: $1.700.000\n\n¿Cuál te interesa?';
  assert.equal(tieneEtiquetaEscalar(b), false);
  assert.equal(sinEtiquetaEscalar(b), b);
});

test('el borrador para n8n lleva una sola etiqueta, al inicio', () => {
  const b = 'Te ayudo con eso. [ESCALAR] Un asesor te escribe.\n[ESCALAR] Te ayudo con eso. Un asesor te escribe.';
  assert.equal(normalizarBorrador(b, true), '[ESCALAR] Te ayudo con eso. Un asesor te escribe.');
  // Escala por código (evaluarEscalamiento) aunque el modelo no la haya puesto.
  assert.equal(normalizarBorrador('Listo, quedó registrada.', true), '[ESCALAR] Listo, quedó registrada.');
  assert.equal(normalizarBorrador('Hola', false), 'Hola');
});

test('la copia reescrita del mismo párrafo tampoco le llega al cliente (caso real, queja)', () => {
  const b =
    '[ESCALAR] Sandra, lamento mucho lo ocurrido y entiendo tu molestia. Voy a escalarlo para que un asesor revise ' +
    'lo sucedido en la visita de Vidanta y te contacte por este mismo chat.\n' +
    'Sandra, lamento mucho lo ocurrido y entiendo tu molestia. Un asesor revisará lo sucedido en la visita de ' +
    'Vidanta y te contactará por este mismo chat.';
  assert.equal(sinEtiquetaEscalar(b).split('\n').length, 1);
});

test('sin etiqueta, dos párrafos parecidos se conservan (no es una copia de escalamiento)', () => {
  const b =
    'En Mi Mundo, Niquía, tengo apartamentos de 3 habitaciones y 2 baños en arriendo desde $1.600.000 al mes.\n' +
    'En Vidanta, San Gabriel, tengo apartamentos de 3 habitaciones y 2 baños en arriendo desde $1.700.000 al mes.';
  assert.equal(sinEtiquetaEscalar(b), b);
});

test('pide un dato para registrar la visita (casos reales de gpt-6-luna)', () => {
  assert.equal(pideDatoParaRegistrar('[ESCALAR] Gracias, Natalia. Para continuar con el registro de tu visita, me compartes tu número de teléfono?'), true);
  assert.equal(pideDatoParaRegistrar('[ESCALAR] Entiendo. Me compartes tu nombre completo para dejarlo registrado?'), true);
  assert.equal(pideDatoParaRegistrar('[ESCALAR] Claro, está disponible por $290.000.000. Qué día y a qué hora te gustaría visitarlo? 😊'), true);
});

test('no aplica a quejas, negociaciones ni mensajes que no terminan en pregunta', () => {
  assert.equal(pideDatoParaRegistrar('[ESCALAR] Lamento lo ocurrido. ¿Me compartes tu nombre para que el asesor revise tu caso?'), false);
  assert.equal(pideDatoParaRegistrar('[ESCALAR] No puedo negociar el canon; un asesor revisará tu oferta. ¿Te interesa alguno de esos horarios?'), false);
  assert.equal(pideDatoParaRegistrar('[ESCALAR] Listo, la visita quedó registrada. Un asesor te escribirá por este chat.'), false);
});

test('también cuenta una pregunta que no va al final (caso real, gpt-6-luna)', () => {
  assert.equal(
    pideDatoParaRegistrar(
      '[ESCALAR] Para buscar una visita entre semana a esa hora, me compartes tu nombre completo? Ya tengo tu ' +
        'teléfono y te confirmo el horario por este chat.'
    ),
    true
  );
});

test('«p. m.» no parte la pregunta por el dato (caso real de producción)', () => {
  assert.equal(
    pideDatoParaRegistrar(
      '¡Perfecto, Marleny! Para agendar la visita mañana miércoles 18 de noviembre a las 3:00 p. m. en Mi Mundo ' +
        '(Niquía, Bello), ¿me confirmas por favor tu nombre completo y tu número de teléfono? Así te separo el espacio.'
    ),
    true
  );
});

test('pedir el dato en imperativo, o con el «para qué» en la oración siguiente, también cuenta', () => {
  assert.equal(
    pideDatoParaRegistrar(
      'Para agendar tu visita mañana sábado de 11:30 a. m. a 12:00 m., por favor confírmame tu nombre completo y ' +
        'número de teléfono. Así te separo el espacio y un asesor te contacta.'
    ),
    true
  );
  assert.equal(
    pideDatoParaRegistrar('¿Me confirmas por favor tu número de teléfono? Lo necesito para registrar la solicitud de visita.'),
    true
  );
});

test('pedir el nombre para compartir el contacto del empalme también es pedir un dato', () => {
  assert.equal(pideDatoParaRegistrar('Está en empalme. Para compartirte el contacto, me regalas tu nombre completo?'), true);
  // Una queja que pide el nombre sigue sin contar.
  assert.equal(pideDatoParaRegistrar('Lamento lo ocurrido. ¿Me compartes tu nombre para que un asesor te contacte?'), false);
});

test('promete un asesor: casos reales de producción que no escalaban', () => {
  const promesas = [
    'Prefiero confirmártelo con el asesor para no darte un dato equivocado. Un asesor te contactará pronto por este chat.',
    'Esa información te la confirmo con el asesor para no darte un dato equivocado. ¿Te gustaría agendar una visita?',
    'Confirmo con el asesor en qué piso están ubicados los apartamentos y si todas las habitaciones tienen clóset.',
    'Te confirmo el piso exacto con el asesor para no darte un dato equivocado.',
    '¡Claro! El formulario te lo comparte directamente un asesor de Cumbres por este chat.',
    'Lamento la falta de confirmación. Voy a escalar tu caso para que un asesor te contacte lo más pronto posible.',
    '¡Gracias! Queda registrada tu solicitud. Un asesor de Cumbres te confirmará el horario por este chat muy pronto.',
  ];
  for (const t of promesas) assert.equal(prometeAsesor(t), true, t);
});

test('ofrecer, preguntar o condicionar no es prometer', () => {
  const ofertas = [
    '¿Te gustaría que te contacte un asesor para darte esa información?',
    'Un asesor de Cumbres te puede ayudar a conseguirlas o mostrarte alternativas.',
    'Si necesitas la dirección exacta, un asesor te la puede confirmar por este chat.',
    'Si no tienes ese dato, le confirmo al asesor y te aviso.',
    'Este apartamento no es empalme, así que la visita se agenda directamente con un asesor de Cumbres.',
    'Hola, el apartamento está disponible por $1.400.000. ¿Te sirve el viernes a las 10:00 a. m.?',
  ];
  for (const t of ofertas) assert.equal(prometeAsesor(t), false, t);
});
