import { createAdminClient } from '../../../../lib/supabase/admin';
import {
  listarPlantillas,
  crearPlantillaRevision,
  borrarPlantilla,
  sanitizarTextoMeta,
} from '../../../../lib/whatsapp/meta';
import {
  anotarResultadoCredencial,
  credencialDeLinea,
} from '../../../../lib/whatsapp/lineas';
import { tokenValido } from '@/lib/whatsapp/token';
import { PLANTILLA_CONFIRMACION } from '@/lib/whatsapp/confirmacion-citas';
import { PLANTILLA_NO_DISPONIBLE } from '@/lib/whatsapp/veredicto-solicitudes';

export const maxDuration = 60;

/**
 * Contrato C2 · Gestión de plantillas de WhatsApp (Meta HSM) por encargo del CRM.
 *
 * El CRM no habla con Meta directamente ni almacena credenciales de WABA:
 * solicita a la plataforma la sincronización, el alta o la baja de plantillas.
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
  /** Un ejemplo por variable: por nombre, o una lista en el orden en que aparecen. */
  ejemplos?: unknown;
}

/** Solo una lista de textos o un objeto de textos; cualquier otra cosa, como si no viniera. */
function ejemplosValidos(ejemplos: unknown): string[] | Record<string, string> | undefined {
  if (Array.isArray(ejemplos)) {
    return ejemplos.every((e) => typeof e === 'string') ? (ejemplos as string[]) : undefined;
  }
  if (ejemplos && typeof ejemplos === 'object') {
    const pares = Object.entries(ejemplos as Record<string, unknown>);
    return pares.every(([, v]) => typeof v === 'string')
      ? (Object.fromEntries(pares) as Record<string, string>)
      : undefined;
  }
  return undefined;
}

function validarTokenCRM(request: Request): boolean {
  // Comparación en tiempo constante (lib/whatsapp/token.ts).
  return tokenValido(request.headers.get('x-crm-token'), process.env.CRM_ENVIO_TOKEN);
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
  const ejemplos = ejemplosValidos(cuerpo?.ejemplos);

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

/**
 * Las que manda la plataforma por su cuenta (confirmar citas, negar una
 * solicitud de visita). Borrarlas desde el CRM dejaría esos avisos sin
 * salir, y no se podrían volver a crear con el mismo nombre en 30 días.
 */
const PLANTILLAS_DE_LA_PLATAFORMA = [
  PLANTILLA_CONFIRMACION.nombreMeta,
  PLANTILLA_NO_DISPONIBLE.nombreMeta,
];

interface PeticionBorrarPlantilla {
  inmobiliaria_id?: string;
  wa_phone_number_id?: string;
  nombre_meta?: string;
  idioma?: string;
}

/**
 * DELETE /api/whatsapp/plantillas
 *
 * Borra de la WABA de esa línea la plantilla con ese nombre e idioma. Si
 * ya no estaba, responde ok con `existia: false`.
 */
export async function DELETE(request: Request) {
  if (!validarTokenCRM(request)) {
    return Response.json({ ok: false, error: 'No autorizado' }, { status: 401 });
  }

  const cuerpo: PeticionBorrarPlantilla | null = await request.json().catch(() => null);
  const inmobiliariaId = cuerpo?.inmobiliaria_id?.trim();
  const phoneNumberId = cuerpo?.wa_phone_number_id?.trim();
  const nombreMeta = cuerpo?.nombre_meta?.trim().toLowerCase();
  const idioma = cuerpo?.idioma?.trim() || 'es';

  if (!inmobiliariaId || !phoneNumberId || !nombreMeta) {
    return Response.json(
      { ok: false, error: 'Faltan campos requeridos: inmobiliaria_id, wa_phone_number_id o nombre_meta' },
      { status: 400 }
    );
  }
  if (!/^[a-z0-9_]{1,512}$/.test(nombreMeta)) {
    return Response.json({ ok: false, error: `Nombre de plantilla inválido: ${nombreMeta}` }, { status: 400 });
  }
  if (PLANTILLAS_DE_LA_PLATAFORMA.includes(nombreMeta)) {
    return Response.json(
      {
        ok: false,
        error: `«${nombreMeta}» la usa la plataforma para avisar de citas y solicitudes: no se borra desde el CRM.`,
      },
      { status: 409 }
    );
  }

  const supabase = createAdminClient();
  const resCred = await resolverCredencialesLinea(supabase, inmobiliariaId, phoneNumberId);
  if (!resCred.ok) {
    return Response.json({ ok: false, error: resCred.error }, { status: resCred.status });
  }

  const metaRes = await borrarPlantilla(resCred.wabaId, resCred.token, { nombreMeta, idioma });

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
      { ok: false, codigo, error: errorSanitizado || 'Meta no dejó borrar la plantilla' },
      { status: 502 }
    );
  }

  if (!resCred.esPrueba) {
    await anotarResultadoCredencial(supabase, phoneNumberId, { ok: true });
  }

  return Response.json({ ok: true, existia: metaRes.datos.existia });
}
