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
| **Una lista de resultados** (búsqueda con filtros) | Captura las visibles (hasta 25): título, precio, habitaciones, m² → modo rápido |

Al hacer clic se abre una pestaña en `/captaciones/importar` con lo recolectado.
Revisas y confirmas; el agente califica, descarta lo que no encaja y redacta el
mensaje de los que sirven.

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
- **Tope de 25 anuncios** por clic en modo lista.

## Mantenimiento

`captar-bookmarklet.js` es la fuente legible. Para regenerar la URL tras editarlo:

```bash
node -e '
const fs=require("fs");
const src=fs.readFileSync("herramientas/captar-bookmarklet.js","utf8");
const codigo=src.replace(/^\/\*\*[\s\S]*?\*\/\s*/,"").split("\n").filter(l=>!/^\s*\/\//.test(l)&&l.trim()!=="").join("\n");
new Function(codigo);   // valida la sintaxis ANTES de generar
fs.writeFileSync("herramientas/captar-bookmarklet.url.txt","javascript:"+encodeURIComponent(codigo));
console.log("ok");
'
```

> El minificado solo quita comentarios de **línea completa**. No intentes quitar
> comentarios en medio de una línea: un `//` dentro de una expresión regular
> (p. ej. `/\/marketplace\/item\//`) rompe el código — ya pasó una vez, por eso
> el `new Function()` valida antes de escribir el archivo.
