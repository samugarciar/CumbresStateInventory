/**
 * A quién se le habla por WhatsApp: un teléfono o un BSUID.
 *
 * Desde 2026 una persona puede tener nombre de usuario en WhatsApp (el «@»)
 * y esconder su número. Entonces Meta no manda `from` ni `wa_id`: manda
 * solo el BSUID (business-scoped user ID), un identificador de la persona
 * para nuestro portafolio, en `from_user_id` y `contacts[].user_id`. Su
 * forma: país ISO de dos letras, punto y hasta 128 letras o números
 * («CO.13491208655302741918»); los padres llevan ENT («US.ENT.1181…»).
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
 *
 * Hasta el 28 oct 2026 el webhook daba por hecho que `from` siempre venía,
 * reventaba con esa persona y sus mensajes se perdían. Ahora, sin número, la
 * conversación se lleva con el BSUID donde iría el teléfono, y al contestar
 * se le escribe con `recipient` en vez de `to`.
 *
 * Meta sí manda el número si en los últimos 30 días le escribimos, nos
 * escribió desde él o está en la libreta: el BSUID es para quien nunca nos
 * lo ha dado.
 */

const BSUID = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

export function esBsuid(valor: string | null | undefined): boolean {
  return Boolean(valor && BSUID.test(valor.trim()));
}

/** Teléfono en E.164 si Meta lo mandó; si no, el BSUID; null si no hay ninguno. */
export function remitenteDe(m: { from?: string | null; from_user_id?: string | null }): string | null {
  const telefono = m.from?.trim();
  if (telefono) return telefono.startsWith('+') ? telefono : `+${telefono}`;
  const bsuid = m.from_user_id?.trim();
  return bsuid || null;
}

/** El destinatario para la Cloud API: `to` con un teléfono, `recipient` con un BSUID. */
export function destinoMeta(
  destino: string
): { to: string } | { recipient_type: 'individual'; recipient: string } {
  const limpio = destino.trim();
  return esBsuid(limpio)
    ? { recipient_type: 'individual', recipient: limpio }
    : { to: limpio.replace(/^\+/, '') };
}
