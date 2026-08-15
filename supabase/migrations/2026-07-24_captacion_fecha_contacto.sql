-- =====================================================================
-- MIGRACIÓN: columna faltante captacion_prospectos.fecha_contacto
-- Fecha: 2026-07-24
-- El código (bandeja /captaciones, aprobarContacto, y el conteo de
-- "contactados 30 días" del panel /agentes) usa `fecha_contacto`, pero la
-- migración original de la tabla nunca la creó: PostgREST respondía
-- "column captacion_prospectos.fecha_contacto does not exist" y la bandeja
-- salía VACÍA aunque hubiera prospectos guardados.
-- Idempotente.
-- =====================================================================

ALTER TABLE public.captacion_prospectos
    ADD COLUMN IF NOT EXISTS fecha_contacto DATE;

NOTIFY pgrst, 'reload schema';
