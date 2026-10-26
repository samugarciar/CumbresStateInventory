// Límite del motivo de denegación, compartido por la server action y el panel
// de /citas.
//
// Nació con Kommo: el motivo iba a un campo de texto del lead que topaba en
// 255 caracteres, y el 28/ago un motivo de 261 dejó a un cliente sin
// respuesta. Desde el 26 oct 2026 el aviso sale por WhatsApp desde la línea
// comercial (lib/whatsapp/veredicto-solicitudes.ts), que no tiene ese tope,
// pero el límite se queda: un motivo corto, con la fecha y la alternativa
// concreta, es lo que el cliente lee.
export const MAX_MOTIVO_DENEGACION = 240;
