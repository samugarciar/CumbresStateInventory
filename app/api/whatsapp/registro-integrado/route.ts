import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  appsSuscritas,
  canjearCodigoRegistro,
  numerosDeCuenta,
  permisosDelToken,
  suscribirApp,
  type ErrorMeta,
} from '@/lib/whatsapp/meta';
import {
  aE164,
  appEstaSuscrita,
  cuentasEnPermisos,
  elegirNumero,
  esEmbudoConectable,
} from '@/lib/whatsapp/registro-integrado';

/**
 * Lo que pasa después de que un administrador conecta un número en la
 * ventana de Meta (registro integrado v4, coexistencia).
 *
 * Es la mitad de servidor del contrato de la nota 9: canjear el código,
 * averiguar la cuenta y el número, suscribir la app, guardar la línea con
 * su token en Vault (`crm.conectar_linea`) y anotar CADA intento, termine
 * como termine (`crm.registrar_intento_incorporacion`, decisión 28). Cada
 * intento se gasta sobre un número real, y lo que Meta responde ahí es lo
 * único que sirve para entender por qué falló.
 *
 * NO PIDE EL HISTORIAL NI LOS CONTACTOS. El historial solo se puede pedir
 * una vez y dentro de las 24 horas, y el webhook todavía no procesa
 * `history`: pedirlo ahora sería perderlo. Los contactos esperan el visto
 * bueno legal de Cumbres (la cuarentena está desconectada a propósito).
 *
 * El token del negocio no sale nunca de aquí: ni a la respuesta, ni a un
 * log, ni a un error. Va de Meta a Vault.
 */

export const maxDuration = 60;

type Supabase = ReturnType<typeof createAdminClient>;

interface Peticion {
  accion?: 'conectar' | 'cancelar' | 'error';
  embudo?: string;
  /** El código de la ventana. Vence a los 30 segundos. */
  code?: string;
  waba_id?: string;
  phone_number_id?: string;
  /** El código de error que trajo la ventana (`error_id`), en texto. */
  codigo?: string;
  /** Lo que trajo la ventana al cancelar o fallar, tal cual. */
  datos?: Record<string, unknown>;
}

function respuesta(status: number, cuerpo: Record<string, unknown>) {
  return Response.json(cuerpo, { status });
}

/** Una petición de otra página no puede conectar números a nombre de nadie. */
function mismoOrigen(request: Request): boolean {
  const origen = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origen || !host) return false;
  try {
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}

async function anotarIntento(
  supabase: Supabase,
  intento: {
    inmobiliariaId: string;
    embudo: string;
    resultado: 'exito' | 'error' | 'cancelado';
    codigo?: string | null;
    error?: Record<string, unknown> | null;
    phoneNumberId?: string | null;
    wabaId?: string | null;
  }
) {
  const { error } = await supabase.schema('crm').rpc('registrar_intento_incorporacion', {
    p_inmobiliaria_id: intento.inmobiliariaId,
    p_embudo: intento.embudo,
    p_resultado: intento.resultado,
    p_error_codigo: intento.codigo ?? null,
    p_error: intento.error ?? null,
    p_wa_phone_number_id: intento.phoneNumberId ?? null,
    p_waba_id: intento.wabaId ?? null,
  });
  // Que no se pueda anotar no debe tapar el resultado real de la conexión.
  if (error) console.error('[registro-integrado] No se pudo anotar el intento:', error.message);
}

/** El código de Meta en texto, como lo pide el registro de intentos. */
function codigoDe(error: ErrorMeta): string | null {
  return error.code !== undefined ? String(error.code) : null;
}

export async function POST(request: Request) {
  if (!mismoOrigen(request)) {
    return respuesta(403, { ok: false, error: 'Petición de otro origen' });
  }

  const usuario = await getCurrentUser();
  if (!usuario?.profile) return respuesta(401, { ok: false, error: 'Tu sesión expiró.' });
  if (usuario.profile.rol !== 'admin') {
    return respuesta(403, { ok: false, error: 'Solo un administrador puede conectar números.' });
  }
  const inmobiliariaId: string | undefined = usuario.profile.inmobiliaria_id;
  if (!inmobiliariaId) return respuesta(403, { ok: false, error: 'Tu usuario no tiene inmobiliaria.' });

  const cuerpo: Peticion | null = await request.json().catch(() => null);
  const embudo = cuerpo?.embudo?.trim() ?? '';
  if (!esEmbudoConectable(embudo)) {
    return respuesta(400, { ok: false, error: `Ese embudo no se conecta desde aquí: ${embudo || '(vacío)'}` });
  }

  const supabase = createAdminClient();

  // La persona cerró la ventana, o el flujo falló dentro de Meta: no hay
  // nada que conectar, pero el intento cuenta.
  if (cuerpo?.accion === 'cancelar' || cuerpo?.accion === 'error') {
    const esError = cuerpo.accion === 'error';
    await anotarIntento(supabase, {
      inmobiliariaId,
      embudo,
      resultado: esError ? 'error' : 'cancelado',
      codigo: esError ? cuerpo.codigo?.trim() || null : null,
      // Un 'error' sin objeto lo rechaza la base: si la ventana no trajo
      // nada, se dice eso mismo.
      error: cuerpo.datos ?? (esError ? { message: 'La ventana de Meta falló sin detalle' } : null),
    });
    return respuesta(200, { ok: true });
  }

  const code = cuerpo?.code?.trim();
  if (cuerpo?.accion !== 'conectar' || !code) {
    return respuesta(400, { ok: false, error: 'Falta el código de la ventana de Meta' });
  }

  // 1 · Lo primero, el canje: el código vence a los 30 segundos.
  const canje = await canjearCodigoRegistro(code);
  const token = canje.ok ? canje.datos.access_token : undefined;
  if (!canje.ok || !token) {
    const error = canje.ok ? { message: 'Meta no devolvió el token' } : canje.error;
    await anotarIntento(supabase, { inmobiliariaId, embudo, resultado: 'error', codigo: codigoDe(error), error });
    return respuesta(502, {
      ok: false,
      error: 'Meta no aceptó el código de la ventana. Vuelve a intentarlo; quedó anotado.',
      detalle: error.message ?? null,
    });
  }

  // Lo que se va sabiendo de Meta, para que cualquier fallo desde aquí se
  // anote con todo lo que ya se conoce.
  const sabido: { wabaId?: string; phoneNumberId?: string } = {
    wabaId: cuerpo.waba_id?.trim() || undefined,
  };

  const fallar = async (status: number, mensaje: string, error: ErrorMeta) => {
    await anotarIntento(supabase, {
      inmobiliariaId,
      embudo,
      resultado: 'error',
      codigo: codigoDe(error),
      error,
      phoneNumberId: sabido.phoneNumberId ?? null,
      wabaId: sabido.wabaId ?? null,
    });
    return respuesta(status, { ok: false, error: mensaje, detalle: error.message ?? null });
  };

  // 2 · La cuenta. Si el evento de la ventana no la trajo, se lee de los
  // permisos del token.
  if (!sabido.wabaId) {
    const permisos = await permisosDelToken(token);
    if (!permisos.ok) return fallar(502, 'No se pudo saber qué cuenta de WhatsApp se compartió.', permisos.error);
    const cuentas = cuentasEnPermisos(permisos.datos.data?.granular_scopes);
    if (cuentas.length !== 1) {
      return fallar(409, 'No se pudo saber qué cuenta de WhatsApp se compartió.', {
        message: `El token da acceso a ${cuentas.length} cuentas de WhatsApp y la ventana no dijo cuál.`,
        type: 'registro_integrado',
      });
    }
    sabido.wabaId = cuentas[0];
  }
  const wabaId = sabido.wabaId;

  // 3 · El número. La coexistencia no lo trae en el evento: se busca.
  const numeros = await numerosDeCuenta(wabaId, token);
  if (!numeros.ok) return fallar(502, 'No se pudieron leer los números de la cuenta.', numeros.error);
  const eleccion = elegirNumero(numeros.datos.data ?? [], cuerpo.phone_number_id?.trim() || undefined);
  if ('error' in eleccion) {
    return fallar(409, eleccion.error, { message: eleccion.error, type: 'registro_integrado' });
  }
  const numero = eleccion.numero;
  sabido.phoneNumberId = numero.id;

  // 4 · Suscribir la app a la cuenta, y comprobarlo: es lo que hace que
  // los mensajes de ese número lleguen al webhook.
  const suscripcion = await suscribirApp(wabaId, token);
  if (!suscripcion.ok) return fallar(502, 'Meta no dejó suscribir la app a la cuenta.', suscripcion.error);
  const apps = await appsSuscritas(wabaId, token);
  if (!apps.ok) return fallar(502, 'No se pudo comprobar la suscripción.', apps.error);
  if (!appEstaSuscrita(apps.datos.data)) {
    return fallar(502, 'La suscripción no aparece en la cuenta.', {
      message: 'subscribed_apps no lista nuestra app después de suscribirla',
      type: 'registro_integrado',
    });
  }

  // 5 · La línea, con su token en Vault. Reconectar reemplaza el token y
  // empieza un ciclo nuevo.
  const crm = supabase.schema('crm');
  const { data: lineaId, error: errorLinea } = await crm.rpc('conectar_linea', {
    p_inmobiliaria_id: inmobiliariaId,
    p_embudo: embudo,
    p_waba_id: wabaId,
    p_wa_phone_number_id: numero.id,
    p_modo: 'coexistencia',
    p_token: token,
    p_telefono_e164: aE164(numero.display_phone_number) ?? null,
    p_nombre: numero.verified_name ?? null,
  });
  if (errorLinea) {
    return fallar(500, 'Meta conectó el número, pero no se pudo guardar la línea.', {
      message: errorLinea.message,
      type: 'base_de_datos',
      pg_code: errorLinea.code,
    });
  }

  const { error: errorEstado } = await crm.rpc('registrar_estado_linea', {
    p_wa_phone_number_id: numero.id,
    p_evento: 'suscripcion_verificada',
  });
  if (errorEstado) {
    console.error('[registro-integrado] No se pudo anotar la suscripción:', errorEstado.message);
  }

  await anotarIntento(supabase, {
    inmobiliariaId,
    embudo,
    resultado: 'exito',
    phoneNumberId: numero.id,
    wabaId,
  });

  return respuesta(200, {
    ok: true,
    linea: {
      id: lineaId,
      embudo,
      telefono: aE164(numero.display_phone_number) ?? numero.display_phone_number ?? null,
      nombre: numero.verified_name ?? null,
    },
  });
}
