-- =====================================================================
-- MIGRACIÓN: override local de estado para ofertar inmuebles desocupados
-- Fecha: 2026-06-20
-- Caso: un inmueble se desocupa y queremos ofertarlo, pero el ERP lo mantiene
-- como 'arrendado' (hay temas de contrato pendientes). Nunca escribimos al ERP,
-- pero el sync sí pisa el `estado` local con el del ERP en cada corrida.
--
-- Solución (mismo patrón que asesor_id_override):
--   estado          → lo EFECTIVO (lo que ofrecemos; lo que filtran app + agente). Sin cambios de semántica para nadie.
--   estado_erp      → el estado CRUDO del ERP (referencia; permite revertir).
--   estado_override → la decisión local; el sync NO la toca. Solo 'disponible' (por ahora).
-- El sync escribe: estado = coalesce(estado_override, estado_erp).
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

ALTER TABLE public.inmuebles
    ADD COLUMN IF NOT EXISTS estado_erp TEXT,
    ADD COLUMN IF NOT EXISTS estado_override TEXT;

-- El estado actual proviene del ERP (aún no hay overrides): backfill de estado_erp.
UPDATE public.inmuebles SET estado_erp = estado WHERE estado_erp IS NULL;

-- El override solo se usa para OFERTAR (poner disponible); nada más.
ALTER TABLE public.inmuebles DROP CONSTRAINT IF EXISTS inmuebles_estado_override_check;
ALTER TABLE public.inmuebles ADD CONSTRAINT inmuebles_estado_override_check
    CHECK (estado_override IS NULL OR estado_override = 'disponible');

-- Nota: estado_erp y estado_override NO se otorgan al rol anon (el agente sigue
-- filtrando por `estado`, que ya es lo efectivo). El contrato del agente no cambia.
