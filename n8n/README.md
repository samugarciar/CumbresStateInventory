# n8n — Alertas de portales → Agente de captaciones

Flujo de **descubrimiento desatendido**: los portales inmobiliarios envían por correo
los anuncios nuevos de una búsqueda guardada; n8n reenvía ese correo **crudo** a la
app, y la app extrae los anuncios, los califica y los deja en `/captaciones`.

```
Búsqueda guardada en el portal → correo "nuevos anuncios"
   → n8n (trigger de correo) → POST /api/agentes/captaciones/intake-email
   → la app extrae los anuncios → grafo (califica, deduplica, redacta) → bandeja
```

**No se raspa ninguna página**: los datos vienen en el correo que el portal envía.
Es la única vía de descubrimiento realmente desatendida y sin fricción de términos.

> **n8n queda "tonto" a propósito.** Solo hace de cartero. Toda la lógica (qué es un
> anuncio, si es dueño directo, qué mensaje escribir) vive en el repo, versionada y
> testeable. Si mañana cambia el criterio, se cambia en el código, no en el workflow.

---

## 1. Variable de entorno en Vercel

El endpoint exige la cabecera `x-webhook-token`. Genera un token y guárdalo:

```bash
openssl rand -hex 32
```

- **Vercel** → Project → Settings → Environment Variables → `CAPTACIONES_WEBHOOK_TOKEN` (Production) → **redespliega**.
- **n8n** → Settings → Variables (o variable de entorno del contenedor) → `CAPTACIONES_WEBHOOK_TOKEN`, el mismo valor.

> Si tu n8n no soporta `$env`, reemplaza en el nodo HTTP el valor
> `={{ $env.CAPTACIONES_WEBHOOK_TOKEN }}` por el token literal, o usa una
> credencial **Header Auth** (mismo patrón que los otros webhooks del proyecto).

## 2. Búsquedas guardadas en los portales

Crea una búsqueda por zona y **actívale la alerta por correo**:

| Portal | Cómo |
|---|---|
| **Mercado Libre** | Filtra `Apartamentos · Arriendo · Bello` (y otra para `Robledo`) **+ filtro "Dueño directo"** → botón **“Guardar esta búsqueda”**. La URL con filtro es `.../inmuebles/apartamentos/arriendo/antioquia/bello/directo/` |
| **FincaRaíz** | Busca apartamentos en arriendo en Bello / Robledo → **“Guardar búsqueda”** y activa el aviso |
| **Metrocuadrado** | Misma idea: guardar la búsqueda con alerta |
| **Ciencuadras / Properati** | Igual, si los usas |

Que todas las alertas lleguen al **mismo buzón** (idealmente una etiqueta/carpeta
dedicada, p. ej. `captaciones`).

> Facebook Marketplace **no manda alertas por correo**: esa fuente sigue por
> recorrido supervisado del navegador.

## 3. Importar el workflow

`captaciones-alertas-portales.json` → en n8n: **Workflows → Import from File**.

Cuatro nodos:

1. **Alertas de portales (Gmail)** — revisa cada 15 min los correos de los portales.
   Ajusta el filtro `q` (remitentes) o cámbialo por una etiqueta.
2. **Enviar el correo al agente** — `POST` a `/api/agentes/captaciones/intake-email`
   con `{ asunto, html, texto, from }`.
3. **¿Entraron prospectos?** — corta si el correo no era una alerta (`creados: 0`).
4. **Avisar que hay prospectos** — correo de aviso. **Cambia el destinatario**
   (`CAMBIAR@tu-correo.com`) o reemplázalo por Slack/WhatsApp.

### Si el buzón no es Gmail

Usa **Email Trigger (IMAP)** en vez del trigger de Gmail y ajusta el mapeo del
nodo HTTP, que cambia según el nodo:

| Campo del POST | Gmail Trigger | Email Trigger (IMAP) |
|---|---|---|
| `asunto` | `$json.subject` | `$json.subject` |
| `html` | `$json.html` | `$json.textHtml` |
| `texto` | `$json.text` | `$json.textPlain` |
| `from` | `$json.from` | `$json.from` |

El JSON importado ya intenta ambos (`$json.html || $json.textHtml`), así que en
general funciona sin tocar nada.

## 4. Probar sin esperar un correo real

```bash
curl -s -X POST https://cumbres-state-inventory.vercel.app/api/agentes/captaciones/intake-email \
  -H 'content-type: application/json' \
  -H "x-webhook-token: $CAPTACIONES_WEBHOOK_TOKEN" \
  -d '{"asunto":"Prueba de alerta","html":"<a href=\"https://ejemplo.com/PRUEBA-N8N-1\">Apartamento en arriendo en Bello</a><p>$ 1.800.000 · 55 m² · 3 habitaciones</p><p>Arriendo directamente, sin intermediarios. 3001112233</p>"}'
```

Respuesta esperada: `{"estado":"ok","es_alerta":true,"anuncios_detectados":1,"creados":1,...}`.
Después **borra el prospecto de prueba** desde `/captaciones` (botón Descartar).

## Qué esperar

- **Tope de 25 anuncios por correo**; si llegan más, la respuesta lo dice en
  `recortados` / `aviso_recorte` (nunca se recorta en silencio).
- Los correos que no son alertas se ignoran (`es_alerta: false`), no ensucian nada.
- El dedup evita que el mismo anuncio entre dos veces aunque llegue en varias alertas.
- Si el agente está **pausado** en `/agentes`, el endpoint responde `409` y no procesa.
- **Los correos de alerta casi nunca traen el teléfono**: los prospectos entran sin
  número y hay que pegarlo en la bandeja (en Mercado Libre está detrás de un
  reCAPTCHA, no se puede automatizar).
