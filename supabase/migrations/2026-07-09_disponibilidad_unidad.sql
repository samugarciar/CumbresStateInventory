-- =====================================================================
-- MIGRACIÓN (A): disponibilidad "a nivel unidad" en consultar_disponibilidad_por_texto
-- Fecha: 2026-07-09
-- Cuando el texto resuelve a varios aptos de la MISMA unidad y MISMO tipo,
-- devolvemos modo='disponibilidad_unidad' con las franjas compartidas + la
-- lista de aptos, en vez de 'candidatos'. Respeta el tipo con p_tipo_transaccion.
-- Cambia firmas → DROP + CREATE (no CREATE OR REPLACE). Idempotente.
-- (Parte B —agendar a la unidad— va en una migración aparte.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- HELPER: resolver_inmuebles_por_texto
-- Ahora acepta p_tipo_transaccion y devuelve campos para agrupar por unidad.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolver_inmuebles_por_texto(TEXT);

CREATE OR REPLACE FUNCTION public.resolver_inmuebles_por_texto(
    p_texto TEXT,
    p_tipo_transaccion TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID, titulo TEXT, direccion TEXT, unidad TEXT,
    tipo_transaccion TEXT, precio NUMERIC, habitaciones INTEGER, banos INTEGER
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tokens TEXT[];
    v_stop   TEXT[] := ARRAY[
        'del','las','los','una','con','sin','por','que',
        'apartamento','apto','casa','local','oficina','bodega','lote',
        'arriendo','venta','alquiler','inmueble','propiedad'
    ];
BEGIN
    IF trim(p_texto) IS NULL OR trim(p_texto) = '' THEN
        RETURN;
    END IF;

    SELECT ARRAY(
        SELECT t
        FROM unnest(regexp_split_to_array(unaccent(lower(trim(p_texto))), '\s+')) AS t
        WHERE length(t) >= 3
          AND NOT (t = ANY(v_stop))
    ) INTO v_tokens;

    IF array_length(v_tokens, 1) IS NULL THEN
        v_tokens := ARRAY[ unaccent(lower(trim(p_texto))) ];
    END IF;

    RETURN QUERY
    SELECT i.id, i.titulo, i.direccion, i.unidad, i.tipo_transaccion, i.precio, i.habitaciones, i.banos
    FROM inmuebles i
    WHERE i.estado = 'disponible'
      AND (p_tipo_transaccion IS NULL OR i.tipo_transaccion = p_tipo_transaccion)
      AND (
          SELECT bool_and(
              unaccent(lower(
                  COALESCE(i.titulo,    '') || ' ' ||
                  COALESCE(i.direccion, '') || ' ' ||
                  COALESCE(i.unidad,    '') || ' ' ||
                  COALESCE(i.barrio,    '') || ' ' ||
                  COALESCE(i.ciudad,    '')
              )) ILIKE '%' || tok || '%'
          )
          FROM unnest(v_tokens) AS tok
      )
    ORDER BY i.precio, i.titulo;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: consultar_disponibilidad_por_texto (con modo unidad + p_tipo_transaccion)
--
-- modo:
--   'sin_resultados'        → ningún inmueble
--   'disponibilidad'        → 1 apto; filas = sus franjas libres (inmueble_id lleno)
--   'disponibilidad_unidad' → ≥2 aptos, MISMA unidad + MISMO tipo; filas = franjas
--                             compartidas; unidad, aptos_count y aptos llenos, inmueble_id=NULL
--   'sin_disponibilidad'    → resuelto pero sin franjas en el rango
--   'candidatos'            → ambigüedad (unidades/tipos distintos); filas = opciones
-- aptos = [{inmueble_id, titulo, precio, habitaciones, banos}] (solo en disponibilidad_unidad)
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.consultar_disponibilidad_por_texto(TEXT, DATE, DATE);

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
    v_hasta       DATE := coalesce(p_fecha_hasta, p_fecha_desde + 14);
    v_count       INT;
    v_dist_unidad INT;
    v_dist_tipo   INT;
    v_sin_unidad  INT;
    v_unidad      TEXT;
    v_aptos       JSONB;
    v_aptos_count INT;
    v_rep         UUID;
    v_inm         RECORD;
    v_slot        RECORD;
    v_tiene       BOOLEAN := false;
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
        -- Nota: NO usar min(r.id): Postgres no tiene min(uuid). Tomamos un
        -- representativo con (array_agg(...))[1] (cualquiera sirve: comparten franjas).
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

GRANT EXECUTE ON FUNCTION public.consultar_disponibilidad_por_texto(TEXT, DATE, DATE, TEXT) TO anon, authenticated;
