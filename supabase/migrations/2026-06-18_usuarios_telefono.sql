-- =====================================================================
-- MIGRACIÓN: teléfono del asesor en usuarios
-- Fecha: 2026-06-18
-- Lo usamos en el payload de "Confirmar citas" hacia el flujo n8n
-- (nombre + teléfono del asesor). Es opcional (nullable).
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS telefono TEXT;
