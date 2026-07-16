-- =====================================================================
-- MIGRACIÓN: persistencia del Asesor BI (conversaciones + informes/artifacts)
-- Fecha: 2026-07-16
-- Hoy el chat de /inteligencia vive solo en memoria del navegador: se pierde
-- al refrescar. Esta migración agrega:
--   1) bi_conversaciones + bi_mensajes: historial de chat, PRIVADO por
--      usuario (usuario_id = auth.uid()) — como cualquier historial de chat.
--   2) bi_artefactos: informes/briefs que el asesor genera con la tool
--      generar_informe. COMPARTIDOS por inmobiliaria (cualquier admin los ve),
--      porque un informe está pensado para consultarse en equipo, no como
--      nota personal — a diferencia del chat.
-- Ninguna de las tres tiene grant para anon (son datos internos del panel
-- admin). No se toca el rol bi_reader (es de solo lectura para el agente
-- sobre datos de negocio; estas tablas no son datos de negocio).
-- Ejecutar en el SQL Editor de Supabase. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. bi_conversaciones
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bi_conversaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bi_conversaciones_usuario ON public.bi_conversaciones(usuario_id, updated_at DESC);

ALTER TABLE public.bi_conversaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'bi_conversaciones' AND policyname = 'Admin gestiona sus propias conversaciones'
    ) THEN
        CREATE POLICY "Admin gestiona sus propias conversaciones"
            ON public.bi_conversaciones
            FOR ALL
            USING (
                usuario_id = auth.uid() AND
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            )
            WITH CHECK (
                usuario_id = auth.uid() AND
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            );
    END IF;
END $$;

REVOKE ALL ON public.bi_conversaciones FROM anon;

-- ---------------------------------------------------------------------
-- 2. bi_mensajes
-- contenido = jsonb con la forma Parte[] del cliente:
--   [{tipo:'texto', texto} | {tipo:'grafico', grafico:{...}} | {tipo:'informe', informe:{...}}]
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bi_mensajes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversacion_id UUID NOT NULL REFERENCES public.bi_conversaciones(id) ON DELETE CASCADE,
    rol TEXT NOT NULL CHECK (rol IN ('usuario', 'asesor')),
    contenido JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bi_mensajes_conversacion ON public.bi_mensajes(conversacion_id, created_at);

ALTER TABLE public.bi_mensajes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'bi_mensajes' AND policyname = 'Admin gestiona mensajes de sus conversaciones'
    ) THEN
        CREATE POLICY "Admin gestiona mensajes de sus conversaciones"
            ON public.bi_mensajes
            FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM public.bi_conversaciones c
                    WHERE c.id = conversacion_id AND c.usuario_id = auth.uid()
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.bi_conversaciones c
                    WHERE c.id = conversacion_id AND c.usuario_id = auth.uid()
                )
            );
    END IF;
END $$;

REVOKE ALL ON public.bi_mensajes FROM anon;

-- ---------------------------------------------------------------------
-- 3. bi_artefactos (informes/briefs — "artifacts")
-- Compartidos por inmobiliaria a propósito (ver cabecera). conversacion_id
-- es referencia blanda: si se borra la conversación, el informe se conserva
-- (ON DELETE SET NULL) porque el valor del informe es independiente del chat
-- que lo originó.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bi_artefactos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, -- quién lo generó
    conversacion_id UUID REFERENCES public.bi_conversaciones(id) ON DELETE SET NULL,
    tipo TEXT NOT NULL DEFAULT 'informe' CHECK (tipo IN ('brief_diario', 'informe', 'otro')),
    titulo TEXT NOT NULL,
    resumen TEXT,
    contenido_markdown TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bi_artefactos_inmobiliaria ON public.bi_artefactos(inmobiliaria_id, created_at DESC);

ALTER TABLE public.bi_artefactos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'bi_artefactos' AND policyname = 'Admins ven y gestionan los informes de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins ven y gestionan los informes de su inmobiliaria"
            ON public.bi_artefactos
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

REVOKE ALL ON public.bi_artefactos FROM anon;

NOTIFY pgrst, 'reload schema';
