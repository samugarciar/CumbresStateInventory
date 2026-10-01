-- =====================================================================
-- MIGRACIÓN: avisar UNA sola vez que un asesor atiende la conversación
-- Fecha: 2026-10-01
--
-- POR QUÉ EXISTE ESTA COLUMNA
-- Cuando el CRM calla al bot para un lead (crm.contactos.bot_activo, vía
-- crm.bot_puede_responder), la ruta del agente devolvía "Un asesor está
-- atendiendo personalmente esta conversación." en CADA mensaje entrante.
-- Medido el 1/oct en producción: 35 contactos callados, 7 de las 12
-- conversaciones con actividad del día. El cliente escribía cinco veces y
-- recibía cinco veces la misma línea robótica, mientras la asesora le
-- contestaba de verdad por Kommo.
--
-- La frase sirve una vez —decirle al cliente que ya va una persona— y
-- estorba a partir de la segunda. Para no repetirla hay que recordar que ya
-- se dijo, y el único sitio durable es la conversación.
--
-- POR QUÉ NO SE GUARDA COMO UN MENSAJE DEL AGENTE
-- Porque entonces entraría al historial que lee el modelo, y el bot
-- aprendería a decir que un asesor está atendiendo. El sello es estado de
-- la conversación, no un turno de la charla.
--
-- CÓMO SE REARMA
-- Se vuelve a NULL en cuanto el bot contesta normal (lo hace el mismo
-- UPDATE que ya refresca la conversación en cada mensaje, sin una escritura
-- de más). Así el próximo episodio de silencio vuelve a avisar una vez: el
-- silencio por escalamiento caduca y puede repetirse semanas después, y ahí
-- el cliente sí merece el aviso otra vez.
-- =====================================================================

ALTER TABLE public.agente_comercial_conversaciones
    ADD COLUMN IF NOT EXISTS silencio_avisado_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.agente_comercial_conversaciones.silencio_avisado_at IS
    'Cuándo se le dijo al cliente que un asesor atiende su conversación. NULL = no se le ha dicho en este episodio de silencio; vuelve a NULL en cuanto el bot contesta normal.';

NOTIFY pgrst, 'reload schema';
