// Callback OAuth de Mercado Libre. Verifica el `state` (anti-CSRF), canjea el
// `code` por tokens y los guarda (upsert por inmobiliaria) con el cliente
// admin (service role). La inmobiliaria se toma de la sesión del admin, que
// sigue logueado cuando Mercado Libre lo devuelve aquí. Redirige a /agentes
// con un query `ml=<estado>` para que el panel muestre el resultado.

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { intercambiarCodigo } from '@/lib/agente-captaciones/mercadolibre/oauth';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const state = params.get('state');
  const errorML = params.get('error');

  const volver = (estado: string) =>
    NextResponse.redirect(new URL(`/agentes?ml=${estado}`, request.url));

  if (errorML) {
    console.warn('[ML OAuth] callback con error:', errorML, params.get('error_description'));
    return volver('denegado');
  }
  if (!code || !state) return volver('faltan_parametros');

  // Anti-CSRF: el state debe coincidir con la cookie que puso /connect.
  const cookieStore = await cookies();
  const esperado = cookieStore.get('ml_oauth_state')?.value;
  if (!esperado || esperado !== state) return volver('state_invalido');

  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  let tokens;
  try {
    const redirectUri = `${request.nextUrl.origin}/api/integraciones/mercadolibre/callback`;
    tokens = await intercambiarCodigo({ code, redirectUri });
  } catch (e) {
    console.error('[ML OAuth] intercambio de código falló:', e);
    return volver('intercambio_fallido');
  }

  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error } = await admin.from('integraciones_mercadolibre').upsert(
    {
      inmobiliaria_id: user.profile.inmobiliaria_id,
      ml_user_id: tokens.user_id != null ? String(tokens.user_id) : null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope ?? null,
      expires_at: expiresAt,
      conectado_por: user.profile.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'inmobiliaria_id' }
  );

  if (error) {
    console.error('[ML OAuth] no se pudo guardar la conexión:', error.message);
    return volver('guardado_fallido');
  }

  const resp = volver('ok');
  resp.cookies.delete('ml_oauth_state');
  return resp;
}
