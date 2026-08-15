-- =====================================================================
-- MIGRACIÓN: medición de consumo LLM del agente de captaciones
-- Fecha: 2026-07-24
-- Mismo rol que agente_comercial_uso (una fila por llamada al modelo), para
-- que el panel /agentes muestre gasto real del agente de captaciones. El grafo
-- ya devuelve el uso por nodo (calificar + redactar); esta tabla lo persiste.
-- Escrituras con el cliente admin (service role). RLS: solo admins leen. Sin
-- grant a anon. Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.captacion_uso (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    prospecto_id UUID REFERENCES public.captacion_prospectos(id) ON DELETE SET NULL,
    modelo TEXT NOT NULL,
    tokens_entrada INTEGER NOT NULL DEFAULT 0,
    tokens_salida INTEGER NOT NULL DEFAULT 0,
    tokens_cache INTEGER NOT NULL DEFAULT 0, -- cached_tokens de OpenAI (un solo número)
    costo_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_captacion_uso_inmobiliaria
    ON public.captacion_uso(inmobiliaria_id, created_at DESC);

ALTER TABLE public.captacion_uso ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'captacion_uso'
          AND policyname = 'Admins ven el uso de captaciones de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins ven el uso de captaciones de su inmobiliaria"
            ON public.captacion_uso
            FOR SELECT
            USING (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            );
    END IF;
END $$;

REVOKE ALL ON public.captacion_uso FROM anon;

NOTIFY pgrst, 'reload schema';
