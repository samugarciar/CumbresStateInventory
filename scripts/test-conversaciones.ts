import test from 'node:test';
import assert from 'node:assert/strict';
import { conversacionDe } from '../lib/whatsapp/conversaciones.ts';

/**
 * Un cliente de Supabase de mentira, con solo lo que usa conversacionDe:
 * buscar por inmobiliaria y teléfono, e insertar con un único que puede
 * chocar (23505) cuando otra escritura la creó un instante antes.
 */
function clienteFalso(opciones: { existente?: string; choca?: string }) {
  const llamadas: string[] = [];
  let busquedas = 0;
  const cliente = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      busquedas += 1;
                      llamadas.push('buscar');
                      // La segunda búsqueda, tras el choque, ya encuentra la que creó el otro.
                      if (opciones.existente) return { data: { id: opciones.existente } };
                      if (opciones.choca && busquedas > 1) return { data: { id: opciones.choca } };
                      return { data: null };
                    },
                  };
                },
              };
            },
          };
        },
        insert(fila: Record<string, unknown>) {
          llamadas.push(`insertar ${fila.telefono}`);
          return {
            select() {
              return {
                async single() {
                  if (opciones.choca) return { data: null, error: { code: '23505', message: 'duplicada' } };
                  return { data: { id: 'nueva-1' }, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { cliente, llamadas };
}

test('conversacionDe usa la que ya existe, sin crear otra', async () => {
  const { cliente, llamadas } = clienteFalso({ existente: 'vieja-1' });
  // @ts-expect-error cliente de mentira
  assert.equal(await conversacionDe(cliente, 'inmo', '+573001234567'), 'vieja-1');
  assert.deepEqual(llamadas, ['buscar']);
});

test('conversacionDe la crea para quien nunca escribió (un recordatorio de cartera)', async () => {
  const { cliente, llamadas } = clienteFalso({});
  // @ts-expect-error cliente de mentira
  assert.equal(await conversacionDe(cliente, 'inmo', '+573001234567'), 'nueva-1');
  assert.deepEqual(llamadas, ['buscar', 'insertar +573001234567']);
});

test('conversacionDe, si otra escritura la creó a la vez, usa esa', async () => {
  const { cliente, llamadas } = clienteFalso({ choca: 'la-del-otro' });
  // @ts-expect-error cliente de mentira
  assert.equal(await conversacionDe(cliente, 'inmo', '+573001234567'), 'la-del-otro');
  assert.deepEqual(llamadas, ['buscar', 'insertar +573001234567', 'buscar']);
});
