-- =====================================================================
-- MIGRACIÓN: estado "empalme" (inmueble mostrado por el inquilino)
-- Fecha: 2026-08-10
-- Caso: un inmueble ARRENDADO que el inquilino de salida muestra directamente
-- para no perder días de vacancia (empalme). El interesado coordina la visita
-- con el TELÉFONO DEL INQUILINO; no hay asesor ni agenda (off-platform salvo el
-- badge). Mismo patrón que "ofertar": es una decisión local (estado_override)
-- que el sync NUNCA pisa; solo cambia el contacto.
--   estado_override = 'empalme'  → estado efectivo = 'empalme'
--   estado = coalesce(estado_override, estado_erp)  (invariante intacto)
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

-- 1a. Permitir 'empalme' en el override local (antes solo 'disponible').
ALTER TABLE public.inmuebles DROP CONSTRAINT IF EXISTS inmuebles_estado_override_check;
ALTER TABLE public.inmuebles ADD CONSTRAINT inmuebles_estado_override_check
    CHECK (estado_override IS NULL OR estado_override IN ('disponible', 'empalme'));

-- 1b. Permitir 'empalme' en el estado EFECTIVO (el check original solo tenía
-- disponible/arrendado/inactivo; los 3 valores en uso se conservan intactos).
ALTER TABLE public.inmuebles DROP CONSTRAINT IF EXISTS inmuebles_estado_check;
ALTER TABLE public.inmuebles ADD CONSTRAINT inmuebles_estado_check
    CHECK (estado IN ('disponible', 'arrendado', 'inactivo', 'empalme'));

-- 2. Contacto del inquilino que muestra (lo carga el admin a mano; el ERP no lo trae).
ALTER TABLE public.inmuebles
    ADD COLUMN IF NOT EXISTS empalme_contacto_nombre TEXT,
    ADD COLUMN IF NOT EXISTS empalme_contacto_telefono TEXT;

-- Nota: como estado_erp/estado_override, estas columnas NO se otorgan a anon.
-- La Fase 2 (comportamiento del agente comercial) las leerá vía service_role.
