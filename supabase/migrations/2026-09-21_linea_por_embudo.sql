-- =====================================================================
-- MIGRACIÓN: se retira inmobiliarias.wa_phone_number_id
-- Fecha: 2026-09-21
--
-- POR QUÉ SE VA, HABIÉNDOLA PUESTO HOY MISMO
-- Se añadió esta mañana asumiendo UN número de WhatsApp por inmobiliaria.
-- El caso real de Cumbres son tres, cada uno alimentando un embudo
-- distinto: comercial, administrativa y captación. Una columna en
-- `inmobiliarias` no puede representar eso.
--
-- Lo sustituye `crm.lineas`, que vive en el CRM porque el concepto que
-- falta —a qué EMBUDO alimenta cada línea— es del CRM. El webhook
-- traduce un phone_number_id con `crm.linea_por_numero()`, que le
-- devuelve la inmobiliaria, el embudo y si el bot puede contestar ahí.
--
-- Se borra en vez de dejarla muerta porque nunca tuvo una fila y porque
-- una columna que parece configurable y no lo es acaba configurándose:
-- alguien le pone un valor, el webhook no la mira, y ese alguien pasa una
-- tarde buscando por qué no entran los mensajes.
--
-- Verificado contra Meta antes de decidir la forma: un WABA admite DOS
-- números al empezar y VEINTE cuando el negocio se verifica, y cada
-- número lleva su propia calificación de calidad — una línea castigada
-- no arrastra a las otras.
-- =====================================================================

DROP INDEX IF EXISTS public.inmobiliarias_wa_phone_number_id;

ALTER TABLE public.inmobiliarias
  DROP COLUMN IF EXISTS wa_phone_number_id;
