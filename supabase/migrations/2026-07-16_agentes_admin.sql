-- =====================================================================
-- MIGRACIÓN: administración de agentes (/agentes)
-- Fecha: 2026-07-16
-- Panel para ver el consumo/actividad de los agentes y prenderlos/apagarlos:
--   1) agentes_config: switch activo + límite mensual (solo BI) por agente.
--   2) bi_uso: medición del Asesor BI (tokens y costo USD por petición).
--   3) Kill switch del agente comercial de WhatsApp: las RPCs que usa el
--      agente chequean agentes_config y, si está pausado, responden con un
--      mensaje claro EN EL MISMO FORMATO que ya manejan (success:false /
--      modo='agente_pausado') — el flujo de n8n no se rompe, solo recibe
--      la señal de pausa. Se re-crean 4 funciones SIN cambiar su lógica:
--      consultar_disponibilidad_por_texto, agendar_cita,
--      solicitar_apertura_agenda y cancelar_cita.
--      (agendar_cita_por_texto hereda la guarda vía agendar_cita; los reads
--      puros consultar_disponibilidad y buscar_inmueble_por_codigo quedan
--      SIN guarda a propósito: no ejecutan acciones y pausarlos solo haría
--      mentir al agente con "no hay resultados".)
-- Ninguna tabla nueva tiene acceso anon. Idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. agentes_config
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agentes_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    agente TEXT NOT NULL CHECK (agente IN ('arriendabot_bi', 'comercial_whatsapp')),
    activo BOOLEAN NOT NULL DEFAULT true,
    -- Límite de gasto mensual en USD (solo aplica al BI, cuyo costo medimos).
    -- NULL = sin límite. Al alcanzarlo, el BI responde como pausado.
    limite_mensual_usd NUMERIC(10, 2) CHECK (limite_mensual_usd IS NULL OR limite_mensual_usd > 0),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    UNIQUE (inmobiliaria_id, agente)
);

ALTER TABLE public.agentes_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'agentes_config' AND policyname = 'Admins gestionan los agentes de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins gestionan los agentes de su inmobiliaria"
            ON public.agentes_config
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

REVOKE ALL ON public.agentes_config FROM anon;

-- Fila por agente para cada inmobiliaria existente (activos por defecto)
INSERT INTO public.agentes_config (inmobiliaria_id, agente)
SELECT i.id, a.agente
FROM public.inmobiliarias i
CROSS JOIN (VALUES ('arriendabot_bi'), ('comercial_whatsapp')) AS a(agente)
ON CONFLICT (inmobiliaria_id, agente) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. bi_uso — medición del Asesor BI (una fila por petición al chat)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bi_uso (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    conversacion_id UUID REFERENCES public.bi_conversaciones(id) ON DELETE SET NULL,
    modelo TEXT NOT NULL,
    tokens_entrada INTEGER NOT NULL DEFAULT 0,        -- input sin cache
    tokens_salida INTEGER NOT NULL DEFAULT 0,
    tokens_cache_lectura INTEGER NOT NULL DEFAULT 0,  -- prompt caching: leídos (0.1x)
    tokens_cache_escritura INTEGER NOT NULL DEFAULT 0,-- prompt caching: escritos (1.25x)
    costo_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bi_uso_inmobiliaria ON public.bi_uso(inmobiliaria_id, created_at DESC);

ALTER TABLE public.bi_uso ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'bi_uso' AND policyname = 'Admins ven y registran el uso BI de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins ven y registran el uso BI de su inmobiliaria"
            ON public.bi_uso
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

REVOKE ALL ON public.bi_uso FROM anon;

-- ---------------------------------------------------------------------
-- 3. Helper interno: ¿está pausado el agente comercial de esta inmobiliaria?
--    Sin fila de config = activo (fail-open a propósito: la pausa es una
--    acción explícita del admin, nunca un accidente de datos).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agente_comercial_pausado(p_inmobiliaria UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT NOT COALESCE(
        (SELECT ac.activo FROM agentes_config ac
         WHERE ac.inmobiliaria_id = p_inmobiliaria AND ac.agente = 'comercial_whatsapp'),
        true
    );
$$;

-- Interna: solo la llaman las funciones SECURITY DEFINER (Postgres da EXECUTE
-- a PUBLIC por defecto en funciones nuevas — lección aprendida).
REVOKE EXECUTE ON FUNCTION public.agente_comercial_pausado(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4a. consultar_disponibilidad_por_texto — misma lógica de 2026-07-09 +
--     guarda de pausa (fila única modo='agente_pausado').
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_disponibilidad_por_texto(
    p_texto TEXT,
    p_fecha_desde DATE DEFAULT CURRENT_DATE,
    p_fecha_hasta DATE DEFAULT NULL,
    p_tipo_transaccion TEXT DEFAULT NULL
)
RETURNS TABLE (
    modo        TEXT,
    inmueble_id UUID,
    titulo      TEXT,
    direccion   TEXT,
    unidad      TEXT,
    aptos_count INTEGER,
    aptos       JSONB,
    franja_id   UUID,
    fecha       DATE,
    hora_inicio TIME,
    hora_fin    TIME,
    asesor      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_hasta        DATE := coalesce(p_fecha_hasta, p_fecha_desde + 14);
    v_count        INT;
    v_dist_unidad  INT;
    v_dist_tipo    INT;
    v_sin_unidad   INT;
    v_unidad       TEXT;
    v_aptos        JSONB;
    v_aptos_count  INT;
    v_rep          UUID;
    v_inm          RECORD;
    v_slot         RECORD;
    v_tiene        BOOLEAN := false;
    v_inmobiliaria UUID;
BEGIN
    SELECT count(*) INTO v_count
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion);

    -- Sin resultados
    IF v_count = 0 THEN
        modo := 'sin_resultados';
        inmueble_id := NULL; titulo := NULL; direccion := NULL; unidad := NULL; aptos_count := NULL; aptos := NULL;
        franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
        RETURN NEXT; RETURN;
    END IF;

    -- Guarda: agente comercial pausado por la inmobiliaria → señal explícita
    SELECT i.inmobiliaria_id INTO v_inmobiliaria
    FROM inmuebles i
    WHERE i.id = (SELECT r.id FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r LIMIT 1);

    IF public.agente_comercial_pausado(v_inmobiliaria) THEN
        modo := 'agente_pausado';
        inmueble_id := NULL; titulo := NULL; direccion := NULL; unidad := NULL; aptos_count := NULL; aptos := NULL;
        franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
        RETURN NEXT; RETURN;
    END IF;

    -- Un solo inmueble → disponibilidad a nivel apto
    IF v_count = 1 THEN
        SELECT r.id, r.titulo, r.direccion, r.unidad INTO v_inm
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
        LIMIT 1;

        FOR v_slot IN
            SELECT s.franja_id, s.fecha, s.hora_inicio, s.hora_fin, s.asesor
            FROM public.consultar_disponibilidad(v_inm.id, p_fecha_desde, v_hasta) s
        LOOP
            v_tiene := true;
            modo := 'disponibilidad';
            inmueble_id := v_inm.id; titulo := v_inm.titulo; direccion := v_inm.direccion;
            unidad := v_inm.unidad; aptos_count := NULL; aptos := NULL;
            franja_id := v_slot.franja_id; fecha := v_slot.fecha; hora_inicio := v_slot.hora_inicio; hora_fin := v_slot.hora_fin; asesor := v_slot.asesor;
            RETURN NEXT;
        END LOOP;

        IF NOT v_tiene THEN
            modo := 'sin_disponibilidad';
            inmueble_id := v_inm.id; titulo := v_inm.titulo; direccion := v_inm.direccion;
            unidad := v_inm.unidad; aptos_count := NULL; aptos := NULL;
            franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
            RETURN NEXT;
        END IF;
        RETURN;
    END IF;

    -- ≥2 inmuebles: ¿todos la misma unidad (no nula) y mismo tipo?
    SELECT count(DISTINCT r.unidad), count(DISTINCT r.tipo_transaccion),
           count(*) FILTER (WHERE r.unidad IS NULL), max(r.unidad)
    INTO v_dist_unidad, v_dist_tipo, v_sin_unidad, v_unidad
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

    IF v_dist_unidad = 1 AND v_dist_tipo = 1 AND v_sin_unidad = 0 THEN
        -- disponibilidad_unidad: lista de aptos + franjas compartidas (vía un apto representativo)
        -- Nota: NO usar min(r.id): Postgres no tiene min(uuid).
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'inmueble_id', r.id, 'titulo', r.titulo,
                       'precio', r.precio, 'habitaciones', r.habitaciones, 'banos', r.banos
                   ) ORDER BY r.precio),
               count(*), (array_agg(r.id ORDER BY r.precio))[1]
        INTO v_aptos, v_aptos_count, v_rep
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

        FOR v_slot IN
            SELECT s.franja_id, s.fecha, s.hora_inicio, s.hora_fin, s.asesor
            FROM public.consultar_disponibilidad(v_rep, p_fecha_desde, v_hasta) s
        LOOP
            v_tiene := true;
            modo := 'disponibilidad_unidad';
            inmueble_id := NULL; titulo := NULL; direccion := NULL;
            unidad := v_unidad; aptos_count := v_aptos_count; aptos := v_aptos;
            franja_id := v_slot.franja_id; fecha := v_slot.fecha; hora_inicio := v_slot.hora_inicio; hora_fin := v_slot.hora_fin; asesor := v_slot.asesor;
            RETURN NEXT;
        END LOOP;

        IF NOT v_tiene THEN
            modo := 'sin_disponibilidad';
            inmueble_id := NULL; titulo := NULL; direccion := NULL;
            unidad := v_unidad; aptos_count := v_aptos_count; aptos := v_aptos;
            franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
            RETURN NEXT;
        END IF;
        RETURN;
    END IF;

    -- Mezcla (unidades/tipos distintos, o inmuebles sin unidad) → candidatos
    FOR v_inm IN
        SELECT r.id, r.titulo, r.direccion, r.unidad
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
        ORDER BY r.titulo
        LIMIT 10
    LOOP
        modo := 'candidatos';
        inmueble_id := v_inm.id; titulo := v_inm.titulo; direccion := v_inm.direccion; unidad := v_inm.unidad;
        aptos_count := NULL; aptos := NULL;
        franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
        RETURN NEXT;
    END LOOP;
    RETURN;
END;
$$;

-- ---------------------------------------------------------------------
-- 4b. agendar_cita — misma lógica de 2026-07-09 (alcance unidad) + guarda.
--     agendar_cita_por_texto delega aquí, así que hereda la pausa sola.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cita(
    p_inmueble_id      UUID,
    p_fecha            DATE,
    p_hora_inicio      TIME,
    p_hora_fin         TIME,
    p_cliente_nombre   TEXT,
    p_cliente_telefono TEXT,
    p_cliente_email    TEXT  DEFAULT NULL,
    p_notas            TEXT  DEFAULT NULL,
    p_alcance          TEXT  DEFAULT 'inmueble',
    p_unidad           TEXT  DEFAULT NULL,
    p_aptos_snapshot   JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inmueble RECORD;
    v_franja   RECORD;
    v_cita_id  UUID;
    v_alcance  TEXT := coalesce(nullif(trim(p_alcance), ''), 'inmueble');
    v_unidad   TEXT;
BEGIN
    IF v_alcance NOT IN ('inmueble', 'unidad') THEN
        RETURN jsonb_build_object('success', false, 'error', 'alcance inválido (usa inmueble o unidad).');
    END IF;

    IF p_cliente_nombre IS NULL OR trim(p_cliente_nombre) = ''
       OR p_cliente_telefono IS NULL OR trim(p_cliente_telefono) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El nombre y el teléfono del cliente son obligatorios.');
    END IF;

    IF p_hora_fin <= p_hora_inicio THEN
        RETURN jsonb_build_object('success', false, 'error', 'La hora de fin debe ser posterior a la hora de inicio.');
    END IF;

    IF EXTRACT(MINUTE FROM p_hora_inicio)::int % 30 <> 0 OR EXTRACT(MINUTE FROM p_hora_fin)::int % 30 <> 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Las citas deben iniciar y terminar en bloques de 30 minutos (ej. 09:00, 09:30, 10:00).');
    END IF;

    IF p_fecha < CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se pueden agendar citas en fechas pasadas.');
    END IF;

    SELECT id, inmobiliaria_id, estado, unidad, direccion, titulo
    INTO v_inmueble FROM inmuebles WHERE id = p_inmueble_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Inmueble no encontrado.');
    END IF;

    -- Guarda: agente comercial pausado por la inmobiliaria
    IF public.agente_comercial_pausado(v_inmueble.inmobiliaria_id) THEN
        RETURN jsonb_build_object(
            'success', false, 'agente_pausado', true,
            'error', 'El agente está pausado temporalmente por la inmobiliaria. Un asesor humano continuará la conversación; no se agendó nada.'
        );
    END IF;

    IF v_inmueble.estado <> 'disponible' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El inmueble ya no está disponible.');
    END IF;

    v_unidad := coalesce(nullif(trim(p_unidad), ''), v_inmueble.unidad);

    SELECT fr.id, fr.asesor_id, u.nombre_completo AS asesor
    INTO v_franja
    FROM franjas_horarias fr
    JOIN inmuebles base ON base.id = fr.inmueble_id
    JOIN usuarios u ON u.id = fr.asesor_id
    WHERE fr.inmobiliaria_id = v_inmueble.inmobiliaria_id
      AND fr.fecha = p_fecha
      AND fr.hora_inicio <= p_hora_inicio
      AND fr.hora_fin >= p_hora_fin
      AND ubicacion_key(base.unidad, base.direccion) = ubicacion_key(v_inmueble.unidad, v_inmueble.direccion)
    ORDER BY fr.hora_inicio
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No hay una franja del asesor que cubra ese horario para este inmueble. Usa consultar_disponibilidad para ver los horarios.');
    END IF;

    INSERT INTO citas (
        inmobiliaria_id, franja_id, inmueble_id, fecha, hora_inicio, hora_fin,
        cliente_nombre, cliente_telefono, cliente_email, notas, origen,
        alcance, unidad, aptos_snapshot
    ) VALUES (
        v_inmueble.inmobiliaria_id, v_franja.id, p_inmueble_id, p_fecha, p_hora_inicio, p_hora_fin,
        trim(p_cliente_nombre), trim(p_cliente_telefono), nullif(trim(p_cliente_email), ''), p_notas, 'n8n',
        v_alcance,
        CASE WHEN v_alcance = 'unidad' THEN v_unidad         ELSE NULL END,
        CASE WHEN v_alcance = 'unidad' THEN p_aptos_snapshot ELSE NULL END
    )
    RETURNING id INTO v_cita_id;

    RETURN jsonb_build_object(
        'success', true,
        'cita_id', v_cita_id,
        'alcance', v_alcance,
        'inmueble', CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE v_inmueble.titulo END,
        'unidad', CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE NULL END,
        'aptos_count', CASE WHEN v_alcance = 'unidad' AND p_aptos_snapshot IS NOT NULL
                            THEN jsonb_array_length(p_aptos_snapshot) ELSE NULL END,
        'fecha', p_fecha,
        'hora_inicio', p_hora_inicio,
        'hora_fin', p_hora_fin,
        'asesor', v_franja.asesor
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 4c. solicitar_apertura_agenda — misma lógica de 2026-07-11 (con tarea) + guarda.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_apertura_agenda(
    p_texto            TEXT,
    p_fecha            DATE,
    p_hora_inicio      TIME,
    p_hora_fin         TIME,
    p_cliente_nombre   TEXT,
    p_cliente_telefono TEXT,
    p_cliente_email    TEXT DEFAULT NULL,
    p_notas            TEXT DEFAULT NULL,
    p_alcance          TEXT DEFAULT 'inmueble',
    p_tipo_transaccion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_alcance      TEXT := coalesce(nullif(trim(p_alcance), ''), 'inmueble');
    v_count        INT;
    v_dist_unidad  INT;
    v_dist_tipo    INT;
    v_sin_unidad   INT;
    v_unidad       TEXT;
    v_inm          RECORD;
    v_inmobiliaria UUID;
    v_ya_franja    BOOLEAN;
    v_dup          RECORD;
    v_id           UUID;
    v_nombre_pub   TEXT;
BEGIN
    IF v_alcance NOT IN ('inmueble', 'unidad') THEN
        RETURN jsonb_build_object('success', false, 'error', 'alcance inválido (usa inmueble o unidad).');
    END IF;

    IF p_tipo_transaccion IS NOT NULL AND p_tipo_transaccion NOT IN ('arriendo', 'venta') THEN
        RETURN jsonb_build_object('success', false, 'error', 'tipo_transaccion inválido (usa arriendo o venta).');
    END IF;

    IF p_cliente_nombre IS NULL OR trim(p_cliente_nombre) = ''
       OR p_cliente_telefono IS NULL OR trim(p_cliente_telefono) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El nombre y el teléfono del cliente son obligatorios.');
    END IF;

    IF p_hora_fin <= p_hora_inicio THEN
        RETURN jsonb_build_object('success', false, 'error', 'La hora de fin debe ser posterior a la hora de inicio.');
    END IF;

    IF EXTRACT(MINUTE FROM p_hora_inicio)::int % 30 <> 0 OR EXTRACT(MINUTE FROM p_hora_fin)::int % 30 <> 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Los horarios deben iniciar y terminar en bloques de 30 minutos (ej. 09:00, 09:30, 10:00).');
    END IF;

    IF p_fecha < CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se pueden solicitar horarios en fechas pasadas.');
    END IF;

    SELECT count(*), count(DISTINCT r.unidad), count(DISTINCT r.tipo_transaccion),
           count(*) FILTER (WHERE r.unidad IS NULL), max(r.unidad)
    INTO v_count, v_dist_unidad, v_dist_tipo, v_sin_unidad, v_unidad
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

    IF v_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No encontré ningún inmueble disponible que coincida con "' || p_texto ||
                     '". Sé más específico: el nombre del edificio, el número de apartamento o el barrio.'
        );
    END IF;

    IF v_alcance = 'unidad' THEN
        IF NOT (v_dist_unidad = 1 AND v_dist_tipo = 1 AND v_sin_unidad = 0) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'No pude identificar una sola unidad y tipo para "' || p_texto ||
                         '". Indica la unidad exacta y si es arriendo o venta, o solicita para un apto puntual (alcance=inmueble).'
            );
        END IF;
    ELSE
        IF v_count > 1 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Encontré varios inmuebles que coinciden con "' || p_texto ||
                         '". Sé más específico (agrega el número de apartamento o el edificio), o solicita a la unidad con alcance=unidad.'
            );
        END IF;
        v_unidad := NULL;
    END IF;

    SELECT r.id, r.titulo, r.direccion, r.unidad INTO v_inm
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
    ORDER BY r.precio LIMIT 1;

    SELECT i.inmobiliaria_id INTO v_inmobiliaria FROM inmuebles i WHERE i.id = v_inm.id;

    -- Guarda: agente comercial pausado por la inmobiliaria
    IF public.agente_comercial_pausado(v_inmobiliaria) THEN
        RETURN jsonb_build_object(
            'success', false, 'agente_pausado', true,
            'error', 'El agente está pausado temporalmente por la inmobiliaria. Un asesor humano continuará la conversación; no se registró la solicitud.'
        );
    END IF;

    v_nombre_pub := CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE v_inm.titulo END;

    SELECT EXISTS (
        SELECT 1
        FROM franjas_horarias fr
        JOIN inmuebles base ON base.id = fr.inmueble_id
        WHERE fr.inmobiliaria_id = v_inmobiliaria
          AND fr.fecha = p_fecha
          AND fr.hora_inicio <= p_hora_inicio
          AND fr.hora_fin >= p_hora_fin
          AND ubicacion_key(base.unidad, base.direccion) = ubicacion_key(v_inm.unidad, v_inm.direccion)
    ) INTO v_ya_franja;

    IF v_ya_franja THEN
        RETURN jsonb_build_object(
            'success', false, 'ya_disponible', true,
            'error', 'Ese horario ya está cubierto por la agenda: no necesitas solicitar apertura. Agenda directamente con agendar_cita_por_texto.'
        );
    END IF;

    SELECT s.id INTO v_dup
    FROM solicitudes_apertura s
    JOIN inmuebles si ON si.id = s.inmueble_id
    WHERE s.estado = 'pendiente'
      AND s.cliente_telefono = trim(p_cliente_telefono)
      AND s.fecha = p_fecha
      AND s.hora_inicio = p_hora_inicio
      AND s.hora_fin = p_hora_fin
      AND ubicacion_key(si.unidad, si.direccion) = ubicacion_key(v_inm.unidad, v_inm.direccion)
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 'ya_existia', true,
            'solicitud_id', v_dup.id, 'alcance', v_alcance,
            'inmueble', v_nombre_pub, 'unidad', v_unidad,
            'fecha', p_fecha, 'hora_inicio', p_hora_inicio, 'hora_fin', p_hora_fin,
            'mensaje', 'Esta solicitud ya estaba registrada y sigue pendiente de revisión.'
        );
    END IF;

    INSERT INTO solicitudes_apertura (
        inmobiliaria_id, inmueble_id, alcance, unidad, tipo_transaccion,
        fecha, hora_inicio, hora_fin,
        cliente_nombre, cliente_telefono, cliente_email, notas
    ) VALUES (
        v_inmobiliaria, v_inm.id, v_alcance, v_unidad, p_tipo_transaccion,
        p_fecha, p_hora_inicio, p_hora_fin,
        trim(p_cliente_nombre), trim(p_cliente_telefono), nullif(trim(p_cliente_email), ''), p_notas
    )
    RETURNING id INTO v_id;

    INSERT INTO tareas (
        inmobiliaria_id, usuario_id, entidad_tipo, entidad_id,
        evento_origen, evento_titulo, titulo, estado
    ) VALUES (
        v_inmobiliaria,
        NULL,
        'general',
        v_id,
        'solicitud_apertura',
        'Solicitud de apertura — ' || v_nombre_pub,
        'Aprobar o denegar: ' || trim(p_cliente_nombre) || ' · ' ||
            to_char(p_fecha, 'DD/MM') || ' ' || left(p_hora_inicio::text, 5),
        'pendiente'
    );

    RETURN jsonb_build_object(
        'success', true, 'ya_existia', false,
        'solicitud_id', v_id, 'alcance', v_alcance,
        'inmueble', v_nombre_pub, 'unidad', v_unidad,
        'fecha', p_fecha, 'hora_inicio', p_hora_inicio, 'hora_fin', p_hora_fin
    );
END;
$$;

-- ---------------------------------------------------------------------
-- 4d. cancelar_cita — misma lógica de 2026-06-12 + guarda.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_cita(
    p_cita_id UUID,
    p_cliente_telefono TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inmobiliaria UUID;
BEGIN
    SELECT c.inmobiliaria_id INTO v_inmobiliaria
    FROM citas c
    WHERE c.id = p_cita_id
      AND trim(c.cliente_telefono) = trim(p_cliente_telefono)
      AND c.estado = 'agendada';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se encontró una cita agendada con ese ID y teléfono.');
    END IF;

    -- Guarda: agente comercial pausado por la inmobiliaria
    IF public.agente_comercial_pausado(v_inmobiliaria) THEN
        RETURN jsonb_build_object(
            'success', false, 'agente_pausado', true,
            'error', 'El agente está pausado temporalmente por la inmobiliaria. Un asesor humano continuará la conversación; la cita NO se canceló.'
        );
    END IF;

    UPDATE citas
    SET estado = 'cancelada'
    WHERE id = p_cita_id
      AND trim(cliente_telefono) = trim(p_cliente_telefono)
      AND estado = 'agendada';

    RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
