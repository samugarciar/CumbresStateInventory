'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth-helpers';
import { revalidatePath } from 'next/cache';

import { procesarAnuncios, inferirFuente, type AnuncioEntrante } from '@/lib/agente-captaciones/procesar';
import { DIAS_PRIMER_SEGUIMIENTO } from '@/lib/agente-captaciones/config';
import { idCanonico } from '@/lib/agente-captaciones/sources/mercadolibre';

// Estados del pipeline a los que se puede mover un prospecto desde la bandeja.
export type EstadoProspecto =
  | 'nuevo' | 'calificado' | 'por_aprobar' | 'contactado'
  | 'en_conversacion' | 'cita' | 'captado' | 'descartado';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') return null;
  return user;
}

// Captaciones es un módulo de administración: todas las acciones exigen admin.

// Fecha en Bogotá (el servidor de Vercel corre en UTC). Colombia es UTC-5 fijo.
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function fechaBogotaMasDias(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(
    new Date(Date.now() + dias * 864e5)
  );
}

/**
 * Agrega un anuncio a la bandeja: lo enriquece (si es de Mercado Libre), lo
 * pasa por el grafo (calificar → dedupe → redactar) y lo deja en 'por_aprobar'.
 * NO contacta a nadie.
 */
export async function agregarProspecto(datos: {
  url?: string;
  texto?: string;
  contacto_telefono?: string;
  contacto_nombre?: string;
}) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden captar prospectos.' };

  const url = datos.url?.trim();
  const texto = datos.texto?.trim();
  if (!url && !texto) {
    return { success: false as const, error: 'Pega la URL del anuncio o el texto de la publicación.' };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { success: false as const, error: 'Falta configurar OPENAI_API_KEY.' };
  }

  const inmobiliariaId = user.profile.inmobiliaria_id;
  const supabase = createAdminClient();

  // Kill switch: sin fila = activo (mismo criterio que el resto de agentes)
  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();
  if (config && !config.activo) {
    return { success: false as const, error: 'El agente de captaciones está pausado. Actívalo en Agentes.' };
  }

  // Misma tubería que el intake por correo y por lote (enriquecer + calificar +
  // dedupe + redactar), para no tener tres implementaciones distintas.
  try {
    const resumen = await procesarAnuncios(supabase, inmobiliariaId, [
      {
        url: url ?? null,
        titulo: texto ? texto.slice(0, 120) : (url ?? ''),
        descripcion: texto ?? null,
        contacto_telefono: datos.contacto_telefono?.trim() || null,
        contacto_nombre: datos.contacto_nombre?.trim() || null,
      },
    ]);
    revalidatePath('/captaciones');

    const item = resumen.detalle[0];
    const mensajes: Record<string, string> = {
      creado: 'Prospecto calificado y listo para aprobar.',
      duplicado: 'Ese anuncio ya estaba en la bandeja.',
      descartado: `Descartado: ${item?.motivo ?? 'no cumple el criterio de captación.'}`,
    };
    if (!item || item.resultado === 'error') {
      return { success: false as const, error: item?.motivo ?? 'No se pudo procesar el anuncio.' };
    }
    return { success: true as const, resultado: item.resultado, message: mensajes[item.resultado] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Captaciones] Error agregando prospecto:', msg);
    return { success: false as const, error: msg };
  }
}

/**
 * Aprueba el contacto: guarda el mensaje final (editado o no), marca el
 * prospecto como 'contactado' y programa el primer seguimiento.
 * El ENVÍO lo hace el humano (la UI abre WhatsApp con el mensaje listo).
 */
export async function aprobarContacto(datos: { prospecto_id: string; mensaje_final: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden aprobar contactos.' };

  const mensaje = datos.mensaje_final?.trim();
  if (!mensaje) return { success: false as const, error: 'El mensaje no puede quedar vacío.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      mensaje_borrador: mensaje,
      estado: 'contactado',
      fecha_contacto: hoyBogota(),
      proximo_seguimiento: fechaBogotaMasDias(DIAS_PRIMER_SEGUIMIENTO),
      asesor_id: user.profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    .eq('estado', 'por_aprobar');

  if (error) {
    console.error('[Captaciones] Error aprobando contacto:', error.message);
    return { success: false as const, error: 'No se pudo marcar como contactado.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Marcado como contactado. Seguimiento programado.' };
}

/**
 * Importa varios anuncios recolectados por el bookmarklet desde el navegador.
 *
 * Por qué existe: Facebook y Mercado Libre tienen CSP estricta, así que un
 * bookmarklet NO puede hacer fetch a esta app desde sus páginas. En vez de eso
 * abre /captaciones/importar con los datos en el fragmento de la URL, y esa
 * página llama a esta acción con la sesión del admin — sin exponer ningún token.
 */
export async function importarAnuncios(anuncios: AnuncioEntrante[]) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden importar anuncios.' };
  if (!Array.isArray(anuncios) || anuncios.length === 0) {
    return { success: false as const, error: 'No llegó ningún anuncio.' };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { success: false as const, error: 'Falta configurar OPENAI_API_KEY.' };
  }

  const inmobiliariaId = user.profile.inmobiliaria_id;
  const supabase = createAdminClient();

  const { data: config } = await supabase
    .from('agentes_config')
    .select('activo')
    .eq('inmobiliaria_id', inmobiliariaId)
    .eq('agente', 'captaciones')
    .maybeSingle();
  if (config && !config.activo) {
    return { success: false as const, error: 'El agente de captaciones está pausado. Actívalo en Agentes.' };
  }

  try {
    const lote = anuncios.slice(0, 25);
    const resumen = await procesarAnuncios(supabase, inmobiliariaId, lote);

    // Cierra el circuito del "modo cola": sale de los pendientes lo que SÍ se
    // atendió —creado, duplicado o descartado son los tres desenlaces válidos:
    // en los tres el anuncio ya se juzgó y no hay que volver a abrirlo—.
    //
    // Lo que NO puede salir de la cola es lo que falló ('error'). Si el techo de
    // gasto está agotado, procesarAnuncios devuelve los 25 como 'error' sin
    // llamar al modelo: marcarlos igual habría vaciado la cola entera sin haber
    // mirado un solo anuncio, y sin forma de recuperarlos.
    //
    // La correlación va por URL y no por posición: el lote se procesa en tandas
    // concurrentes, así que el orden de `detalle` no sigue al de la entrada.
    const atendidos = resumen.detalle.filter((d) => d.resultado !== 'error' && d.url);
    if (atendidos.length) {
      const ahora = new Date().toISOString();
      await Promise.all(
        atendidos.map((d) => {
          const fuenteId = idCanonico(d.url, inferirFuente(d.url));
          if (!fuenteId) return null;
          return supabase
            .from('captacion_cola')
            .update({
              estado: 'capturado',
              // Enlaza la fila de la cola con el prospecto que produjo. Sin
              // esto la columna quedaba declarada y nunca escrita.
              prospecto_id: d.prospecto_id,
              updated_at: ahora,
            })
            .eq('inmobiliaria_id', inmobiliariaId)
            .eq('estado', 'pendiente')
            .eq('fuente_id', fuenteId);
        })
      );
    }

    revalidatePath('/captaciones');
    revalidatePath('/captaciones/cola');
    return { success: true as const, ...resumen, recortados: Math.max(0, anuncios.length - 25) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Captaciones] Error importando:', msg);
    return { success: false as const, error: msg };
  }
}

/**
 * Guarda el teléfono del propietario a mano.
 *
 * Por qué existe: en Mercado Libre el número está detrás de un reCAPTCHA, así
 * que NO se puede extraer automáticamente (ni se intenta). El asesor lo revela
 * con un clic en el anuncio y lo pega aquí; con eso el prospecto pasa a canal
 * whatsapp y queda listo para contactar desde la bandeja.
 */
export async function guardarTelefono(datos: { prospecto_id: string; telefono: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden editar prospectos.' };

  const digitos = (datos.telefono || '').replace(/\D/g, '');
  if (digitos.length < 7) {
    return { success: false as const, error: 'Ese número no parece válido.' };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({ contacto_telefono: digitos, canal: 'whatsapp', updated_at: new Date().toISOString() })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error guardando el teléfono:', error.message);
    return { success: false as const, error: 'No se pudo guardar el teléfono.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Teléfono guardado. Ya puedes abrir WhatsApp.' };
}

/**
 * Marca que el propietario NO quiere ser contactado (Habeas Data, Ley 1581).
 *
 * Además de descartarlo, deja `opt_out` en true: el nodo de deduplicación
 * encuentra esa fila por teléfono o por URL en futuras corridas, así que el
 * mismo propietario no vuelve a entrar a la bandeja aunque republique.
 */
export async function marcarNoContactar(datos: { prospecto_id: string; motivo?: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden hacer esto.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      opt_out: true,
      estado: 'descartado',
      notas: datos.motivo?.trim() || 'El propietario pidió no ser contactado.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error marcando opt-out:', error.message);
    return { success: false as const, error: 'No se pudo registrar la solicitud.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Registrado: no se volverá a contactar a este propietario.' };
}

/** Descarta un prospecto (no se contacta). */
export async function rechazarProspecto(datos: { prospecto_id: string; motivo?: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden descartar prospectos.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      estado: 'descartado',
      notas: datos.motivo?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error descartando:', error.message);
    return { success: false as const, error: 'No se pudo descartar el prospecto.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Prospecto descartado.' };
}

/** Mueve un prospecto por el pipeline (en conversación, cita, captado...). */
export async function cambiarEstadoProspecto(datos: { prospecto_id: string; estado: EstadoProspecto }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden mover prospectos.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_prospectos')
    .update({ estado: datos.estado, updated_at: new Date().toISOString() })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error cambiando estado:', error.message);
    return { success: false as const, error: 'No se pudo actualizar el estado.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Estado actualizado.' };
}

/** Registra un seguimiento hecho y reprograma el siguiente. */
export async function registrarSeguimiento(datos: { prospecto_id: string; dias?: number }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden registrar seguimientos.' };

  const supabase = createAdminClient();
  const { data: actual } = await supabase
    .from('captacion_prospectos')
    .select('n_seguimientos')
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    .maybeSingle();

  const { error } = await supabase
    .from('captacion_prospectos')
    .update({
      n_seguimientos: (actual?.n_seguimientos ?? 0) + 1,
      proximo_seguimiento: fechaBogotaMasDias(datos.dias ?? DIAS_PRIMER_SEGUIMIENTO),
      updated_at: new Date().toISOString(),
    })
    .eq('id', datos.prospecto_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id);

  if (error) {
    console.error('[Captaciones] Error registrando seguimiento:', error.message);
    return { success: false as const, error: 'No se pudo registrar el seguimiento.' };
  }
  revalidatePath('/captaciones');
  return { success: true as const, message: 'Seguimiento registrado.' };
}

// =====================================================================
// Cola de revisión ("modo cola")
//
// Separa DESCUBRIR de CALIFICAR. Una lista de resultados de Facebook no trae
// descripción, y sin ella el calificador no puede distinguir un dueño de una
// agencia: se comprobó que 33 anuncios capturados así salieron todos con el
// mismo score. Ahora la lista solo deja el link aquí —gratis, sin LLM— y el
// prospecto nace cuando el asesor abre la publicación y la captura completa.
// =====================================================================

export interface ItemCola {
  id: string;
  url: string;
  titulo: string | null;
  precio: number | null;
  fuente: string;
  created_at: string;
}

/**
 * Mete anuncios en la cola de revisión. No llama al modelo ni crea prospectos.
 *
 * Salta los que ya están en la cola y los que YA son prospectos (para no
 * mandar a abrir a mano algo que ya se capturó o que ya se descartó).
 */
export async function encolarAnuncios(anuncios: Array<{ url: string; titulo?: string | null; precio?: number | null }>) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden usar la cola.' };
  if (!Array.isArray(anuncios) || anuncios.length === 0) {
    return { success: false as const, error: 'No llegó ningún anuncio.' };
  }

  const inmobiliariaId = user.profile.inmobiliaria_id;
  const supabase = createAdminClient();

  const filas = anuncios
    .filter((a) => a?.url)
    .map((a) => {
      const fuente = inferirFuente(a.url);
      return {
        inmobiliaria_id: inmobiliariaId,
        fuente,
        fuente_id: idCanonico(a.url, fuente),
        url: a.url,
        titulo: a.titulo?.trim() || null,
        precio: typeof a.precio === 'number' ? a.precio : null,
      };
    })
    .filter((f) => f.fuente_id);

  if (!filas.length) return { success: false as const, error: 'Ninguno de los enlaces era reconocible.' };

  // Ya capturados o ya descartados: no tiene sentido pedir que se abran otra vez.
  const ids = filas.map((f) => f.fuente_id as string);
  const { data: yaProspectos, error: errConocidos } = await supabase
    .from('captacion_prospectos')
    .select('fuente_id')
    .eq('inmobiliaria_id', inmobiliariaId)
    .in('fuente_id', ids);
  // Si esta consulta falla no se puede seguir: `conocidos` quedaría vacío y se
  // encolarían anuncios que YA son prospectos, mandando al operador a abrir a
  // mano cosas que ya se capturaron o se descartaron.
  if (errConocidos) {
    console.error('[Captaciones] Error comprobando prospectos existentes:', errConocidos.message);
    return { success: false as const, error: 'No se pudo comprobar qué anuncios ya estaban en el CRM.' };
  }
  const conocidos = new Set((yaProspectos ?? []).map((p) => p.fuente_id));
  const nuevas = filas.filter((f) => !conocidos.has(f.fuente_id));

  if (!nuevas.length) {
    return {
      success: true as const,
      encolados: 0,
      repetidos: filas.length,
      message: 'Todos esos anuncios ya estaban en el CRM.',
    };
  }

  // onConflict sobre la clave de dedup: reencolar la misma búsqueda no duplica.
  const { data, error } = await supabase
    .from('captacion_cola')
    .upsert(nuevas, { onConflict: 'inmobiliaria_id,fuente,fuente_id', ignoreDuplicates: true })
    .select('id');

  if (error) {
    console.error('[Captaciones] Error encolando:', error.message);
    return { success: false as const, error: 'No se pudo guardar la cola.' };
  }

  revalidatePath('/captaciones/cola');
  const encolados = data?.length ?? 0;
  return {
    success: true as const,
    encolados,
    repetidos: filas.length - encolados,
  };
}

/** Saca un anuncio de la cola sin capturarlo (no interesa). */
export async function omitirDeCola(datos: { cola_id: string }) {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden usar la cola.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_cola')
    .update({ estado: 'omitido', updated_at: new Date().toISOString() })
    .eq('id', datos.cola_id)
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    // Solo se omite lo que sigue pendiente: si entretanto se capturó (otra
    // pestaña, o el botón pulsado sobre una lista ya vieja), marcarlo 'omitido'
    // borraría el vínculo con el prospecto que ya se creó.
    .eq('estado', 'pendiente');

  if (error) {
    console.error('[Captaciones] Error omitiendo de la cola:', error.message);
    return { success: false as const, error: 'No se pudo omitir.' };
  }
  revalidatePath('/captaciones/cola');
  return { success: true as const };
}

/** Vacía la cola de pendientes (empezar de nuevo). */
export async function vaciarCola() {
  const user = await requireAdmin();
  if (!user) return { success: false as const, error: 'Solo los administradores pueden usar la cola.' };

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('captacion_cola')
    .update({ estado: 'omitido', updated_at: new Date().toISOString() })
    .eq('inmobiliaria_id', user.profile.inmobiliaria_id)
    .eq('estado', 'pendiente');

  if (error) return { success: false as const, error: 'No se pudo vaciar la cola.' };
  revalidatePath('/captaciones/cola');
  return { success: true as const };
}
