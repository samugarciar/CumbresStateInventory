// Límite del motivo de denegación, compartido por la server action y el panel
// de /citas.
//
// El motivo viaja al workflow de veredicto de n8n, que lo escribe en el campo
// 1992157 del lead en Kommo. Los campos de texto de Kommo topan en 255
// caracteres: el 28/ago un asesor escribió 261 y el PATCH murió con
// "Request validation failed" — el cliente (Daimer, 3002793407) nunca recibió
// su respuesta y la solicitud quedó marcada como denegada en la base, así que
// desde /citas parecía resuelta.
//
// El tope es 240 y no 255 a propósito: ese mismo texto lo recoge después el
// salesbot desde el campo "msj n8n", que también topa en 256 y le agrega
// saludo y cierre alrededor. Los 15 caracteres de margen son para eso.
export const MAX_MOTIVO_DENEGACION = 240;
