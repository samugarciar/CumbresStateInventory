/**
 * Bookmarklet "Captar" — recolecta anuncios desde el navegador y los manda a
 * la bandeja de /captaciones.
 *
 * POR QUÉ ASÍ (y no un scraper en el servidor):
 * Mercado Libre y Meta bloquean IPs de datacenter, así que un navegador
 * headless en Vercel no funcionaría sin proxies residenciales y falsificación
 * de huella — justo la evasión que este proyecto no hace. Esto corre en el
 * navegador del asesor, con su sesión, cuando él lo decide. No hay nada que
 * evadir.
 *
 * POR QUÉ ABRE UNA PESTAÑA (y no hace fetch):
 * Facebook y Mercado Libre tienen CSP estricta: un fetch desde sus páginas
 * hacia la app sería bloqueado. Navegar no lo bloquea nadie. Además así se usa
 * la sesión de admin en vez de meter un token dentro del marcador.
 *
 * MODOS (se eligen solos según la página):
 *   · Publicación de FB/ML  → captura ESA, con descripción y vendedor (preciso)
 *   · Lista de resultados   → captura las visibles (rápido, sin descripción)
 *
 * Para actualizarlo hay que volver a crear el marcador (es autocontenido).
 */
(function () {
  var APP = 'https://cumbres-state-inventory.vercel.app/captaciones/importar';
  var TOPE = 25;

  function limpio(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  function num(s) {
    var m = String(s == null ? '' : s).replace(/[^\d]/g, '');
    return m ? Number(m) : null;
  }
  // Texto entre dos marcas del innerText (así se leen "Descripción" y
  // "Detalles del vendedor" sin depender de clases de CSS ofuscadas).
  function bloque(txt, desde, hasta) {
    var i = txt.indexOf(desde);
    if (i < 0) return null;
    var d = i + desde.length;
    var j = -1;
    for (var k = 0; k < hasta.length; k++) {
      var p = txt.indexOf(hasta[k], d);
      if (p > 0 && (j < 0 || p < j)) j = p;
    }
    return limpio(txt.slice(d, j > 0 ? j : d + 1500));
  }

  var url = location.href;
  var host = location.hostname;
  var esFB = /facebook\.com/.test(host);
  var esML = /mercadolibre\.com/.test(host);
  var anuncios = [];

  // ---------- Publicación de Facebook (modo preciso) ----------
  if (esFB && /\/marketplace\/item\//.test(location.pathname)) {
    var t = document.body.innerText;
    // El contador de notificaciones puede venir como "(20+)", no solo "(20)".
    var titulo = limpio(
      document.title
        .replace(/^\(\d+\+?\)\s*/, '')
        .replace(/\s*\|\s*Facebook\s*$/, '')
        .replace(/^Marketplace\s*[-–]\s*/, '')
    );
    var desc = bloque(t, 'Descripción', ['Ver más', 'Publicidad', 'Información del vendedor']);
    var vend = bloque(t, 'Detalles del vendedor', ['Reporta esta publicación', 'Envía un mensaje']);
    // Ubicación: SOLO con encabezados propios de la publicación.
    // OJO: no usar el marcador suelto "Ubicación" — en Marketplace también
    // titula el filtro de la barra lateral ("Ubicación / Medellín / En un radio
    // de 20 km"), que es la búsqueda del usuario, NO dónde está el inmueble.
    // Capturarlo pondría la ciudad equivocada en el prospecto.
    var ciudad = null;
    var marcas = ['Ubicación de la vivienda', 'Ubicación del alquiler', 'Ubicación de la propiedad'];
    for (var mi = 0; mi < marcas.length && !ciudad; mi++) {
      ciudad = bloque(t, marcas[mi], ['La ubicación es aproximada', 'Descripción', 'Publicidad']);
    }
    // Si no aparece, se deja vacío: el modelo la infiere de la descripción,
    // que es más fiable que adivinar.
    if (ciudad && ciudad.length > 60) ciudad = null;
    anuncios.push({
      url: location.origin + location.pathname,
      contacto_perfil: location.origin + location.pathname,
      titulo: titulo,
      precio: num((t.match(/\$\s?[\d.,]{4,}/) || [])[0]),
      ciudad: ciudad || null,
      // El nombre y la reputación del vendedor son la mejor señal de si es
      // dueño directo o un profesional; van dentro de la descripción.
      descripcion: (desc || '') + (vend ? '\n[Vendedor en Facebook Marketplace: ' + vend + ']' : ''),
      contacto_nombre: vend ? limpio(vend.split(/\s+(?:\(|Se unió)/)[0]) : null,
    });
  }

  // ---------- Publicación de Mercado Libre (modo preciso) ----------
  else if (esML && /MCO-?\d{6,}/.test(url)) {
    var tm = document.body.innerText;
    var h1 = document.querySelector('h1');
    anuncios.push({
      url: url.split('?')[0],
      titulo: limpio(h1 ? h1.innerText : document.title),
      precio: num((tm.match(/\$\s?[\d.,]{4,}/) || [])[0]),
      descripcion: bloque(tm, 'Descripción', ['Preguntas', 'Publicaciones', 'Opiniones']),
      // ML marca "Información del particular" cuando es dueño directo
      fuente_marca_dueno_directo: /Información del particular/i.test(tm) || /\/directo\//.test(url),
    });
  }

  // ---------- Lista de resultados (modo rápido) ----------
  else {
    var sel = esFB ? 'a[href*="/marketplace/item/"]' : 'a[href*="/MCO-"]';
    var vistos = {};
    var enlaces = document.querySelectorAll(sel);
    for (var i = 0; i < enlaces.length && anuncios.length < TOPE; i++) {
      var a = enlaces[i];
      var href = a.getAttribute('href') || '';
      var id = esFB ? (href.match(/item\/(\d+)/) || [])[1] : (href.match(/MCO-?(\d+)/) || [])[1];
      if (!id || vistos[id]) continue;
      var card = a.closest('li') || a.closest('div.andes-card') || a.parentElement;
      if (!card) continue;
      vistos[id] = 1;
      var txt = limpio(card.innerText);
      if (!txt) continue;
      anuncios.push({
        url: a.href.split('?')[0],
        contacto_perfil: esFB ? a.href.split('?')[0] : null,
        titulo: limpio(txt.replace(/^.*?en (venta|arriendo|alquiler)\s*/i, '').split('$')[0]) || txt.slice(0, 90),
        precio: num((txt.match(/\$\s?[\d.,]{4,}/) || [])[0]),
        habitaciones: num((txt.match(/(\d+)\s*(?:habitaci|alcoba|hab\b)/i) || [])[1]),
        banos: num((txt.match(/(\d+)\s*ba[ñn]o/i) || [])[1]),
        area_m2: num((txt.match(/(\d+)\s*m²/) || [])[1]),
        fuente_marca_dueno_directo: /\/directo\//.test(url) || null,
      });
    }
  }

  if (!anuncios.length) {
    alert('No encontré anuncios en esta página.\n\nAbre una publicación de Facebook Marketplace o de Mercado Libre, o una lista de resultados, y vuelve a intentarlo.');
    return;
  }

  var payload = encodeURIComponent(JSON.stringify({ anuncios: anuncios }));
  if (payload.length > 1500000) {
    alert('Se recolectaron demasiados datos para enviarlos de una vez. Prueba con menos anuncios.');
    return;
  }
  window.open(APP + '#' + payload, '_blank');
})();
