-- =====================================================================
-- MIGRACIÓN: tareas automáticas — solicitudes de apertura + sync diario
-- Fecha: 2026-07-11
-- 1) Cada solicitud de apertura nueva crea una tarea en /tareas ("Aprobar o
--    denegar…") que la app completa sola al decidir (aprobar/denegar).
-- 2) Tarea recurrente "Actualizar inmuebles" de lunes a sábado a las 6:00 AM
--    (hora de Colombia) vía pg_cron: recordatorio del sync con el ERP.
-- Idempotente. Ejecutar en el SQL Editor de Supabase.
-- NOTA: si CREATE EXTENSION pg_cron falla, habilítala primero desde
--       Dashboard → Database → Extensions → pg_cron, y re-ejecuta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. solicitar_apertura_agenda: misma firma y mismas respuestas, ahora
--    además crea la tarea (usuario_id NULL → solo la ven los admins;
--    entidad_id = solicitud → cada solicitud es su propio grupo en /tareas).
--    El dedupe (ya_existia) NO crea tarea nueva.
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
    -- ---- Validaciones básicas (mismos criterios que agendar_cita) ----
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

    -- ---- Resolver por texto (mismo resolver tokenizado del agendamiento) ----
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

    -- Representativo (el más barato; para alcance=inmueble es el único)
    SELECT r.id, r.titulo, r.direccion, r.unidad INTO v_inm
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
    ORDER BY r.precio LIMIT 1;

    SELECT i.inmobiliaria_id INTO v_inmobiliaria FROM inmuebles i WHERE i.id = v_inm.id;

    v_nombre_pub := CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE v_inm.titulo END;

    -- ---- Guarda: ¿ya hay una franja que cubre ese horario? → no es apertura ----
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

    -- ---- Dedupe: pendiente idéntica del mismo teléfono (misma ubicación + slot) ----
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

    -- ---- Insertar solicitud ----
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

    -- ---- Tarea para el admin en /tareas (la app la completa al decidir) ----
    INSERT INTO tareas (
        inmobiliaria_id, usuario_id, entidad_tipo, entidad_id,
        evento_origen, evento_titulo, titulo, estado
    ) VALUES (
        v_inmobiliaria,
        NULL,  -- solo admins la ven (RLS: el asesor exige usuario_id = auth.uid())
        'general',
        v_id,  -- agrupa la tarea bajo su solicitud
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

GRANT EXECUTE ON FUNCTION public.solicitar_apertura_agenda(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Tarea diaria "Actualizar inmuebles" (lun–sáb, 6:00 AM Bogotá)
--    Idempotente por día: si la tarea de hoy ya existe, no duplica.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tarea_actualizar_inmuebles()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inmo RECORD;
    v_hoy  DATE := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
    FOR v_inmo IN SELECT id FROM inmobiliarias LOOP
        IF NOT EXISTS (
            SELECT 1 FROM tareas t
            WHERE t.inmobiliaria_id = v_inmo.id
              AND t.evento_origen = 'sync_diario_inmuebles'
              AND (t.created_at AT TIME ZONE 'America/Bogota')::date = v_hoy
        ) THEN
            INSERT INTO tareas (
                inmobiliaria_id, usuario_id, entidad_tipo, entidad_id,
                evento_origen, evento_titulo, titulo, estado
            ) VALUES (
                v_inmo.id, NULL, 'general', NULL,
                'sync_diario_inmuebles',
                'Sincronización ERP',
                'Actualizar inmuebles (' || to_char(v_hoy, 'DD/MM') || ')',
                'pendiente'
            );
        END IF;
    END LOOP;
END;
$$;

-- La función del cron es interna: sin EXECUTE público (Postgres lo da a
-- PUBLIC por defecto en funciones nuevas y el agente anon no debe verla).
REVOKE EXECUTE ON FUNCTION public.crear_tarea_actualizar_inmuebles() FROM PUBLIC, anon, authenticated;

-- pg_cron corre en UTC: 6:00 AM América/Bogotá (UTC-5, sin horario de verano)
-- = 11:00 UTC. Días 1-6 = lunes a sábado.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tarea-actualizar-inmuebles') THEN
        PERFORM cron.unschedule('tarea-actualizar-inmuebles');
    END IF;
    PERFORM cron.schedule(
        'tarea-actualizar-inmuebles',
        '0 11 * * 1-6',
        'SELECT public.crear_tarea_actualizar_inmuebles()'
    );
END $$;

NOTIFY pgrst, 'reload schema';

-- Confirmación: debe devolver 1 fila con el job programado
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'tarea-actualizar-inmuebles';
