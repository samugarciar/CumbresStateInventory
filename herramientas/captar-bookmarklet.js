/**
 * Bookmarklet "Captar" — recolecta anuncios desde el navegador y los manda a
 * la bandeja de /captaciones.
 *
 * POR QUÉ ASÍ (y no un scraper en el servidor):
 * Mercado Libre y Meta bloquean IPs de datacenter, así que un navegador
 * headless en Vercel no funcionaría sin proxies residenciales y falsificación
 * de huella — justo la evasión que este proyecto no hace. Esto corre en el
 * navegador del asesor, con su sesión, cuando él lo decide.
 *
 * POR QUÉ ABRE UNA PESTAÑA (y no hace fetch):
 * Facebook y Mercado Libre tienen CSP estricta: un fetch desde sus páginas
 * hacia la app sería bloqueado. Navegar no lo bloquea nadie. Además así se usa
 * la sesión de admin en vez de meter un token dentro del marcador.
 *
 * MODOS (se eligen solos según la página):
 *   · Publicación de FB/ML  → captura ESA, con descripción y vendedor (preciso)
 *   · Lista de resultados   → baja la página cargando más resultados y captura
 *                             en tandas, SIN repetir lo ya enviado (ver abajo)
 *
 * MEMORIA / NO REPETIR:
 * Cada anuncio enviado se anota en localStorage del propio sitio. En la
 * siguiente pasada se saltan los ya enviados, así que hacer clic varias veces
 * va avanzando por el inventario en vez de recapturar lo mismo. El servidor
 * igual deduplica, pero eso gastaba LLM al pedo y ensuciaba la vista previa.
 */
(function () {
  var BASE = 'https://cumbres-state-inventory.vercel.app/captaciones';
  // Dos destinos, porque no todo lo capturado vale lo mismo:
  //   importar → captura completa (con descripción): se califica ya.
  //   cola     → solo el link: se califica cuando se abra la publicación.
  var APP_IMPORTAR = BASE + '/importar';
  var APP_COLA = BASE + '/cola';
  var POR_TANDA = 25;      // tope por envío (el servidor también corta en 25)
  var PASADAS_SCROLL = 10; // cuántas veces intenta cargar más resultados
  var CLAVE = 'captar:vistos:' + location.hostname;
  // Versión visible en el panel. Sirve para saber de un vistazo si el marcador
  // instalado en el navegador es el actual: ya hubo una confusión en la que no
  // se distinguía "el bookmarklet falla" de "tengo instalada una versión vieja".
  // Súbela al cambiar el comportamiento del recolector.
  var VERSION = 'v4';

  // ZONA OBJETIVO, POR LISTA DE PERMITIDOS.
  // Facebook no filtra por el texto que buscas: filtra por la ubicación
  // configurada de Marketplace y su radio. Con el radio en 65 km desde Medellín,
  // "arriendo en Bello" devuelve medio departamento.
  //
  // Se probó primero con una lista de EXCLUSIONES y no sirve: se coló San Pedro
  // de los Milagros por no estar en ella, y Antioquia tiene 125 municipios —esa
  // lista nunca va a estar completa—. Al revés sí es exhaustivo: la zona son
  // Bello y la comuna de Robledo, que es Medellín. Cualquier otro municipio
  // sobra.
  //
  // OJO: esto es un colador grueso por MUNICIPIO. Belén, Laureles o El Poblado
  // aparecen rotulados "Medellín" y pasan; a esos los sigue atrapando el
  // calificador al capturar la publicación, con el criterio real que vive en
  // lib/agente-captaciones/config.ts.
  var CIUDADES_OBJETIVO = ['bello', 'medellin', 'robledo', 'niquia'];

  // Sin tildes y en minúsculas, para que "Itagüí" y "itagui" sean lo mismo.
  function sinTildes(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  /**
   * true solo si SABEMOS que está fuera. Sin ciudad se conserva: Facebook rotula
   * mal a menudo (vimos anuncios que dicen "EN BELLO" en el título y aparecen
   * como Medellín), y perder uno bueno es peor que omitir uno malo a mano.
   */
  function estaFueraDeZona(ciudad) {
    var c = sinTildes(ciudad);
    if (!c) return false;
    for (var i = 0; i < CIUDADES_OBJETIVO.length; i++) {
      if (c.indexOf(CIUDADES_OBJETIVO[i]) >= 0) return false;
    }
    return true;
  }

  function limpio(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function num(s) { var m = String(s == null ? '' : s).replace(/[^\d]/g, ''); return m ? Number(m) : null; }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Texto entre dos marcas del innerText (así se leen "Descripción" y
  // "Detalles del vendedor" sin depender de clases de CSS ofuscadas).
  function bloque(txt, desde, hasta) {
    var i = txt.indexOf(desde); if (i < 0) return null;
    var d = i + desde.length, j = -1;
    for (var k = 0; k < hasta.length; k++) {
      var p = txt.indexOf(hasta[k], d);
      if (p > 0 && (j < 0 || p < j)) j = p;
    }
    return limpio(txt.slice(d, j > 0 ? j : d + 1500));
  }

  // ---------- memoria de lo ya enviado ----------
  function vistos() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || '[]'); } catch (e) { return []; }
  }
  function recordar(ids) {
    try {
      var todos = vistos().concat(ids);
      // Se conservan los últimos 3000 para no crecer sin límite.
      localStorage.setItem(CLAVE, JSON.stringify(todos.slice(-3000)));
    } catch (e) { /* modo incógnito o storage lleno: no es crítico */ }
  }

  // ---------- panel en pantalla ----------
  var panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;' +
    'background:#0f172a;color:#f8fafc;font:13px/1.5 system-ui,sans-serif;padding:14px 16px;' +
    'border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.45)';
  document.body.appendChild(panel);
  // POR QUÉ NADA DE innerHTML AQUÍ:
  // Facebook aplica Trusted Types (require-trusted-types-for 'script'). Chrome
  // deja que un bookmarklet se EJECUTE pese al CSP, pero la asignación a
  // innerHTML es un "sink" prohibido y lanza TypeError. El síntoma era
  // desconcertante: el panel aparecía en el DOM —crearlo y darle estilo sí se
  // puede— pero vacío, y al usuario "no le pasaba nada" al pulsar Captar.
  //
  // Construir los nodos a mano no es un sink, así que funciona en Facebook, en
  // Mercado Libre y en cualquier sitio con la política estricta.
  //
  // OJO al probar: una extensión (o la consola de DevTools) corre en contexto
  // privilegiado y está EXENTA de Trusted Types. Probar el bookmarklet desde
  // ahí da un falso positivo — ya pasó. Hay que probarlo pulsando el marcador.
  function nodo(tag, css, texto) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (texto != null) e.textContent = texto;
    return e;
  }
  var CSS_BOTON = 'width:100%;padding:8px;border:0;border-radius:8px;background:#00abd8;' +
    'color:#fff;font-weight:700;cursor:pointer;margin-top:8px';
  var CSS_BOTON_2 = 'width:100%;margin-top:6px;padding:6px;border:0;border-radius:8px;' +
    'background:transparent;color:#94a3b8;cursor:pointer';
  var CSS_SUAVE = 'opacity:.75;margin:6px 0 2px';
  function boton(texto, css, alPulsar) {
    var b = nodo('button', css || CSS_BOTON, texto);
    b.onclick = alPulsar;
    return b;
  }
  /** Vacía el panel y le cuelga los nodos (o textos) que se le pasen. */
  function pinta() {
    panel.textContent = '';
    for (var i = 0; i < arguments.length; i++) {
      var x = arguments[i];
      if (x == null || x === false) continue;
      panel.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
    }
    panel.appendChild(nodo('div', 'opacity:.35;font-size:11px;margin-top:8px;text-align:right',
      'Captar ' + VERSION));
  }
  function cerrar() { if (panel.parentNode) panel.parentNode.removeChild(panel); }

  var url = location.href;
  var esFB = /facebook\.com/.test(location.hostname);
  var esML = /mercadolibre\.com/.test(location.hostname);

  // ---------- extracción de una publicación (modo preciso) ----------
  function capturarPublicacion() {
    var t = document.body.innerText;
    if (esFB) {
      // El contador de notificaciones puede venir como "(20+)", no solo "(20)".
      var titulo = limpio(document.title
        .replace(/^\(\d+\+?\)\s*/, '').replace(/\s*\|\s*Facebook\s*$/, '').replace(/^Marketplace\s*[-–]\s*/, ''));
      var desc = bloque(t, 'Descripción', ['Ver más', 'Publicidad', 'Información del vendedor']);
      var vend = bloque(t, 'Detalles del vendedor', ['Reporta esta publicación', 'Envía un mensaje']);
      // Ubicación: SOLO encabezados propios de la publicación. NO usar el
      // marcador suelto "Ubicación": en Marketplace también titula el filtro
      // de la barra lateral (la búsqueda del usuario), y guardaría la ciudad
      // equivocada en el prospecto.
      // Perfil del vendedor: es el ÚNICO camino real de contacto en Facebook
      // (no hay teléfono nunca). Antes aquí se guardaba la URL del propio
      // anuncio, así que el botón "Abrir perfil" de la bandeja no llevaba al
      // vendedor: reabría el anuncio.
      var perfil = null;
      var enlaces = document.querySelectorAll('a[href*="/marketplace/profile/"], a[href*="/profile.php?id="]');
      for (var pi = 0; pi < enlaces.length && !perfil; pi++) {
        var h = enlaces[pi].href;
        if (!h || h.indexOf('/marketplace/item/') >= 0) continue;
        // OJO: en /profile.php la identidad va en ?id=, así que cortar por "?"
        // deja un enlace a ninguna parte. Se conserva SOLO ese parámetro.
        var mid = h.match(/[?&]id=(\d+)/);
        perfil = mid
          ? h.split('?')[0] + '?id=' + mid[1]
          : h.split('?')[0].replace(/\/$/, '');
      }

      var ciudad = null, marcas = ['Ubicación de la vivienda', 'Ubicación del alquiler', 'Ubicación de la propiedad'];
      for (var mi = 0; mi < marcas.length && !ciudad; mi++) {
        ciudad = bloque(t, marcas[mi], ['La ubicación es aproximada', 'Descripción', 'Publicidad']);
      }
      if (ciudad && ciudad.length > 60) ciudad = null;
      return [{
        url: location.origin + location.pathname,
        // null si no se encontró: mejor sin botón que con un botón que miente.
        contacto_perfil: perfil,
        titulo: titulo,
        precio: num((t.match(/\$\s?[\d.,]{4,}/) || [])[0]),
        ciudad: ciudad || null,
        // Nombre y reputación del vendedor son la mejor señal de si es dueño
        // directo o un profesional: van dentro de la descripción.
        descripcion: (desc || '') + (vend ? '\n[Vendedor en Facebook Marketplace: ' + vend + ']' : ''),
        contacto_nombre: vend ? limpio(vend.split(/\s+(?:\(|Se unió)/)[0]) : null
      }];
    }
    var h1 = document.querySelector('h1');
    return [{
      url: url.split('?')[0],
      titulo: limpio(h1 ? h1.innerText : document.title),
      precio: num((t.match(/\$\s?[\d.,]{4,}/) || [])[0]),
      descripcion: bloque(t, 'Descripción', ['Preguntas', 'Publicaciones', 'Opiniones']),
      // ML rotula "Información del particular" cuando es dueño directo
      fuente_marca_dueno_directo: /Información del particular/i.test(t) || /\/directo\//.test(url)
    }];
  }

  // ---------- extracción de la lista de resultados ----------
  // Sube desde el enlace al ancestro más pequeño que ya parezca una tarjeta.
  // Buscar `li` o `.andes-card` sirve en Mercado Libre pero NO en Facebook,
  // donde el padre directo suele venir sin texto: así se perdía un tercio de
  // los anuncios (19 de 30 en una prueba real).
  function contenedor(a) {
    var n = a;
    for (var i = 0; i < 7 && n; i++) {
      var t = limpio(n.innerText || '');
      if (t.length > 600) break;                                  // ya es el grid entero
      if (/\$\s?[\d.,]{3,}/.test(t) || t.length > 25) return n;    // parece una tarjeta
      n = n.parentElement;
    }
    return null;
  }

  function tarjetasVisibles() {
    var sel = esFB ? 'a[href*="/marketplace/item/"]' : 'a[href*="/MCO-"]';
    var out = [], yaEnEstaPasada = {};
    var enlaces = document.querySelectorAll(sel);
    for (var i = 0; i < enlaces.length; i++) {
      var a = enlaces[i], href = a.getAttribute('href') || '';
      var id = esFB ? (href.match(/item\/(\d+)/) || [])[1] : (href.match(/MCO-?(\d+)/) || [])[1];
      if (!id || yaEnEstaPasada[id]) continue;

      var titulo = null, precio = null, ciudad = null, txt = '';

      // Facebook publica la ficha ya estructurada en el aria-label del enlace:
      // "Título, $ 1.300.000, Medellín, publicación 250426…". Es mucho más
      // fiable que parsear el texto, donde el precio va ANTES del título
      // (al revés que en Mercado Libre) y romperia un split por '$'.
      if (esFB) {
        // El aria-label tiene DOS formas:
        //   "titulo, $ precio, ciudad, publicación N"
        //   "titulo, $ precio, reducido de $ anterior, ciudad, publicación N"
        // Por eso no se toma "lo que va después del precio" como ciudad: en los
        // anuncios rebajados eso capturaba "reducido de $ 1.700.000, Bello".
        // La ciudad es SIEMPRE el último trozo, así que se lee desde el final.
        var etiqueta = limpio(a.getAttribute('aria-label') || '')
          .replace(/,\s*publicaci[óo]n\s*\d+\s*$/i, '');
        if (etiqueta) {
          var trozos = etiqueta.split(',');
          if (trozos.length >= 3) {
            ciudad = limpio(trozos[trozos.length - 1]) || null;
            var iPrecio = etiqueta.search(/,\s*\$\s?[\d.,]+/);
            if (iPrecio > 0) {
              titulo = limpio(etiqueta.slice(0, iPrecio));
              precio = num((etiqueta.match(/\$\s?[\d.,]+/) || [])[0]);
            }
          }
        }
      }

      var card = contenedor(a);
      if (card) txt = limpio(card.innerText);
      if (!titulo && !txt) continue;
      yaEnEstaPasada[id] = 1;

      if (!titulo) {
        titulo = limpio(txt.replace(/^.*?en (venta|arriendo|alquiler)\s*/i, '').split('$')[0]) || txt.slice(0, 90);
      }
      if (precio == null) precio = num((txt.match(/\$\s?[\d.,]{4,}/) || [])[0]);

      out.push({
        _id: id,
        url: a.href.split('?')[0],
        contacto_perfil: esFB ? a.href.split('?')[0] : null,
        titulo: titulo,
        precio: precio,
        // OJO en Facebook: esta ciudad es la del vendedor/búsqueda y a veces no
        // coincide con la del inmueble (hay anuncios "EN BELLO" rotulados
        // Medellín). El calificador la contrasta con el título.
        ciudad: ciudad,
        habitaciones: num((txt.match(/(\d+)\s*(?:habitaci|alcoba|hab\b)/i) || [])[1]),
        banos: num((txt.match(/(\d+)\s*ba[ñn]o/i) || [])[1]),
        area_m2: num((txt.match(/(\d+)\s*m²/) || [])[1]),
        fuente_marca_dueno_directo: /\/directo\//.test(url) || null
      });
    }
    return out;
  }

  // Baja la página varias veces para que carguen más resultados (Marketplace y
  // ML cargan por scroll). Se detiene cuando deja de aparecer contenido nuevo.
  async function cargarMas() {
    var previos = tarjetasVisibles().length;
    for (var p = 0; p < PASADAS_SCROLL; p++) {
      pinta(nodo('b', '', 'Buscando…'),
        nodo('div', 'opacity:.75;margin-top:4px',
          previos + ' anuncios cargados · pasada ' + (p + 1) + '/' + PASADAS_SCROLL));
      window.scrollTo(0, document.body.scrollHeight);
      await esperar(1400);
      var ahora = tarjetasVisibles().length;
      if (ahora <= previos) break; // ya no carga más
      previos = ahora;
    }
    window.scrollTo(0, 0);
    return tarjetasVisibles();
  }

  // ---------- enviar ----------
  function enviar(anuncios, ids, destino) {
    var payload = encodeURIComponent(JSON.stringify({ anuncios: anuncios }));
    if (payload.length > 1500000) { alert('Demasiados datos de una vez. Reduce la tanda.'); return; }
    // window.open debe dispararse desde el clic del usuario (si no, el bloqueador
    // de ventanas emergentes lo corta), por eso esto va dentro del botón.
    var w = window.open((destino || APP_IMPORTAR) + '#' + payload, '_blank');
    if (!w) { alert('El navegador bloqueó la ventana. Permite ventanas emergentes para este sitio.'); return; }
    recordar(ids);
    cerrar();
  }

  // ---------- flujo ----------
  //
  // TODO va dentro de un try/catch que PINTA el error. Sin esto, cualquier
  // excepción dejaba el panel creado pero vacío y el síntoma para quien lo usa
  // era "no pasa nada" — imposible de diagnosticar sin abrir DevTools. Pasó de
  // verdad con Trusted Types bloqueando innerHTML.
  (async function () {
   try {
    var enPublicacion = (esFB && /\/marketplace\/item\//.test(location.pathname)) ||
                        (esML && /MCO-?\d{6,}/.test(url));

    if (enPublicacion) {
      var uno = capturarPublicacion();
      pinta(nodo('b', '', '1 anuncio listo'),
        nodo('div', 'opacity:.75;margin:6px 0 4px', (uno[0].titulo || '').slice(0, 70)),
        boton('Enviar a la bandeja', CSS_BOTON, function () { enviar(uno, [], APP_IMPORTAR); }));
      return;
    }

    // Lista de resultados
    var todas = await cargarMas();
    var ya = {}; vistos().forEach(function (id) { ya[id] = 1; });
    var sinRepetir = todas.filter(function (x) { return !ya[x._id]; });
    var repetidas = todas.length - sinRepetir.length;
    // Se apartan los de municipios que no son zona. No se marcan como "vistos":
    // no cuestan nada (ni modelo ni base de datos) y recordarlos crearía un
    // estado invisible que estorbaría si algún día se amplía la zona.
    var nuevas = sinRepetir.filter(function (x) { return !estaFueraDeZona(x.ciudad); });
    var fuera = sinRepetir.length - nuevas.length;

    if (!todas.length) {
      pinta(nodo('b', '', 'No encontré anuncios'),
        nodo('div', 'opacity:.75;margin-top:6px',
          'Abre una búsqueda de Marketplace o Mercado Libre, o una publicación.'));
      setTimeout(cerrar, 4000);
      return;
    }

    if (!nuevas.length && fuera) {
      pinta(nodo('b', '', 'Nada dentro de la zona'),
        nodo('div', 'opacity:.75;margin:6px 0 8px',
          fuera + ' anuncio(s) nuevos, todos de municipios fuera de Bello y Robledo.'),
        nodo('div', 'opacity:.75',
          'Baja el radio en los filtros de la izquierda: ubicación Bello, radio 10 km.'));
      setTimeout(cerrar, 9000);
      return;
    }
    if (!nuevas.length) {
      pinta(nodo('b', '', 'Nada nuevo por acá'),
        nodo('div', 'opacity:.75;margin:6px 0 4px',
          'Los ' + todas.length + ' anuncios de esta búsqueda ya se enviaron antes.'),
        boton('Olvidar el historial y capturarlos otra vez',
          'width:100%;padding:8px;border:0;border-radius:8px;background:#334155;color:#fff;cursor:pointer;margin-top:8px',
          function () {
            try { localStorage.removeItem(CLAVE); } catch (e) {}
            pinta(nodo('b', '', 'Historial borrado.'),
              nodo('div', 'opacity:.75;margin-top:6px', 'Vuelve a hacer clic en Captar.'));
            setTimeout(cerrar, 2500);
          }));
      return;
    }

    // A DÓNDE VA UNA LISTA DE RESULTADOS
    // Mercado Libre → directo a la bandeja: procesarAnuncios completa la
    //   descripción por API (/items/{id}/description), así que hay material
    //   real para calificar sin abrir nada.
    // Facebook → a la cola: Meta no expone ninguna API equivalente, y sin
    //   descripción el calificador no puede distinguir dueño de agencia. Se
    //   comprobó con datos reales: 33 filas capturadas así salieron TODAS con
    //   el mismo score 0.85 y probabilidad 0.5, y ninguna era accionable.
    var aLaCola = esFB;
    var destino = aLaCola ? APP_COLA : APP_IMPORTAR;

    var tanda = nuevas.slice(0, POR_TANDA);
    var restan = nuevas.length - tanda.length;
    var ids = tanda.map(function (x) { return x._id; });
    var limpias = tanda.map(function (x) {
      if (aLaCola) {
        // Solo lo justo para reconocerlo en la lista de trabajo. El resto de
        // datos se toma al abrir la publicación, que es cuando son fiables.
        return { url: x.url, titulo: x.titulo, precio: x.precio };
      }
      var c = {}; for (var k in x) if (k !== '_id') c[k] = x[k]; return c;
    });

    var resumen = nodo('div', CSS_SUAVE,
      todas.length + ' en la búsqueda · ' + repetidas + ' ya enviados antes');
    if (fuera) {
      resumen.appendChild(document.createTextNode(' · '));
      resumen.appendChild(nodo('span', 'color:#fbbf24', fuera + ' fuera de zona'));
    }
    pinta(nodo('b', '', tanda.length + ' anuncios nuevos'),
      resumen,
      restan ? nodo('div', 'opacity:.75', 'Quedan ' + restan + ' para el siguiente clic') : null,
      boton(aLaCola ? 'Mandar ' + tanda.length + ' a la cola' : 'Enviar ' + tanda.length + ' a la bandeja',
        CSS_BOTON, function () { enviar(limpias, ids, destino); }),
      boton('Cancelar', CSS_BOTON_2, cerrar));
   } catch (e) {
    pinta(nodo('b', 'color:#fca5a5', 'Algo falló al recolectar'),
      nodo('div', 'opacity:.8;margin-top:6px;word-break:break-word', String(e && e.message || e)),
      nodo('div', 'opacity:.6;margin-top:8px;font-size:11px',
        'Copia este mensaje y repórtalo. El panel ya no se queda en blanco.'),
      boton('Cerrar', CSS_BOTON_2, cerrar));
   }
  })();
})();
