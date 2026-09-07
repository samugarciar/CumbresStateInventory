-- =====================================================================
-- MIGRACIÓN: cola de revisión de captaciones ("modo cola")
-- Fecha: 2026-09-04
--
-- POR QUÉ EXISTE ESTA TABLA
-- El bookmarklet en modo lista capturaba anuncios de Facebook directamente
-- como prospectos, pero desde una lista de resultados NO hay descripción: sin
-- ella el calificador no tiene con qué juzgar y devolvía siempre lo mismo
-- (score 0.85, probabilidad 0.5). Se comprobó con datos reales: de 49 filas en
-- la bandeja, 33 eran así — links disfrazados de prospectos, que además
-- costaron una llamada al modelo cada uno.
--
-- La cola separa DESCUBRIR de CALIFICAR: la lista solo aporta URLs (gratis, sin
-- LLM) y el prospecto se crea cuando el asesor abre la publicación y la captura
-- completa. Un anuncio solo entra al CRM cuando hay algo que calificar.
--
-- Escrituras: cliente admin (service role). RLS: solo admin, igual que
-- captacion_prospectos — /captaciones es un módulo de administración.
-- Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.captacion_cola (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,

    fuente TEXT NOT NULL CHECK (fuente IN ('mercadolibre', 'facebook', 'otro')),
    -- id canónico del anuncio (fb-<id> / MCO…): la MISMA clave que usa
    -- captacion_prospectos, para poder cruzar cola y CRM sin heurísticas.
    fuente_id TEXT,
    url TEXT NOT NULL,

    -- Lo poco que se ve en una lista de resultados. Sirve para orientarse al
    -- decidir qué abrir; NO se usa para calificar.
    titulo TEXT,
    precio NUMERIC CHECK (precio IS NULL OR precio >= 0),

    estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'capturado', 'omitido')),
    -- Se llena cuando la captura completa crea (o reencuentra) el prospecto.
    prospecto_id UUID REFERENCES public.captacion_prospectos(id) ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Un anuncio entra a la cola una sola vez por inmobiliaria. Es lo que hace
    -- que volver a pasar el bookmarklet por la misma búsqueda no repita nada.
    UNIQUE (inmobiliaria_id, fuente, fuente_id)
);

CREATE INDEX IF NOT EXISTS idx_captacion_cola_pendientes
    ON public.captacion_cola(inmobiliaria_id, created_at)
    WHERE estado = 'pendiente';

ALTER TABLE public.captacion_cola ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'captacion_cola'
          AND policyname = 'Admins gestionan la cola de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins gestionan la cola de su inmobiliaria"
            ON public.captacion_cola
            FOR ALL
            USING (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            )
            WITH CHECK (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            );
    END IF;
END $$;

-- updated_at se fija desde el código al actualizar (misma convención que
-- captacion_prospectos: el proyecto no usa triggers para esto).
