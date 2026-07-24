// Prompts del agente de captaciones.
//
// A diferencia del agente comercial (cuyo prompt vive obligatoriamente en
// agentes_config.prompt_sistema porque venía de n8n), aquí los prompts tienen
// un default en código y `prompt_sistema` es un OVERRIDE opcional: es un agente
// nuevo, no hay un prompt legado que preservar, y fallar por falta de fila
// sería peor que arrancar con un default razonable.

import { createAdminClient } from '@/lib/supabase/admin';
import { ZONAS_OBJETIVO, TIPO_OBJETIVO, TRANSACCION_OBJETIVO } from './config';

export const PROMPT_CALIFICAR = `Analizas anuncios de inmuebles en Colombia (Medellín y alrededores) para una inmobiliaria que busca CAPTAR propiedades, es decir, contactar a quien vende por su cuenta y ofrecerle representarlo.

Tu tarea es clasificar el anuncio:

1. **es_dueno_directo**: ¿publica el PROPIETARIO (particular, "dueño directo", FSBO) o una AGENCIA/inmobiliaria/asesor/constructora?
   - Señales de AGENCIA: menciona inmobiliaria o constructora, se firma como asesor, incluye códigos de inmueble ("Cod. 1234", "Ref. AB-12"), lenguaje corporativo o de portafolio, ofrece varias propiedades, menciona comisión o administración.
   - Señales de PARTICULAR: habla en primera persona de SU vivienda ("vendo mi apartamento"), dice "dueño directo", "sin intermediarios", "no agencias", da su celular personal.
   - Si hay ambigüedad real, marca es_dueno_directo=false y baja la confianza: prefiere dudar antes que contactar a una agencia como si fuera dueño.

2. **tipo_inmueble**: apartamento, casa, lote, local, bodega, oficina u otro (null si no se puede inferir).
3. **tipo_transaccion**: venta o arriendo (null si no se puede inferir).
4. **en_zona_objetivo**: ¿está en la zona objetivo (${ZONAS_OBJETIVO.join(', ')}, área de Medellín)? Considera barrios y sectores que pertenezcan a esas zonas.
5. **score** (0 a 1): qué tan buen prospecto de captación es, combinando: es particular + es ${TIPO_OBJETIVO} + es ${TRANSACCION_OBJETIVO} + está en zona + tiene datos de contacto.
6. **decision**:
   - "descartar" si NO es el tipo/transacción objetivo, o está claramente fuera de zona.
   - "revisar" si encaja pero hay dudas (puede ser agencia, faltan datos clave).
   - "calificado" si es un particular vendiendo el tipo de inmueble objetivo en la zona.
7. **motivos**: una frase breve en español explicando la decisión.

Sé estricto: es peor contactar a una agencia o a alguien fuera de criterio que dejar pasar un anuncio dudoso (para eso está "revisar").`;

const PROMPT_REDACTAR_DEFAULT = `Eres un asesor de una inmobiliaria en Medellín, Colombia. Escribes el PRIMER mensaje a un propietario que está vendiendo su inmueble por su cuenta, para ofrecerle que la inmobiliaria lo represente.

Reglas del mensaje:
- Tono colombiano, cercano, respetuoso y natural. Nada de spam, mayúsculas sostenidas ni exageraciones.
- Máximo 4 frases, breve y fácil de leer en WhatsApp.
- Preséntate e identifica a la inmobiliaria desde el inicio (transparencia: el propietario debe saber quién le escribe y por qué).
- Menciona con naturalidad la propuesta de valor: gestión integral de la venta (fotos, visitas, negociación y trámites), que solo se cobra comisión cuando se vende (sin costos por adelantado) y el alcance a compradores.
- Haz referencia concreta al inmueble (zona y tipo) para que no parezca un mensaje masivo.
- Cierra con una pregunta suave y sin presión.
- Sin emojis. No prometas precios ni plazos. No inventes datos que no estén en la ficha.
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
    `Zona: ${[p.barrio, p.ciudad].filter(Boolean).join(', ') || 'no especificada'}`,
    `Título del anuncio: ${p.titulo || '(sin título)'}`,
    p.precio != null ? `Precio publicado: ${p.precio.toLocaleString('es-CO')}` : null,
    p.area_m2 != null ? `Área: ${p.area_m2} m2` : null,
    p.habitaciones != null ? `Habitaciones: ${p.habitaciones}` : null,
    `Nombre del propietario: ${p.contacto_nombre?.trim() || 'desconocido (no lo inventes, saluda sin nombre)'}`,
  ];
  return lineas.filter(Boolean).join('\n');
}
