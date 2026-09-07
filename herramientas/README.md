# Bookmarklet "Captar"

Botón para la barra de marcadores que recolecta anuncios desde el navegador y
los manda a la bandeja de `/captaciones`.

## Por qué esto y no un scraper en el servidor

Un navegador headless (Playwright) corriendo en Vercel **no funciona**: Mercado
Libre y Meta bloquean IPs de datacenter. Hacerlo funcionar exigiría proxies
residenciales y falsificación de huella — la capa de evasión que este proyecto
no construye. Esto corre en el navegador del asesor, con su sesión, cuando él
lo decide: no hay nada que evadir.

**Por qué abre una pestaña en vez de hacer `fetch`:** Facebook y Mercado Libre
tienen CSP estricta y bloquearían una petición hacia esta app desde sus páginas.
Navegar no lo bloquea nadie. Además así se usa la **sesión de admin** en lugar
de dejar un token dentro del marcador.

## Instalar

1. Muestra la barra de marcadores (`⌘⇧B` en Mac).
2. Crea un marcador nuevo: clic derecho en la barra → **Añadir página**.
3. **Nombre**: `Captar`
4. **URL**: pega **todo** el contenido de [`captar-bookmarklet.url.txt`](captar-bookmarklet.url.txt).

> Es autocontenido: para actualizarlo hay que volver a pegar la URL.

## Usar

| Dónde estás | Qué hace |
|---|---|
| **Una publicación** de Facebook Marketplace o Mercado Libre | Captura **esa**, con descripción y vendedor → modo preciso |
| **Una lista de resultados** | **Baja la página cargando más resultados**, y captura en tandas de 25 **sin repetir** lo ya enviado |

Aparece un panel abajo a la derecha con lo que encontró y un botón para enviar.
Al confirmar se abre `/captaciones/importar`; revisas y el agente califica,
descarta lo que no encaja y redacta el mensaje de los que sirven — mostrándote
**qué tan seguro está** de si es dueño directo o agencia.

### Es iterativo: haz clic varias veces

Cada anuncio enviado queda anotado en el `localStorage` del sitio. En la
siguiente pasada se saltan los ya enviados, así que **hacer clic de nuevo avanza
por el inventario** en vez de recapturar lo mismo:

```
clic 1 → "25 nuevos · quedan 18 para el siguiente clic"
clic 2 → "18 nuevos · 25 ya enviados antes"
clic 3 → "Nada nuevo por acá"   ← con botón para olvidar el historial
```

El servidor igual deduplica, pero sin esta memoria se gastaba LLM de más y la
vista previa salía llena de repetidos.

### Cuál modo usar

- **Facebook → modo preciso.** El título engaña: ya hubo un anuncio de agencia
  con título neutro que solo la descripción delataba. Vale la pena abrir cada
  publicación.
- **Mercado Libre → lista con el filtro `/directo/`.** Ahí el portal ya certifica
  que es dueño directo (el bookmarklet lo detecta por la URL y lo marca), así
  que el modo rápido basta.

## Límites

- **No es autónomo**: hay que abrir la página y hacer clic. No hay nada corriendo solo.
- **No trae el teléfono**: en Mercado Libre está detrás de un reCAPTCHA y en
  Facebook no se expone. Se pega a mano en la bandeja.
- **Tope de 25 anuncios** por clic (el servidor también corta ahí).
- **La ciudad de Facebook no es de fiar**: el `aria-label` trae la del vendedor o
  la de la búsqueda, no siempre la del inmueble (hay anuncios titulados
  *"¡EN BELLO!"* rotulados como Medellín). El calificador la contrasta con el
  título y la descripción.
- **Desde la lista no hay descripción**, y en Facebook el título engaña. Para
  anuncios que importen, ábrelos y usa el modo preciso.

## Detalles de implementación que costaron una prueba

- **Detección de tarjeta**: buscar `li` o `.andes-card` funciona en Mercado Libre
  pero **no en Facebook** (el padre del enlace viene sin texto): así se perdía un
  tercio de los anuncios — 19 de 30 en una prueba real. Ahora se sube por el DOM
  hasta el ancestro más pequeño que ya parezca tarjeta.
- **Título y precio en Facebook** salen del `aria-label` del enlace, que viene
  estructurado (`"Título, $ 1.300.000, Medellín, publicación 250426…"`). Parsear
  el texto fallaba porque ahí el precio va **antes** del título, al revés que en
  Mercado Libre.
- **El envío va en un botón**, no automático: `window.open` solo funciona dentro
  del gesto del usuario; tras el `await` del scroll el navegador lo bloquearía.

## Mantenimiento

`captar-bookmarklet.js` es la fuente legible. Tras editarlo, regenera la URL:

```bash
node herramientas/regenerar.js
```

Eso minifica, valida la sintaxis y **ejecuta el resultado contra un DOM
simulado** (una lista de resultados y una publicación), pulsando los botones que
pinta. Si algo revienta, **no escribe el `.url.txt`**.

> [!warning] Por qué la prueba de ejecución
> Una edición borró seis funciones auxiliares del archivo (`limpio`, `num`,
> `esperar`, `bloque`, `vistos`, `recordar`) y no lo notó nadie: `new Function()`
> valida la **sintaxis**, no las **referencias**. El `.url.txt` se generaba sin
> quejarse y el bookmarklet moría con `ReferenceError` al usarlo. Para quien lo
> usa el síntoma es un panel negro en blanco, imposible de diagnosticar sin
> DevTools.

> [!caution] No pruebes el bookmarklet desde la extensión del navegador
> Es un contexto **privilegiado**, exento del CSP de la página y de Trusted
> Types. Valida en un entorno más permisivo que el real y da falsos positivos:
> así se dio por bueno un bookmarklet que usaba `innerHTML` y que Facebook
> bloqueaba. Pruébalo pulsando el marcador de verdad, o simula el bloqueo.

Al cambiar el comportamiento del recolector, sube `VERSION` en el fuente: se
muestra en la esquina del panel y sirve para saber si el marcador instalado en
un navegador es el actual.

> El minificado solo quita comentarios de **línea completa**. No intentes quitar
> comentarios en medio de una línea: un `//` dentro de una expresión regular
> (p. ej. `/\/marketplace\/item\//`) rompe el código — ya pasó una vez.
