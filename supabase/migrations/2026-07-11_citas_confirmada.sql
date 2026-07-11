-- =====================================================================
-- MIGRACIÓN: marcar citas confirmadas (enviadas al flujo n8n → Kommo)
-- Fecha: 2026-07-11
-- "Confirmar citas" disparaba el webhook pero no dejaba rastro de cuáles
-- citas ya se enviaron. Ahora confirmarCitas marca cada cita enviada con
-- confirmada_at/confirmada_por y /citas muestra un badge "Confirmada".
-- Columnas aparte de `estado` a propósito: el ciclo de vida de la cita
-- (agendada/cancelada/completada) no cambia y el contrato del agente
-- (cancelar_cita, RPCs) queda intacto. Re-enviar sigue permitido
-- (actualiza la marca). Idempotente.
-- =====================================================================

ALTER TABLE public.citas
    ADD COLUMN IF NOT EXISTS confirmada_at  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS confirmada_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.citas.confirmada_at IS 'Última vez que la cita se envió al flujo n8n "Confirmar citas" (→ Kommo); NULL = nunca enviada';
COMMENT ON COLUMN public.citas.confirmada_por IS 'Admin que disparó esa confirmación';

-- anon ya tiene REVOKE ALL sobre citas → las columnas nuevas no se exponen al agente.

NOTIFY pgrst, 'reload schema';
