// Regenera captar-bookmarklet.url.txt desde el fuente legible.
//
//   node herramientas/regenerar.js
//
// Hace TRES cosas: minifica, valida la sintaxis y ejecuta el resultado contra
// un DOM simulado. La tercera existe por un fallo real: una edición borró seis
// funciones auxiliares del archivo (limpio, num, esperar, bloque, vistos,
// recordar) y nadie se enteró, porque `new Function()` valida la SINTAXIS pero
// no las referencias. El .url.txt se generaba "bien" y reventaba con
// ReferenceError al usarlo; el síntoma para quien lo usa es un panel en blanco.

const fs = require('fs');
const FUENTE = 'herramientas/captar-bookmarklet.js';
const DESTINO = 'herramientas/captar-bookmarklet.url.txt';

const src = fs.readFileSync(FUENTE, 'utf8');

// El minificado solo quita líneas que son ÍNTEGRAMENTE comentario. No intentes
// quitar comentarios a mitad de línea: un "//" dentro de una expresión regular
// (p. ej. /\/marketplace\/item\//) rompe el código — ya pasó una vez.
const codigo = src
  .replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')
  .split('\n')
  .filter((l) => !/^\s*\/\//.test(l) && l.trim() !== '')
  .join('\n');

// ---- 1) sintaxis ----
new Function(codigo);

// ---- 2) ejecución contra un DOM simulado ----
//
// Escanear el texto buscando llamadas no sirve: los literales de expresión
// regular y los comentarios a final de línea producen falsos positivos
// (/^.*?en (venta|arriendo)/ parece una llamada a "en"). Ejecutarlo sí es
// concluyente.
function humo(codigo, ruta) {
  // Todo lo que se escribe en un nodo se anota aquí. Es la única forma de ver
  // si el bookmarklet acabó en su propio catch: como ahora PINTA el error en
  // vez de propagarlo (que es lo que le conviene al usuario), no hay excepción
  // que atrapar — hay que mirar lo que se dibujó.
  const escrito = [];
  const botones = [];
  const nodoFalso = () => {
    const n = {
      style: {}, children: [],
      appendChild() {}, removeChild() {}, remove() {}, click() {},
      setAttribute() {}, getAttribute: () => '',
      querySelector: () => nodoFalso(), querySelectorAll: () => [],
      innerText: '', innerHTML: '',
      parentElement: null, parentNode: null, href: '',
    };
    Object.defineProperty(n, 'textContent', {
      get: () => '', set: (v) => { if (v) escrito.push(String(v)); },
    });
    return n;
  };

  // Anuncios falsos: sin ellos el bucle de tarjetasVisibles() no da ni una
  // vuelta y el humo no toca las funciones auxiliares — que es justo lo que se
  // quiere comprobar.
  const anclaFalsa = (id) => Object.assign(nodoFalso(), {
    href: 'https://www.facebook.com/marketplace/item/' + id + '/',
    getAttribute: (n) => (n === 'href'
      ? '/marketplace/item/' + id + '/'
      : 'Apartamento en arriendo en Bello, $ 1.500.000, Bello, publicación ' + id),
    innerText: 'Apartamento en arriendo $ 1.500.000 3 habitaciones 2 baños 67 m² Bello',
  });
  const anclas = [anclaFalsa('111111111111111'), anclaFalsa('222222222222222')];

  const crear = (tag) => {
    const n = nodoFalso();
    if (String(tag).toLowerCase() === 'button') botones.push(n);
    return n;
  };
  const doc = {
    createElement: crear,
    querySelector: () => nodoFalso(),
    querySelectorAll: (sel) => (String(sel).indexOf('marketplace/item') >= 0 ? anclas : []),
    body: Object.assign(nodoFalso(), { scrollHeight: 1000, innerText: 'Descripción Un apartamento. Detalles del vendedor Juan (3 calificaciones)' }),
    documentElement: nodoFalso(),
    title: 'Apartamento en arriendo | Facebook',
  };
  const ventana = {
    location: {
      href: 'https://www.facebook.com' + ruta,
      hostname: 'www.facebook.com', pathname: ruta, origin: 'https://www.facebook.com',
    },
    localStorage: { getItem: () => '[]', setItem() {}, removeItem() {} },
    document: doc, alert() {}, open: () => ({}), scrollTo() {},
  };
  // Ejecuta el callback en el siguiente microtask en vez de esperar de verdad.
  // Con un setTimeout que no llamaba a nada, `await esperar(1400)` no resolvía
  // nunca y el humo se quedaba a medias: no tocaba vistos(), boton() ni
  // recordar(), y esas funciones podían borrarse sin que saltara la alarma.
  const timer = (f) => { if (typeof f === 'function') Promise.resolve().then(f); return 0; };

  const errores = [];
  const alRechazar = (e) => errores.push(e);
  process.on('unhandledRejection', alRechazar);
  try {
    const f = new Function(
      'window', 'document', 'location', 'localStorage', 'alert', 'setTimeout', 'scrollTo',
      codigo
    );
    f(ventana, doc, ventana.location, ventana.localStorage, ventana.alert, timer, ventana.scrollTo);
  } catch (e) {
    errores.push(e);
  }
  return { errores, escrito, botones, fin: () => process.off('unhandledRejection', alRechazar) };
}

// Las dos rutas del recolector. Sin la de publicación, `bloque()` y
// `capturarPublicacion()` nunca se ejecutan en el humo.
const RUTAS = [
  ['lista de resultados', '/marketplace/medellin/search/'],
  ['una publicación', '/marketplace/item/1234567890123/'],
];

const respirar = (n) => new Promise((r) => { let i = 0; const t = () => (++i >= n ? r() : setImmediate(t)); setImmediate(t); });

async function comprobar() {
  const errores = [];
  const escrito = [];
  for (const [nombre, ruta] of RUTAS) {
    const r = humo(codigo, ruta);
    await respirar(30);
    // Pulsar los botones que se pintaron: es lo único que ejercita enviar() y,
    // con él, recordar().
    for (const b of r.botones) {
      try { if (typeof b.onclick === 'function') b.onclick(); } catch (e) { r.errores.push(e); }
    }
    await respirar(15);
    r.fin();
    errores.push(...r.errores);
    escrito.push(...r.escrito);
    if (process.env.VERBOSE) console.log('  [' + nombre + '] ' + r.escrito.join(' · ').slice(0, 200));
  }

  // El bookmarklet pinta sus errores en vez de propagarlos: si en el humo salió
  // el panel de fallo, el archivo está roto aunque no haya excepción.
  if (escrito.some((t) => /Algo falló al recolectar/.test(t))) {
    const detalle = escrito.filter((t) => !/Algo falló|Copia este mensaje|^Cerrar$|^Captar v/.test(t));
    console.error('✗ El bookmarklet termina en su panel de error:');
    [...new Set(detalle)].forEach((m) => console.error('    ' + m));
    console.error('  NO se regeneró el .url.txt.');
    process.exit(1);
  }
  const fallos = errores.filter((e) => e instanceof ReferenceError || e instanceof TypeError);
  if (fallos.length) {
    console.error('✗ El bookmarklet revienta al ejecutarse:');
    [...new Set(fallos.map((e) => e.message))].forEach((m) => console.error('    ' + m));
    console.error('  Suele ser una función auxiliar borrada por accidente al editar.');
    console.error('  NO se regeneró el .url.txt.');
    process.exit(1);
  }
}

comprobar().then(() => {
  fs.writeFileSync(DESTINO, 'javascript:' + encodeURIComponent(codigo));
  console.log('✓ sintaxis y ejecución OK ·', codigo.length, 'bytes ·', DESTINO);
});
