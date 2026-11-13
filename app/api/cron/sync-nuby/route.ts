// Sincronización diaria de inventario con Nuby/Arrendasoft (medianoche, Bogotá).
//
// La dispara Vercel Cron (ver vercel.json): `0 5 * * *` en UTC = 00:00 en
// America/Bogota (UTC-5, sin horario de verano). Vercel manda la cabecera
// `Authorization: Bearer $CRON_SECRET` cuando esa variable existe en el proyecto;
// sin ella la ruta no corre.
//
// Usa el cliente de servicio (no hay sesión) y la configuración de Nuby de las
// variables de entorno, que es de una sola instancia: por eso sincroniza solo la
// inmobiliaria CUMBRES_INMOBILIARIA_ID. Es la misma lógica del botón de
// /inmuebles/sync (lib/sync-nuby.ts), así que respeta los overrides locales.

import { createAdminClient } from '@/lib/supabase/admin';
import { ejecutarSincronizacionNuby } from '@/lib/sync-nuby';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || request.headers.get('authorization') !== `Bearer ${secreto}`) {
    return Response.json({ success: false, message: 'No autorizado' }, { status: 401 });
  }

  const inmobiliariaId = process.env.CUMBRES_INMOBILIARIA_ID;
  if (!inmobiliariaId) {
    return Response.json(
      { success: false, message: 'Falta configurar CUMBRES_INMOBILIARIA_ID' },
      { status: 500 },
    );
  }

  const inicio = Date.now();
  const resultado = await ejecutarSincronizacionNuby(createAdminClient(), inmobiliariaId);
  const segundos = Math.round((Date.now() - inicio) / 1000);

  console.log(
    `[cron sync-nuby] ${resultado.success ? 'ok' : 'ERROR'} en ${segundos}s — ${resultado.message}`,
  );
  if (!resultado.success) console.error('[cron sync-nuby] detalle:', resultado.details);

  return Response.json({ ...resultado, segundos }, { status: resultado.success ? 200 : 502 });
}
