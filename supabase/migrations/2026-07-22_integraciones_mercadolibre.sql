-- =====================================================================
-- MIGRACIÓN: integración Mercado Libre (OAuth) para el agente de captaciones
-- Fecha: 2026-07-22
-- Guarda los tokens OAuth de Mercado Libre por inmobiliaria (una conexión por
-- inmobiliaria). El client_id/secret de la APP de Mercado Libre son de
-- plataforma (variables de entorno ML_CLIENT_ID/ML_CLIENT_SECRET); aquí viven
-- solo los tokens del vendedor que autoriza (access + refresh) y su
-- vencimiento. Las escrituras las hace el route del callback con el cliente
-- admin (service role).
--
-- SEGURIDAD: la tabla guarda SECRETOS (tokens). RLS queda habilitado SIN
-- políticas a propósito → ningún cliente con anon/authenticated key puede
-- leerla; solo el service role (que ignora RLS) accede, desde el servidor. El
-- estado de conexión que ve el panel se lee server-side por el service role,
-- exponiendo solo columnas no sensibles (nunca los tokens). Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.integraciones_mercadolibre (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    ml_user_id TEXT,                                -- id del vendedor en Mercado Libre
    ml_nickname TEXT,                               -- nickname del vendedor (referencia legible)
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    scope TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,   -- vencimiento del access_token (~6 h)
    conectado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (inmobiliaria_id)
);

CREATE INDEX IF NOT EXISTS idx_integraciones_ml_inmobiliaria
    ON public.integraciones_mercadolibre(inmobiliaria_id);

-- RLS habilitado, sin políticas: solo el service role (servidor) accede.
ALTER TABLE public.integraciones_mercadolibre ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.integraciones_mercadolibre FROM anon;

NOTIFY pgrst, 'reload schema';
