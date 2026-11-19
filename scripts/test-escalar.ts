import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tieneEtiquetaEscalar,
  sinEtiquetaEscalar,
  normalizarBorrador,
  pideDatoParaRegistrar,
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
