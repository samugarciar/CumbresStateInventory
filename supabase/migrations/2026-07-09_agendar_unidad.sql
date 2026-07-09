-- =====================================================================
-- MIGRACIÓN (B): agendar "a nivel unidad"
-- Fecha: 2026-07-09
-- Complementa la parte A (2026-07-09_disponibilidad_unidad.sql). Cuando el
-- agente resolvió modo='disponibilidad_unidad' (varios aptos de la MISMA
-- unidad + MISMO tipo que comparten franjas), ahora puede agendar la visita
-- "a la unidad" sin comprometer un apto puntual: la cita queda con
-- alcance='unidad', el nombre de la unidad y un snapshot de los aptos que
-- estaban disponibles en ese momento. El inmueble_id sigue siendo NOT NULL:
-- guardamos un apto representativo (el más barato) como ancla de la franja.
-- Cambian las firmas de agendar_cita y agendar_cita_por_texto → DROP + CREATE.
-- Idempotente. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas en citas (idempotentes)
-- ---------------------------------------------------------------------
ALTER TABLE public.citas
    ADD COLUMN IF NOT EXISTS alcance        TEXT NOT NULL DEFAULT 'inmueble',
    ADD COLUMN IF NOT EXISTS unidad         TEXT,
    ADD COLUMN IF NOT EXISTS aptos_snapshot JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citas_alcance_valido') THEN
        ALTER TABLE public.citas
            ADD CONSTRAINT citas_alcance_valido CHECK (alcance IN ('inmueble', 'unidad'));
    END IF;
END $$;

COMMENT ON COLUMN public.citas.alcance IS 'inmueble = visita a un apto puntual; unidad = visita a la unidad (varios aptos equivalentes)';
COMMENT ON COLUMN public.citas.unidad IS 'Nombre de la unidad cuando alcance=unidad (ej. "Mi Mundo"); NULL cuando alcance=inmueble';
COMMENT ON COLUMN public.citas.aptos_snapshot IS 'Aptos disponibles al agendar [{inmueble_id,titulo,precio,habitaciones,banos}] (solo alcance=unidad)';

-- ---------------------------------------------------------------------
-- 2. agendar_cita: acepta alcance/unidad/aptos_snapshot.
--    Los defaults reproducen EXACTAMENTE el comportamiento actual
--    (alcance='inmueble'), así que los llamados existentes no se rompen.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.agendar_cita_por_texto(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT);

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

    IF v_inmueble.estado <> 'disponible' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El inmueble ya no está disponible.');
    END IF;

    -- unidad efectiva de la cita (solo se guarda cuando alcance=unidad)
    v_unidad := coalesce(nullif(trim(p_unidad), ''), v_inmueble.unidad);

    -- Franja que cubre el rango pedido, en la misma ubicación.
    -- Se permiten varias citas a la vez en la misma franja (misma unidad).
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

GRANT EXECUTE ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. agendar_cita_por_texto: nuevo p_alcance + p_tipo_transaccion.
--
--   p_alcance='inmueble' (default) → comportamiento clásico: exige que el
--     texto resuelva a UN solo inmueble y delega en agendar_cita.
--   p_alcance='unidad' → exige que el texto resuelva a ≥1 apto de la MISMA
--     unidad + MISMO tipo (igual que modo='disponibilidad_unidad'); agenda
--     con alcance='unidad', guardando el snapshot de aptos disponibles y un
--     apto representativo como ancla de franja.
--
-- POST /rest/v1/rpc/agendar_cita_por_texto
--   { "p_texto": "Mi Mundo", "p_fecha": "2026-07-12",
--     "p_hora_inicio": "13:00", "p_hora_fin": "14:00",
--     "p_cliente_nombre": "Juan Pérez", "p_cliente_telefono": "3001234567",
--     "p_alcance": "unidad", "p_tipo_transaccion": "arriendo" }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cita_por_texto(
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
    v_alcance     TEXT := coalesce(nullif(trim(p_alcance), ''), 'inmueble');
    v_count       INT;
    v_id          UUID;
    v_dist_unidad INT;
    v_dist_tipo   INT;
    v_sin_unidad  INT;
    v_unidad      TEXT;
    v_rep         UUID;
    v_snapshot    JSONB;
BEGIN
    IF v_alcance NOT IN ('inmueble', 'unidad') THEN
        RETURN jsonb_build_object('success', false, 'error', 'alcance inválido (usa inmueble o unidad).');
    END IF;

    -- ---- Agendar a la UNIDAD ----
    IF v_alcance = 'unidad' THEN
        SELECT count(*), count(DISTINCT r.unidad), count(DISTINCT r.tipo_transaccion),
               count(*) FILTER (WHERE r.unidad IS NULL), max(r.unidad)
        INTO v_count, v_dist_unidad, v_dist_tipo, v_sin_unidad, v_unidad
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

        IF v_count = 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'No encontré aptos disponibles que coincidan con "' || p_texto ||
                         '". Sé más específico (nombre de la unidad y, si aplica, arriendo o venta).'
            );
        END IF;

        IF NOT (v_dist_unidad = 1 AND v_dist_tipo = 1 AND v_sin_unidad = 0) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'No pude identificar una sola unidad y tipo para "' || p_texto ||
                         '". Indica la unidad exacta y si es arriendo o venta, o agenda un apto puntual (alcance=inmueble).'
            );
        END IF;

        -- snapshot de aptos + representativo (el más barato; comparten franjas)
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'inmueble_id', r.id, 'titulo', r.titulo,
                       'precio', r.precio, 'habitaciones', r.habitaciones, 'banos', r.banos
                   ) ORDER BY r.precio),
               (array_agg(r.id ORDER BY r.precio))[1]
        INTO v_snapshot, v_rep
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

        RETURN public.agendar_cita(
            v_rep, p_fecha, p_hora_inicio, p_hora_fin,
            p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_notas,
            'unidad', v_unidad, v_snapshot
        );
    END IF;

    -- ---- Agendar a un INMUEBLE puntual (comportamiento clásico) ----
    SELECT count(*) INTO v_count
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion);

    IF v_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No encontré ningún inmueble disponible que coincida con "' || p_texto ||
                     '". Sé más específico: el nombre del edificio, el número de apartamento o el barrio.'
        );
    END IF;

    IF v_count > 1 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Encontré varios inmuebles que coinciden con "' || p_texto ||
                     '". Sé más específico para saber cuál agendar (agrega el número de apartamento o el edificio), o agenda a la unidad con alcance=unidad.'
        );
    END IF;

    SELECT r.id INTO v_id
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
    LIMIT 1;

    -- Delega TODA la validación y el formato de respuesta (alcance=inmueble por default)
    RETURN public.agendar_cita(
        v_id, p_fecha, p_hora_inicio, p_hora_fin,
        p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_notas
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cita_por_texto(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Recargar el cache de PostgREST para que exponga las firmas nuevas
NOTIFY pgrst, 'reload schema';
