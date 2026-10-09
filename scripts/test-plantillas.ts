import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizarTextoMeta,
  crearPlantillaRevision,
} from '../lib/whatsapp/meta';

test('sanitizarTextoMeta retira tokens de Meta y Bearer', () => {
  const tokenPrueba = 'EAABsb7tZBsIABO6z1234567890abcdef';
  const mensajeConToken = `Error de Meta con token ${tokenPrueba} en la petición`;
  const sanitizado = sanitizarTextoMeta(mensajeConToken);

  assert.ok(!sanitizado.includes(tokenPrueba), 'El token no debe aparecer');
  assert.ok(sanitizado.includes('[token retirado]'), 'Debe reemplazarse por [token retirado]');

  const mensajeBearer = 'Authorization: Bearer mySecretToken123456';
  const sanitizadoBearer = sanitizarTextoMeta(mensajeBearer);
  assert.ok(!sanitizadoBearer.includes('mySecretToken123456'));
  assert.ok(sanitizadoBearer.includes('Bearer [token retirado]'));
});

test('sanitizarTextoMeta respeta textos limpios y nulos', () => {
  assert.equal(sanitizarTextoMeta(null), '');
  assert.equal(sanitizarTextoMeta(undefined), '');
  assert.equal(sanitizarTextoMeta('Error de red simple'), 'Error de red simple');
});

test('crearPlantillaRevision arma el payload correcto para Meta', async () => {
  const fetchOriginal = globalThis.fetch;
  let urlLlamada = '';
  let payloadCapturado: {
    name?: string;
    category?: string;
    language?: string;
    parameter_format?: string;
    components?: Array<{ type?: string; example?: { body_text?: string[][] } }>;
  } | undefined = undefined;
  let authCapturado: string | undefined = undefined;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urlLlamada = String(input);
    const headers = init?.headers as Record<string, string> | undefined;
    authCapturado = headers?.Authorization;
    payloadCapturado = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'meta_template_123', status: 'PENDING' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const res = await crearPlantillaRevision('1122334455', 'dummy_token', {
      nombreMeta: 'confirmacion_cita_v1',
      cuerpo: 'Hola {{nombre}}, tu cita para {{inmueble}} quedó confirmada para el {{fecha}}.',
      categoria: 'utilidad',
      idioma: 'es',
      ejemplos: ['Carlos Gómez', 'Apto 502', '2026-10-20'],
    });

    assert.ok(res.ok);
    if (res.ok) {
      assert.equal(res.datos.id, 'meta_template_123');
      assert.equal(res.datos.status, 'PENDING');
    }

    assert.ok(urlLlamada.includes('1122334455/message_templates'));
    assert.equal(authCapturado, 'Bearer dummy_token');
    const p1 = () => payloadCapturado;
    assert.equal(p1()?.name, 'confirmacion_cita_v1');
    assert.equal(p1()?.category, 'UTILITY');
    assert.equal(p1()?.language, 'es');
    assert.equal(p1()?.parameter_format, 'NAMED');
    assert.equal(p1()?.components?.[0]?.type, 'BODY');
    assert.deepEqual(p1()?.components?.[0]?.example?.body_text, [
      ['Carlos Gómez', 'Apto 502', '2026-10-20'],
    ]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('crearPlantillaRevision genera ejemplos por defecto si no se especifican', async () => {
  const fetchOriginal = globalThis.fetch;
  let payloadCapturado: {
    category?: string;
    components?: Array<{ example?: { body_text?: string[][] } }>;
  } | undefined = undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    payloadCapturado = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'meta_template_456' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await crearPlantillaRevision('1122334455', 'dummy_token', {
      nombreMeta: 'aviso_asesor',
      cuerpo: 'Estimado {{nombre}}, el asesor {{asesor}} te contactará.',
      categoria: 'marketing',
    });

    const p2 = () => payloadCapturado;
    assert.equal(p2()?.category, 'MARKETING');
    assert.deepEqual(p2()?.components?.[0]?.example?.body_text, [
      ['Juan Pérez', 'Alejandro Rojas'],
    ]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

