-- =====================================================================
-- MIGRACIÓN: permitir varias citas a la vez en una misma franja
-- Fecha: 2026-06-20
-- Cambio de modelo: una franja podía tener varias citas pero NO cruzadas en
-- el tiempo (un cliente por bloque). Ahora se permiten varias citas a la vez
-- (visitas grupales) para la misma unidad. Como cada franja cubre exactamente
-- una unidad/ubicación, todas sus citas son de la misma unidad por
-- construcción, así que basta con quitar el candado anti-cruce.
-- El "asesor en dos lugares a la vez" sigue evitado: la app no deja crear
-- franjas que se solapen para el mismo asesor.
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

-- 1. Quitar el constraint de exclusión que impedía citas cruzadas en una franja
ALTER TABLE public.citas DROP CONSTRAINT IF EXISTS citas_sin_cruce;

-- 2. consultar_disponibilidad: la franja completa queda disponible (ya no se
--    restan las citas existentes, porque varias citas pueden coexistir).
CREATE OR REPLACE FUNCTION public.consultar_disponibilidad(
    p_inmueble_id UUID,
    p_fecha_desde DATE DEFAULT CURRENT_DATE,
    p_fecha_hasta DATE DEFAULT NULL
)
RETURNS TABLE (franja_id UUID, fecha DATE, hora_inicio TIME, hora_fin TIME, asesor TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_hasta DATE := coalesce(p_fecha_hasta, p_fecha_desde + 14);
BEGIN
    RETURN QUERY
    SELECT fr.id, fr.fecha, fr.hora_inicio, fr.hora_fin, u.nombre_completo
    FROM franjas_horarias fr
    JOIN inmuebles base ON base.id = fr.inmueble_id
    JOIN inmuebles obj ON obj.id = p_inmueble_id
        AND obj.inmobiliaria_id = fr.inmobiliaria_id
        AND ubicacion_key(obj.unidad, obj.direccion) = ubicacion_key(base.unidad, base.direccion)
    JOIN usuarios u ON u.id = fr.asesor_id
    WHERE fr.fecha BETWEEN p_fecha_desde AND v_hasta
      AND obj.estado = 'disponible'
    ORDER BY fr.fecha, fr.hora_inicio;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_disponibilidad(UUID, DATE, DATE) TO anon, authenticated;

-- 3. agendar_cita: encuentra la franja que cubre el rango en la misma ubicación
--    (ya NO exige que no haya citas cruzadas) e inserta.
CREATE OR REPLACE FUNCTION public.agendar_cita(
    p_inmueble_id UUID,
    p_fecha DATE,
    p_hora_inicio TIME,
    p_hora_fin TIME,
    p_cliente_nombre TEXT,
    p_cliente_telefono TEXT,
    p_cliente_email TEXT DEFAULT NULL,
    p_notas TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inmueble RECORD;
    v_franja RECORD;
    v_cita_id UUID;
BEGIN
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
        cliente_nombre, cliente_telefono, cliente_email, notas, origen
    ) VALUES (
        v_inmueble.inmobiliaria_id, v_franja.id, p_inmueble_id, p_fecha, p_hora_inicio, p_hora_fin,
        trim(p_cliente_nombre), trim(p_cliente_telefono), nullif(trim(p_cliente_email), ''), p_notas, 'n8n'
    )
    RETURNING id INTO v_cita_id;

    RETURN jsonb_build_object(
        'success', true,
        'cita_id', v_cita_id,
        'inmueble', v_inmueble.titulo,
        'fecha', p_fecha,
        'hora_inicio', p_hora_inicio,
        'hora_fin', p_hora_fin,
        'asesor', v_franja.asesor
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
