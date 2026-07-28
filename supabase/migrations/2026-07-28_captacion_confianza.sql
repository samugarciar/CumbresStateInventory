-- =====================================================================
-- MIGRACIÓN: guardar la confianza de la clasificación particular/agencia
-- Fecha: 2026-07-28
-- El nodo de calificación YA calcula una `confianza` (0–1) sobre si quien
-- publica es dueño directo o una agencia, pero nunca se persistía: se perdía
-- en cada corrida. Es justo el dato que permite ordenar la bandeja por "qué
-- tan seguro estoy" en vez de solo por score global.
--
-- Diferencia con `score`:
--   score               = qué tan buen PROSPECTO es (zona + tipo + operación…)
--   confianza_particular= qué tan seguro está el modelo de que es DUEÑO DIRECTO
-- Idempotente.
-- =====================================================================

ALTER TABLE public.captacion_prospectos
    ADD COLUMN IF NOT EXISTS confianza_particular NUMERIC;

NOTIFY pgrst, 'reload schema';
