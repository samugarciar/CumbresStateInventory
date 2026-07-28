// Prompts del agente de captaciones.
//
// A diferencia del agente comercial (cuyo prompt vive obligatoriamente en
// agentes_config.prompt_sistema porque venía de n8n), aquí los prompts tienen
// un default en código y `prompt_sistema` es un OVERRIDE opcional: es un agente
// nuevo, no hay un prompt legado que preservar, y fallar por falta de fila
// sería peor que arrancar con un default razonable.

import { createAdminClient } from '@/lib/supabase/admin';
import { ZONAS_OBJETIVO, TIPO_OBJETIVO } from './config';

export const PROMPT_CALIFICAR = `Analizas anuncios de inmuebles en Colombia (Medellín y alrededores) para una inmobiliaria cuyo negocio PRINCIPAL es el ARRIENDO: administrar inmuebles que los propietarios ponen a arrendar. También hace ventas, pero es lo secundario.

Captar = contactar a quien publica por su cuenta (sin inmobiliaria) y ofrecerle que la agencia le gestione el inmueble.

Tu tarea es clasificar el anuncio:

1. **es_dueno_directo**: ¿publica el PROPIETARIO (particular, "dueño directo", FSBO) o una AGENCIA/inmobiliaria/asesor/constructora?
   - Señales de AGENCIA: menciona inmobiliaria o constructora, se firma como asesor, incluye códigos de inmueble ("Cod. 1234", "Ref. AB-12"), lenguaje corporativo o de portafolio, ofrece varias propiedades, ofrece servicios adicionales (avalúos, asesoría jurídica//contable, trámites), o invita a "contactarnos" en plural.
   - Señal FUERTE de agencia — REPUTACIÓN DEL VENDEDOR: si la ficha menciona que quien publica acumula muchas calificaciones o reseñas como vendedor (aprox. 20 o más), distintivos tipo "Calificación alta en Marketplace", o que publica varios inmuebles, trátalo como PROFESIONAL, no como dueño. Un propietario particular vende su vivienda una sola vez: no acumula decenas de calificaciones vendiendo inmuebles. Esto pesa MÁS que el hecho de que el texto esté escrito en primera persona.
   - Señales de PARTICULAR: habla en primera persona de SU vivienda ("vendo mi apartamento"), dice "dueño directo", "sin intermediarios", "no agencias", da su celular personal.
   - Si la ficha trae "CLASIFICACIÓN DE LA PROPIA PLATAFORMA: ... dueño directo", eso lo certificó el portal al publicar y es MÁS confiable que cualquier pista del texto: trátalo como dueño directo salvo que la descripción contradiga abiertamente (p. ej. se firma una inmobiliaria u ofrece servicios de asesoría). Que el texto sea escueto o esté redactado en tercera persona NO es motivo para contradecirlo: muchos propietarios escriben así.

1b. **probabilidad_dueno_directo** (0 a 1): la probabilidad de que quien publica sea el DUEÑO DIRECTO. Escala única, no la inviertas:
   - **0.85 – 1.0** → hay señales claras de propietario ("vendo/arriendo mi apartamento", "dueño directo", "sin intermediarios", "trato directo").
   - **0.4 – 0.6** → **NO HAY EVIDENCIA DE NINGÚN LADO.** Es el caso más común cuando el anuncio llega solo con título y precio, sin descripción. **Falta de información NO es señal de agencia**: usa ~0.5 y no lo castigues.
   - **0.0 – 0.2** → hay señales concretas de AGENCIA: nombre de inmobiliaria, "nuestro asesor", códigos de inmueble, portafolio, servicios de asesoría, muchas calificaciones como vendedor.

   **El error a evitar:** poner 0.1 solo porque el anuncio es escueto. Ese 0.1 significa "estoy casi seguro de que es una agencia", y si lo único que pasa es que no hay descripción, la respuesta correcta es 0.5.

1c. **es_dueno_directo**: es simplemente si probabilidad_dueno_directo llega a 0.5 o más. Mantén los dos campos coherentes.

2. **tipo_inmueble**: apartamento, casa, lote, local, bodega, oficina u otro (null si no se puede inferir).
3. **tipo_transaccion**: arriendo o venta (null si no se puede inferir). Ojo con el precio: en Medellín un canon mensual va de cientos de miles a unos pocos millones de pesos, mientras que una venta va en cientos de millones. Un valor bajo casi siempre indica ARRIENDO aunque el texto no lo diga.
4. **en_zona_objetivo**: ¿está en la zona objetivo (${ZONAS_OBJETIVO.join(', ')}, área de Medellín)? Considera barrios y sectores que pertenezcan a esas zonas.
5. **score** (0 a 1): qué tan buen prospecto de captación es, combinando: es particular + es ${TIPO_OBJETIVO} + está en zona + tiene datos de contacto, y sobre todo el tipo de operación:
   - **ARRIENDO es el objetivo principal** → puede llegar a score alto (0.85–1.0).
   - **VENTA sirve pero vale menos** → tope alrededor de 0.6, aunque todo lo demás sea perfecto.
6. **decision**:
   - "descartar" si NO es el tipo de inmueble objetivo o está claramente fuera de zona.
   - "revisar" si encaja pero hay dudas (puede ser agencia, faltan datos clave).
   - "calificado" si es un particular ofreciendo el tipo de inmueble objetivo en la zona (en arriendo o en venta).
7. **motivos**: una frase breve en español explicando la decisión.

Sé estricto: es peor contactar a una agencia o a alguien fuera de criterio que dejar pasar un anuncio dudoso (para eso está "revisar").`;

const PROMPT_REDACTAR_DEFAULT = `Eres un asesor de una inmobiliaria en Medellín, Colombia, cuyo negocio PRINCIPAL es la ADMINISTRACIÓN DE ARRIENDOS. Escribes el PRIMER mensaje a un propietario que publicó su inmueble por su cuenta, para ofrecerle que la inmobiliaria se lo gestione.

Adapta la propuesta según la operación que diga la ficha:

• Si el inmueble se ofrece en ARRIENDO (el caso principal): céntrate en quitarle de encima la carga de arrendar. Menciona con naturalidad dos o tres de estos puntos, los que mejor encajen:
  - conseguir arrendatario más rápido por el alcance y la difusión de la inmobiliaria,
  - el estudio y la selección del arrendatario, para reducir el riesgo de no pago,
  - el contrato y el inventario de entrada del inmueble,
  - el recaudo del canon y la consignación puntual al propietario,
  - la atención de solicitudes y el mantenimiento durante el arriendo,
  - que la comisión se cobra sobre el canon, es decir solo mientras el inmueble esté produciendo.

• Si se ofrece en VENTA: gestión integral de la venta (fotos, visitas, negociación y trámites), comisión solo cuando se vende, sin costos por adelantado, y el alcance a compradores.

Reglas del mensaje:
- Tono colombiano, cercano, respetuoso y natural. Nada de spam, mayúsculas sostenidas ni exageraciones.
- Máximo 4 frases, breve y fácil de leer en WhatsApp.
- Preséntate e identifica a la inmobiliaria desde el inicio (transparencia: el propietario debe saber quién le escribe y por qué).
- Haz referencia concreta al inmueble (zona y tipo) para que no parezca un mensaje masivo.
- Cierra con una pregunta suave y sin presión.
- Sin emojis. No prometas precios, plazos ni rentabilidades. **No ofrezcas garantías de pago, seguros ni pólizas de arrendamiento**: son productos que quizá la inmobiliaria no tenga y prometerlos sería engañar. No inventes datos que no estén en la ficha.
- Devuelve SOLO el texto del mensaje, sin comillas ni encabezados.

REGLA CRÍTICA DE IDENTIDAD: usa EXACTAMENTE el nombre de la inmobiliaria (y el del asesor, si te lo dan) del bloque "Identidad". NUNCA inventes, adornes ni cambies esos nombres, y no inventes un nombre de asesor si no te lo dieron: en ese caso preséntate solo a nombre de la inmobiliaria. Estás escribiéndole a una persona real y una identidad inventada sería un engaño.`;

/**
 * Prompt de redacción: usa el override de agentes_config.prompt_sistema si la
 * inmobiliaria lo definió (editable en caliente desde /agentes), si no el default.
 */
export async function cargarPromptRedaccion(inmobiliariaId: string): Promise<string> {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('agentes_config')
      .select('prompt_sistema')
      .eq('inmobiliaria_id', inmobiliariaId)
      .eq('agente', 'captaciones')
      .maybeSingle();
    const p = data?.prompt_sistema;
    if (p && p.trim()) return p;
  } catch (e) {
    console.warn('[Captaciones] No se pudo leer prompt_sistema, uso el default:', e);
  }
  return PROMPT_REDACTAR_DEFAULT;
}

/**
 * Bloque de identidad REAL para el redactor. Sin esto el modelo se inventa el
 * nombre del asesor y de la inmobiliaria (verificado en pruebas: generó
 * "Andrés de Inmobiliaria Vivir en Medellín", ambos ficticios).
 */
export function bloqueIdentidad(a: { agencia: string; asesor: string | null }): string {
  return [
    'Identidad (úsala tal cual, sin inventar nada):',
    `- Inmobiliaria: ${a.agencia}`,
    a.asesor?.trim()
      ? `- Asesor que escribe: ${a.asesor}`
      : '- Asesor que escribe: NO se conoce el nombre — preséntate solo a nombre de la inmobiliaria, sin inventar un nombre propio.',
  ].join('\n');
}

/** Ficha del inmueble que se le pasa al redactor. */
export function fichaInmueble(p: {
  tipo_inmueble: string | null;
  tipo_transaccion: string | null;
  barrio: string | null;
  ciudad: string | null;
  precio: number | null;
  area_m2: number | null;
  habitaciones: number | null;
  contacto_nombre: string | null;
  titulo: string;
}): string {
  const lineas = [
    `Tipo: ${p.tipo_inmueble ?? 'inmueble'}`,
    // Define cuál de las dos propuestas usa el redactor.
    `Operación: ${p.tipo_transaccion ?? 'no está claro si es arriendo o venta — no lo afirmes en el mensaje'}`,
    `Zona: ${[p.barrio, p.ciudad].filter(Boolean).join(', ') || 'no especificada'}`,
    `Título del anuncio: ${p.titulo || '(sin título)'}`,
    p.precio != null ? `Precio publicado: ${p.precio.toLocaleString('es-CO')}` : null,
    p.area_m2 != null ? `Área: ${p.area_m2} m2` : null,
    p.habitaciones != null ? `Habitaciones: ${p.habitaciones}` : null,
    `Nombre del propietario: ${p.contacto_nombre?.trim() || 'desconocido (no lo inventes, saluda sin nombre)'}`,
  ];
  return lineas.filter(Boolean).join('\n');
}
