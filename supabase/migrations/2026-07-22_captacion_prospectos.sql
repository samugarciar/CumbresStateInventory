-- =====================================================================
-- MIGRACIÓN: modelo de datos del agente de captaciones
-- Fecha: 2026-07-22
-- 1) Registra el agente 'captaciones' en el CHECK de agentes_config, para que
--    el switch on/off + presupuesto + prompt_sistema del panel /agentes
--    funcionen igual que con los otros dos agentes.
-- 2) Crea captacion_prospectos: el CRM de prospectos de captación (dueños que
--    venden directo, detectados en Mercado Libre / Facebook). Es UPSTREAM del
--    flujo de captación existente: cuando un prospecto firma, se enlaza al
--    inmueble creado (inmueble_id).
-- Escrituras del agente: cliente admin (service role, ignora RLS). RLS: admin
-- ve/gestiona todo lo de su inmobiliaria; asesor ve lo asignado. Sin grant a
-- anon. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Registrar el agente 'captaciones' en agentes_config
--    Se localiza el CHECK actual por su definición (contiene 'comercial_whatsapp')
--    y se elimina por su nombre real, sea cual sea, antes de recrearlo. Idempotente.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_conname text;
BEGIN
    SELECT conname INTO v_conname
    FROM pg_constraint
    WHERE conrelid = 'public.agentes_config'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%comercial_whatsapp%';
    IF v_conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.agentes_config DROP CONSTRAINT %I', v_conname);
    END IF;
END $$;

ALTER TABLE public.agentes_config DROP CONSTRAINT IF EXISTS agentes_config_agente_check;

ALTER TABLE public.agentes_config
    ADD CONSTRAINT agentes_config_agente_check
    CHECK (agente IN ('arriendabot_bi', 'comercial_whatsapp', 'captaciones'));

-- ---------------------------------------------------------------------
-- 2. captacion_prospectos — CRM de prospectos de captación
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.captacion_prospectos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,

    -- Origen del listing
    fuente TEXT NOT NULL CHECK (fuente IN ('mercadolibre', 'facebook', 'otro')),
    fuente_id TEXT,                         -- id del anuncio en la fuente (dedup)
    url TEXT,

    -- Datos del inmueble (normalizados; pueden venir incompletos de la fuente)
    titulo TEXT,
    descripcion TEXT,
    tipo_inmueble TEXT CHECK (tipo_inmueble IS NULL OR tipo_inmueble IN ('casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro')),
    tipo_transaccion TEXT CHECK (tipo_transaccion IS NULL OR tipo_transaccion IN ('venta', 'arriendo')),
    ciudad TEXT,
    barrio TEXT,
    precio NUMERIC CHECK (precio IS NULL OR precio >= 0),
    area_m2 NUMERIC,
    habitaciones INTEGER,
    banos INTEGER,

    -- Calificación
    es_dueno_directo BOOLEAN,
    score NUMERIC,
    motivos TEXT,

    -- Contacto y outreach
    contacto_nombre TEXT,
    contacto_telefono TEXT,
    contacto_perfil TEXT,                   -- perfil/URL de Facebook, si aplica
    canal TEXT,                             -- whatsapp | telefono | messenger | revisar_manual
    mensaje_borrador TEXT,

    -- Pipeline
    estado TEXT NOT NULL DEFAULT 'nuevo' CHECK (estado IN (
        'nuevo', 'calificado', 'por_aprobar', 'contactado',
        'en_conversacion', 'cita', 'captado', 'descartado'
    )),
    asesor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    inmueble_id UUID REFERENCES public.inmuebles(id) ON DELETE SET NULL,  -- se enlaza al captar

    -- Seguimiento
    proximo_seguimiento DATE,
    n_seguimientos INTEGER NOT NULL DEFAULT 0,

    -- Habeas Data (Ley 1581/2012)
    base_tratamiento TEXT,
    opt_out BOOLEAN NOT NULL DEFAULT false,
    origen_dato TEXT,
    fecha_captura TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),

    notas TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Dedup: un anuncio de una fuente entra una sola vez por inmobiliaria
    UNIQUE (inmobiliaria_id, fuente, fuente_id)
);

CREATE INDEX IF NOT EXISTS idx_captacion_prospectos_inmobiliaria
    ON public.captacion_prospectos(inmobiliaria_id, estado);
CREATE INDEX IF NOT EXISTS idx_captacion_prospectos_seguimiento
    ON public.captacion_prospectos(inmobiliaria_id, proximo_seguimiento)
    WHERE proximo_seguimiento IS NOT NULL;

ALTER TABLE public.captacion_prospectos ENABLE ROW LEVEL SECURITY;

-- Admin: ve y gestiona todo lo de su inmobiliaria
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'captacion_prospectos'
          AND policyname = 'Admins gestionan prospectos de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins gestionan prospectos de su inmobiliaria"
            ON public.captacion_prospectos
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

-- Asesor: ve los prospectos asignados a él
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'captacion_prospectos'
          AND policyname = 'Asesores ven sus prospectos asignados'
    ) THEN
        CREATE POLICY "Asesores ven sus prospectos asignados"
            ON public.captacion_prospectos
            FOR SELECT
            USING (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                asesor_id = auth.uid()
            );
    END IF;
END $$;

REVOKE ALL ON public.captacion_prospectos FROM anon;

NOTIFY pgrst, 'reload schema';
