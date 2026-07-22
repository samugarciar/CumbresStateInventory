// Inicia el flujo OAuth de Mercado Libre. Solo un admin logueado puede
// conectar. Genera un `state` anti-CSRF (cookie httpOnly) y redirige al
// consentimiento de Mercado Libre. El redirect_uri se deriva del origin de la
// petición, así que coincide sí o sí con la URL real del callback (la misma
// que debes registrar en el DevCenter de Mercado Libre).

import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth-helpers';
import { construirUrlAutorizacion } from '@/lib/agente-captaciones/mercadolibre/oauth';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.profile || user.profile.rol !== 'admin') {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const redirectUri = `${request.nextUrl.origin}/api/integraciones/mercadolibre/callback`;
  const state = crypto.randomUUID();

  let url: string;
  try {
    url = construirUrlAutorizacion({ redirectUri, state });
  } catch (e) {
    console.error('[ML OAuth] connect:', e);
    return NextResponse.redirect(new URL('/agentes?ml=config_error', request.url));
  }

  const resp = NextResponse.redirect(url);
  resp.cookies.set('ml_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  return resp;
}
