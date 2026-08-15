// Cliente OAuth 2.0 de Mercado Libre (Colombia, site MCO) para el agente de
// captaciones. Flujo authorization_code: el admin autoriza una vez desde
// /api/integraciones/mercadolibre/connect; el callback canjea el `code` por
// tokens y los guarda en public.integraciones_mercadolibre (una fila por
// inmobiliaria). El access_token dura ~6 h; se refresca con el refresh_token
// (de un solo uso: cada refresh devuelve uno nuevo, hay que persistirlo).
//
// La app de Mercado Libre (client_id/secret) es de plataforma → variables de
// entorno. NO se usa PKCE (la app se configuró sin PKCE); si se activara,
// habría que añadir code_verifier/code_challenge en connect y callback.

import type { SupabaseClient } from '@supabase/supabase-js';

const AUTH_HOST = 'https://auth.mercadolibre.com.co';
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

interface TokensML {
  access_token: string;
  refresh_token: string;
  expires_in: number; // segundos
  scope?: string;
  user_id?: number | string;
  token_type?: string;
}

function credenciales(): { clientId: string; clientSecret: string } {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Faltan ML_CLIENT_ID / ML_CLIENT_SECRET en el entorno.');
  }
  return { clientId, clientSecret };
}

export function construirUrlAutorizacion(params: { redirectUri: string; state: string }): string {
  const { clientId } = credenciales();
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  return `${AUTH_HOST}/authorization?${q.toString()}`;
}

async function pedirToken(body: Record<string, string>): Promise<TokensML> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.access_token) {
    const detalle = data ? JSON.stringify(data) : `HTTP ${resp.status}`;
    throw new Error(`Mercado Libre rechazó la petición de token: ${detalle}`);
  }
  return data as TokensML;
}

export function intercambiarCodigo(params: { code: string; redirectUri: string }): Promise<TokensML> {
  const { clientId, clientSecret } = credenciales();
  return pedirToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
}

function refrescarToken(refreshToken: string): Promise<TokensML> {
  const { clientId, clientSecret } = credenciales();
  return pedirToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
}

// Margen para refrescar antes de que expire (no usar un token casi vencido).
const MARGEN_REFRESH_MS = 5 * 60 * 1000;

/**
 * Devuelve un access_token válido para la inmobiliaria, refrescándolo y
 * persistiéndolo si está por vencer. Requiere el cliente admin (service role):
 * public.integraciones_mercadolibre no expone tokens vía RLS. Lanza si la
 * inmobiliaria aún no ha conectado Mercado Libre.
 */
export async function obtenerAccessTokenValido(
  supabaseAdmin: SupabaseClient,
  inmobiliariaId: string
): Promise<string> {
  const { data: fila, error } = await supabaseAdmin
    .from('integraciones_mercadolibre')
    .select('access_token, refresh_token, expires_at')
    .eq('inmobiliaria_id', inmobiliariaId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo leer la conexión de Mercado Libre: ${error.message}`);
  if (!fila) throw new Error('Esta inmobiliaria aún no ha conectado Mercado Libre.');

  const venceEn = new Date(fila.expires_at).getTime();
  if (venceEn - Date.now() > MARGEN_REFRESH_MS) {
    return fila.access_token as string;
  }

  const tokens = await refrescarToken(fila.refresh_token as string);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { error: upError } = await supabaseAdmin
    .from('integraciones_mercadolibre')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('inmobiliaria_id', inmobiliariaId);
  if (upError) throw new Error(`No se pudo guardar el token renovado: ${upError.message}`);

  return tokens.access_token;
}
