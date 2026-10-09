-- =====================================================================
-- MIGRACIÓN: cada mensaje sabe por qué número de WhatsApp entró o salió
-- Fecha: 2026-10-08
--
-- EL PROBLEMA
-- Hasta hoy había un solo número, así que «por cuál» no hacía falta. Con
-- la coexistencia cada embudo tiene el suyo (comercial, administrativa,
-- captación), y la misma persona puede escribir por dos: un inquilino que
-- además busca otro apartamento. Sin el número en cada mensaje:
--   · la ventana de 24 h se mide por persona y no por línea, y un mensaje a
--     la administrativa «abriría» la comercial;
--   · el bot comercial leería como contexto lo que el inquilino habló con
--     la administración;
--   · el CRM no puede decir por qué línea contestar.
--
-- LO QUE AÑADE
-- `wa_phone_number_id`: el número de Meta por el que pasó el mensaje. Lo
-- escribe la plataforma (webhook, emisor, historial, ecos, agente). Lo que
-- entra por Kommo/n8n queda vacío, y el CRM trata vacío como «sin número».
--
-- El CRM ya lo espera desde el 1 oct: su proyección lee la fila con
-- to_jsonb(NEW), así que la columna nueva le llega sola. No cambia la RLS
-- ni los permisos: es una columna más de una tabla que ya los tiene.
-- =====================================================================

ALTER TABLE public.agente_comercial_mensajes
  ADD COLUMN IF NOT EXISTS wa_phone_number_id text;

COMMENT ON COLUMN public.agente_comercial_mensajes.wa_phone_number_id IS
  'El phone_number_id de Meta por el que entró o salió el mensaje. Vacío en lo que llega por Kommo/n8n. Lo usan la ventana de 24 h por línea del CRM y el historial del bot, que solo lee lo de su línea.';
