import { createAdminClient } from '../../../../lib/supabase/admin';
import {
  listarPlantillas,
  crearPlantillaRevision,
  sanitizarTextoMeta,
} from '../../../../lib/whatsapp/meta';
import {
  anotarResultadoCredencial,
  credencialDeLinea,
} from '../../../../lib/whatsapp/lineas';

export const maxDuration = 60;

/**
 * Contrato C2 · Gestión de plantillas de WhatsApp (Meta HSM) por encargo del CRM.
 *
 * El CRM no habla con Meta directamente ni almacena credenciales de WABA:
 * solicita a la plataforma la sincronización o el alta de plantillas.
 *
 * Autenticado con `x-crm-token` (CRM_ENVIO_TOKEN).
 * La WABA y el token salen de `crm.credencial_linea`, nunca de variables
 * globales (salvo número de prueba registrado a mano).
 * Comprueba que la línea pertenezca a la inmobiliaria indicada (403 si no).
 * Ningún token se expone en respuestas ni trazas de error.
 */

interface PeticionCrearPlantilla {
  inmobiliaria_id?: string;
  wa_phone_number_id?: string;
  nombre_meta?: string;
  categoria?: string;
  idioma?: string;
  cuerpo?: string;
  ejemplos?: string[];
}

function validarTokenCRM(request: Request): boolean {
  const token = request.headers.get('x-crm-token');
  return Boolean(token && process.env.CRM_ENVIO_TOKEN && token === process.env.CRM_ENVIO_TOKEN);
}

type Supabase = ReturnType<typeof createAdminClient>;

type ResultadoCredenciales =
  | { ok: true; wabaId: string; token: string; esPrueba: boolean }
  | { ok: false; status: number; error: string };

async function resolverCredencialesLinea(
  supabase: Supabase,
  inmobiliariaId: string,
  phoneNumberId: string
): Promise<ResultadoCredenciales> {
  // 1 · Verificar que la línea exista y pertenezca a la inmobiliaria
  const { data: lineas } = await supabase
    .schema('crm')
    .rpc('linea_por_numero', { p_wa_phone_number_id: phoneNumberId });
  const linea = (Array.isArray(lineas) ? lineas[0] : lineas) as
    | { inmobiliaria_id?: string }
    | undefined;

  if (linea && linea.inmobiliaria_id !== inmobiliariaId) {
    return { ok: false, status: 403, error: 'Esa línea no es de esta inmobiliaria' };
  }

  // 2 · Credencial en Vault
  const deLinea = await credencialDeLinea(supabase, phoneNumberId);
  let wabaId = deLinea?.wabaId;
  let token = deLinea?.token;
  let esPrueba = false;

  // Fallback: número de prueba registrado a mano (excepción permitida)
  if (!deLinea && phoneNumberId === process.env.WHATSAPP_PHONE_NUMBER_ID) {
    wabaId = process.env.META_WABA_ID || process.env.WHATSAPP_WABA_ID || undefined;
    token = process.env.WHATSAPP_TOKEN || undefined;
    esPrueba = true;
  }

  if (!deLinea && !linea && !esPrueba) {
    return { ok: false, status: 403, error: 'Esa línea no es de esta inmobiliaria' };
  }

  if (!wabaId || !token) {
    return {
      ok: false,
      status: 409,
      error: `La línea ${phoneNumberId} no tiene credencial o WABA asociada: hay que conectarla con WhatsApp.`,
    };
  }

  return { ok: true, wabaId, token, esPrueba };
}

/**
 * GET /api/whatsapp/plantillas?inmobiliaria_id=...&wa_phone_number_id=...
 *
 * Consulta las plantillas de la WABA de esa línea en Meta Graph API.
 */
export async function GET(request: Request) {
  if (!validarTokenCRM(request)) {
    return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const url = new URL(request.url);
  const inmobiliariaId = url.searchParams.get('inmobiliaria_id')?.trim();
  const phoneNumberId = url.searchParams.get('wa_phone_number_id')?.trim();

  if (!inmobiliariaId || !phoneNumberId) {
    return Response.json(
      { ok: false, error: 'Faltan inmobiliaria_id y/o wa_phone_number_id' },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const resCred = await resolverCredencialesLinea(supabase, inmobiliariaId, phoneNumberId);
  if (!resCred.ok) {
    return Response.json({ ok: false, error: resCred.error }, { status: resCred.status });
  }

  const metaRes = await listarPlantillas(resCred.wabaId, resCred.token);

  if (!metaRes.ok) {
    const codigo = metaRes.error.code;
    const errorSanitizado = sanitizarTextoMeta(metaRes.error.message);
    if (!resCred.esPrueba && codigo) {
      await anotarResultadoCredencial(supabase, phoneNumberId, {
        ok: false,
        codigo,
        error: errorSanitizado,
      });
    }
    return Response.json(
      { ok: false, codigo, error: errorSanitizado || 'Error al consultar plantillas en Meta' },
      { status: 502 }
    );
  }

  if (!resCred.esPrueba) {
    await anotarResultadoCredencial(supabase, phoneNumberId, { ok: true });
  }

  return Response.json({
    ok: true,
    datos: metaRes.datos.data ?? [],
  });
}

/**
 * POST /api/whatsapp/plantillas
 *
 * Crea una plantilla oficial en Meta y la manda a revisión.
 */
export async function POST(request: Request) {
  if (!validarTokenCRM(request)) {
    return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const cuerpo: PeticionCrearPlantilla | null = await request.json().catch(() => null);
  const inmobiliariaId = cuerpo?.inmobiliaria_id?.trim();
  const phoneNumberId = cuerpo?.wa_phone_number_id?.trim();
  const nombreMeta = cuerpo?.nombre_meta?.trim();
  const categoria = cuerpo?.categoria?.trim();
  const cuerpoTexto = cuerpo?.cuerpo?.trim();
  const idioma = cuerpo?.idioma?.trim() || 'es';
  const ejemplos = cuerpo?.ejemplos;

  if (!inmobiliariaId || !phoneNumberId || !nombreMeta || !categoria || !cuerpoTexto) {
    return Response.json(
      {
        ok: false,
        error: 'Faltan campos requeridos: inmobiliaria_id, wa_phone_number_id, nombre_meta, categoria o cuerpo',
      },
      { status: 400 }
    );
  }

  const catLower = categoria.toLowerCase();
  if (!['utilidad', 'utility', 'marketing'].includes(catLower)) {
    return Response.json(
      {
        ok: false,
        error: `Categoría inválida: ${categoria}. Meta solo admite utilidad (UTILITY) o marketing (MARKETING).`,
      },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const resCred = await resolverCredencialesLinea(supabase, inmobiliariaId, phoneNumberId);
  if (!resCred.ok) {
    return Response.json({ ok: false, error: resCred.error }, { status: resCred.status });
  }

  const metaRes = await crearPlantillaRevision(resCred.wabaId, resCred.token, {
    nombreMeta,
    cuerpo: cuerpoTexto,
    categoria,
    idioma,
    ejemplos,
  });

  if (!metaRes.ok) {
    const codigo = metaRes.error.code;
    const errorSanitizado = sanitizarTextoMeta(metaRes.error.message);
    if (!resCred.esPrueba && codigo) {
      await anotarResultadoCredencial(supabase, phoneNumberId, {
        ok: false,
        codigo,
        error: errorSanitizado,
      });
    }
    return Response.json(
      { ok: false, codigo, error: errorSanitizado || 'Meta rechazó la plantilla' },
      { status: 502 }
    );
  }

  if (!resCred.esPrueba) {
    await anotarResultadoCredencial(supabase, phoneNumberId, { ok: true });
  }

  return Response.json({
    ok: true,
    id_meta: metaRes.datos.id,
    status: metaRes.datos.status ?? 'PENDING',
  });
}
