// Intake por LOTE: recibe varios anuncios ya extraídos y los pasa por el grafo.
//
// Lo usa el recorrido de navegador supervisado (Claude-in-Chrome): la sesión
// abre Facebook Marketplace / Mercado Libre con los filtros del usuario, lee
// los anuncios (título, precio, zona, descripción y vendedor) y los manda aquí
// en un solo POST. También sirve para cualquier automatización que ya tenga los
// datos.
//
// OJO con Facebook: el título NO alcanza para saber si es dueño directo — hay
// anuncios de agencia con títulos neutros y solo la descripción lo revela. Por
// eso quien recorre debe abrir cada publicación y mandar la `descripcion`.
// Facebook tampoco expone teléfono: se manda `contacto_perfil` con el enlace de
// la publicación, y el contacto se hace por Messenger desde la bandeja.
//
// Auth: sesión de admin o cabecera x-webhook-token (CAPTACIONES_WEBHOOK_TOKEN).
//
// POST body: { anuncios: AnuncioEntrante[], inmobiliaria_id? }

import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { procesarAnuncios, type AnuncioEntrante } from '@/lib/agente-captaciones/procesar';

export const maxDuration = 300;

// Tope por petición: cada anuncio son 2 llamadas al LLM y hay que caber en
// maxDuration. Si llegan más, se procesan los primeros y se reporta el resto.
const MAX_POR_LOTE = 25;

export async function POST(request: Request) {
  const token = request.headers.get('x-webhook-token');
  const tokenEsperado = process.env.CAPTACIONES_WEBHOOK_TOKEN;
  const porToken = Boolean(token && tokenEsperado && token === tokenEsperado);

  let inmobiliariaId: string | undefined;
  if (!porToken) {
    const user = await getCurrentUser();
    if (!user?.profile || user.profile.rol !== 'admin') {
      return Response.json({ estado: 'error', error: 'No autorizado' }, { status: 401 });
    }
    inmobiliariaId = user.profile.inmobiliaria_id;
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ estado: 'error', error: 'Falta configurar OPENAI_API_KEY' }, { status: 500 });
  }

  const cuerpo = (await request.json().catch(() => null)) as
    | { anuncios?: AnuncioEntrante[]; inmobiliaria_id?: string }
    | null;
  if (!cuerpo || !Array.isArray(cuerpo.anuncios) || cuerpo.anuncios.length === 0) {
    return Response.json({ estado: 'error', error: 'Manda un arreglo `anuncios` con al menos uno.' }, { status: 400 });
  }

  inmobiliariaId = inmobiliariaId || cuerpo.inmobiliaria_id || process.env.CUMBRES_INMOBILIARIA_ID;
  if (!inmobiliariaId) {
    return Response.json({ estado: 'error', error: 'Falta inmobiliaria_id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Kill switch: sin fila = activo
  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();
  if (config && !config.activo) {
    return Response.json({ estado: 'pausado', error: 'El agente de captaciones está pausado.' }, { status: 409 });
  }

  const recibidos = cuerpo.anuncios.length;
  const aProcesar = cuerpo.anuncios.slice(0, MAX_POR_LOTE);

  try {
    const resumen = await procesarAnuncios(supabase, inmobiliariaId, aProcesar);
    const recortados = recibidos - aProcesar.length;
    return Response.json({
      estado: 'ok',
      recibidos,
      // Nunca truncar en silencio.
      recortados,
      aviso_recorte:
        recortados > 0 ? `Solo se procesaron ${MAX_POR_LOTE}; ${recortados} quedaron sin procesar.` : undefined,
      ...resumen,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Captaciones/lote] Error:', msg);
    return Response.json({ estado: 'error', error: msg }, { status: 500 });
  }
}
