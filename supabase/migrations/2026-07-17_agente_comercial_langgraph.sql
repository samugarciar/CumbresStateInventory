-- =====================================================================
-- MIGRACIÓN: persistencia del agente comercial WhatsApp (LangGraph)
-- Fecha: 2026-07-17
-- El agente comercial se está migrando desde el nodo langchain de n8n
-- (workflow 3bihDRvaLKEDcQdw) hacia un grafo LangGraph corriendo en este
-- repo (app/api/agentes/comercial-whatsapp/route.ts). n8n sigue activándolo
-- (recibe el mensaje de Kommo, llama a este endpoint, escribe la respuesta
-- de vuelta a Kommo) — solo el razonamiento se muda. Esta migración agrega:
--   1) agentes_config.prompt_sistema: el prompt del sistema (~18k chars),
--      editable en caliente desde /agentes sin redeploy — igual que hoy se
--      edita quirúrgicamente vía la API de n8n.
--   2) agente_comercial_conversaciones + agente_comercial_mensajes:
--      historial de chat, una fila por teléfono (no por usuario — aquí no
--      hay sesión humana, la identidad durable es el número de WhatsApp).
--   3) agente_comercial_uso: medición de tokens/costo por request, mismo
--      rol que bi_uso pero con el desglose de caché de OpenAI (un solo
--      número, no lectura/escritura como Anthropic).
-- Nada de esto tiene grant para anon (son datos internos). Las escrituras
-- las hace el route con el cliente admin (service role, sin sesión Supabase
-- de por medio — el llamador confiable es n8n vía X-Webhook-Token). Las
-- políticas de RLS son solo para que un admin loggeado pueda leer desde el
-- panel /agentes en el futuro. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Prompt del sistema editable en caliente
-- ---------------------------------------------------------------------
ALTER TABLE public.agentes_config
    ADD COLUMN IF NOT EXISTS prompt_sistema TEXT;

-- ---------------------------------------------------------------------
-- 2. agente_comercial_conversaciones — una fila por teléfono (upsert)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agente_comercial_conversaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    telefono TEXT NOT NULL,
    kommo_lead_id TEXT,
    kommo_contact_id TEXT,
    cliente_nombre TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (inmobiliaria_id, telefono)
);

CREATE INDEX IF NOT EXISTS idx_agente_comercial_conv_telefono
    ON public.agente_comercial_conversaciones(inmobiliaria_id, telefono);

ALTER TABLE public.agente_comercial_conversaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'agente_comercial_conversaciones'
          AND policyname = 'Admins ven las conversaciones de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins ven las conversaciones de su inmobiliaria"
            ON public.agente_comercial_conversaciones
            FOR SELECT
            USING (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            );
    END IF;
END $$;

REVOKE ALL ON public.agente_comercial_conversaciones FROM anon;

-- ---------------------------------------------------------------------
-- 3. agente_comercial_mensajes
-- herramientas_usadas: bitácora de auditoría (qué tool se llamó, con qué
-- argumentos y qué devolvió) — no es lo que ve el cliente, es para debug.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agente_comercial_mensajes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversacion_id UUID NOT NULL REFERENCES public.agente_comercial_conversaciones(id) ON DELETE CASCADE,
    rol TEXT NOT NULL CHECK (rol IN ('usuario', 'agente')),
    contenido TEXT NOT NULL,
    herramientas_usadas JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agente_comercial_mensajes_conversacion
    ON public.agente_comercial_mensajes(conversacion_id, created_at);

ALTER TABLE public.agente_comercial_mensajes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'agente_comercial_mensajes'
          AND policyname = 'Admins ven los mensajes de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins ven los mensajes de su inmobiliaria"
            ON public.agente_comercial_mensajes
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1 FROM public.agente_comercial_conversaciones c
                    WHERE c.id = conversacion_id
                      AND c.inmobiliaria_id = public.get_my_inmobiliaria()
                      AND public.get_my_role() = 'admin'
                )
            );
    END IF;
END $$;

REVOKE ALL ON public.agente_comercial_mensajes FROM anon;

-- ---------------------------------------------------------------------
-- 4. agente_comercial_uso — una fila por request al endpoint
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agente_comercial_uso (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    conversacion_id UUID REFERENCES public.agente_comercial_conversaciones(id) ON DELETE SET NULL,
    modelo TEXT NOT NULL,
    tokens_entrada INTEGER NOT NULL DEFAULT 0,
    tokens_salida INTEGER NOT NULL DEFAULT 0,
    tokens_cache INTEGER NOT NULL DEFAULT 0, -- cached_tokens de OpenAI (un solo número, no lectura/escritura)
    etapa TEXT, -- clasificación CRM de esta petición (CONTACTO INICIAL/CONSULTA/BELLO/MEDELLIN/CITA AGENDADA), NULL si el paso de formateo/clasificación falló
    escalado BOOLEAN NOT NULL DEFAULT false, -- true si el borrador venía con el prefijo [ESCALAR]
    costo_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agente_comercial_uso_inmobiliaria
    ON public.agente_comercial_uso(inmobiliaria_id, created_at DESC);

ALTER TABLE public.agente_comercial_uso ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'agente_comercial_uso'
          AND policyname = 'Admins ven el uso comercial de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins ven el uso comercial de su inmobiliaria"
            ON public.agente_comercial_uso
            FOR SELECT
            USING (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            );
    END IF;
END $$;

REVOKE ALL ON public.agente_comercial_uso FROM anon;

NOTIFY pgrst, 'reload schema';
