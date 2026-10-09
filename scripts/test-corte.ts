import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mismaDireccion,
  rolesDireccion,
  ventanaDuplicadoMinutos,
  filasDeHilo,
} from '../lib/whatsapp/lineas.ts';
import {
  esEmbudoConectable,
  requiereConfirmacionCorte,
  EMBUDOS_CONECTABLES,
} from '../lib/whatsapp/registro-integrado.ts';

test('mismaDireccion: compara direcciones de negocio y cliente correctamente', () => {
  // Cliente vs cliente
  assert.equal(mismaDireccion('usuario', 'usuario'), true);

  // Cliente vs asesor / agente
  assert.equal(mismaDireccion('usuario', 'asesor'), false);
  assert.equal(mismaDireccion('usuario', 'agente'), false);
  assert.equal(mismaDireccion('asesor', 'usuario'), false);
  assert.equal(mismaDireccion('agente', 'usuario'), false);

  // Negocio: agente (bot por Kommo) y asesor (persona / celular) cuentan como la misma dirección
  assert.equal(mismaDireccion('asesor', 'agente'), true);
  assert.equal(mismaDireccion('agente', 'asesor'), true);
  assert.equal(mismaDireccion('asesor', 'asesor'), true);
  assert.equal(mismaDireccion('agente', 'agente'), true);
});

test('rolesDireccion: devuelve los roles equivalentes para deduplicación contra Kommo', () => {
  assert.deepEqual(rolesDireccion('usuario'), ['usuario']);
  assert.deepEqual(rolesDireccion('asesor'), ['asesor', 'agente']);
});

test('ventanaDuplicadoMinutos: calcula el rango de ±minutos adecuado', () => {
  const baseIso = '2026-10-09T12:00:00.000Z';
  const ventana = ventanaDuplicadoMinutos(baseIso, 2);

  assert.equal(ventana.desde, '2026-10-09T11:58:00.000Z');
  assert.equal(ventana.hasta, '2026-10-09T12:02:00.000Z');

  // Ventana por defecto son 2 minutos
  const ventanaDefecto = ventanaDuplicadoMinutos(baseIso);
  assert.equal(ventanaDefecto.desde, '2026-10-09T11:58:00.000Z');
  assert.equal(ventanaDefecto.hasta, '2026-10-09T12:02:00.000Z');
});

test('esEmbudoConectable y requiereConfirmacionCorte: protegen la comercial', () => {
  // Comercial ahora es conectable pero exige confirmación
  assert.equal(esEmbudoConectable('comercial'), true);
  assert.equal(requiereConfirmacionCorte('comercial'), true);

  // Administrativa y captación son conectables sin confirmación
  assert.equal(esEmbudoConectable('administrativa'), true);
  assert.equal(requiereConfirmacionCorte('administrativa'), false);

  assert.equal(esEmbudoConectable('captacion'), true);
  assert.equal(requiereConfirmacionCorte('captacion'), false);

  // Embudos desconocidos
  assert.equal(esEmbudoConectable('invalido'), false);
  assert.equal(requiereConfirmacionCorte('invalido'), false);

  // Lista conectable
  assert.deepEqual([...EMBUDOS_CONECTABLES], ['administrativa', 'captacion', 'comercial']);
});

test('filasDeHilo: clasifica mensajes de celular con rol asesor y usuario', () => {
  const hilo = {
    id: '573001234567',
    messages: [
      {
        id: 'wamid.HBgL...',
        from: '573001234567', // del cliente
        timestamp: '1728475200',
        type: 'text',
        text: { body: 'Hola, información del inmueble' },
      },
      {
        id: 'wamid.HBgM...',
        from: '573243516352', // del negocio
        timestamp: '1728475260',
        type: 'text',
        text: { body: 'Con gusto, ¿qué presupuesto buscas?' },
      },
    ],
  };

  const resultado = filasDeHilo(hilo);
  assert.ok(resultado);
  assert.equal(resultado.telefono, '+573001234567');
  assert.equal(resultado.filas.length, 2);

  // El del cliente queda como 'usuario'
  assert.equal(resultado.filas[0].rol, 'usuario');
  assert.equal(resultado.filas[0].contenido, 'Hola, información del inmueble');

  // El del negocio queda como 'asesor' (lo que la persona mandó desde el celular)
  assert.equal(resultado.filas[1].rol, 'asesor');
  assert.equal(resultado.filas[1].contenido, 'Con gusto, ¿qué presupuesto buscas?');
});
