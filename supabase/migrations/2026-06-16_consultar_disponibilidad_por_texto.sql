-- =====================================================================
-- MIGRACIÓN: RPCs "por texto" para el agente n8n (sin manejar UUID)
-- Fecha: 2026-06-16
-- Familia completa:
--   resolver_inmuebles_por_texto      (helper interno, resolver tokenizado)
--   consultar_disponibilidad_por_texto (busca disponibilidad por texto)
--   agendar_cita_por_texto             (agenda por texto, delega en agendar_cita)
-- Ejecutar completa en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------
-- HELPER: resolver_inmuebles_por_texto  (fuente única del matching)
--
-- Matching por TOKENS, no por substring contiguo:
--   "707 Mi Mundo"           → tokens ['707','mundo']  → busca cada uno
--   "707 de mi mundo"        → tokens ['707','mundo']  → mismo resultado
--   "apartamento 707 niquia" → tokens ['707','niquia'] → apto + barrio
--
-- Filtros de ruido: tokens < 3 chars (de, mi, el…) y palabras de tipo
-- de inmueble ('apartamento','apto','casa'…) que no aportan.
--
-- Haystack por fila: titulo || direccion || unidad || barrio || ciudad
-- (normalizado con unaccent + lowercase). TODOS los tokens deben
-- aparecer en el haystack (AND). Solo inmuebles estado='disponible'.
--
-- INTERNO: no se otorga EXECUTE a anon. Lo invocan las funciones de
-- abajo (SECURITY DEFINER), que sí están expuestas vía PostgREST.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolver_inmuebles_por_texto(p_texto TEXT)
RETURNS TABLE (id UUID, titulo TEXT, direccion TEXT)
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

    -- Normalizar → partir por espacios → descartar ruido
    SELECT ARRAY(
        SELECT t
        FROM unnest(regexp_split_to_array(unaccent(lower(trim(p_texto))), '\s+')) AS t
        WHERE length(t) >= 3
          AND NOT (t = ANY(v_stop))
    ) INTO v_tokens;

    -- Si todo era ruido, caer al texto completo normalizado
    IF array_length(v_tokens, 1) IS NULL THEN
        v_tokens := ARRAY[ unaccent(lower(trim(p_texto))) ];
    END IF;

    RETURN QUERY
    SELECT i.id, i.titulo, i.direccion
    FROM inmuebles i
    WHERE i.estado = 'disponible'
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
    ORDER BY i.titulo;
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: consultar_disponibilidad_por_texto
-- Resuelve el inmueble por texto y devuelve sus huecos libres.
-- El campo 'modo' indica el estado de la resolución:
--   'candidatos'         → texto ambiguo; filas = opciones para elegir
--   'disponibilidad'     → 1 inmueble; filas = bloques libres
--   'sin_disponibilidad' → 1 inmueble pero sin franjas en el rango
--   'sin_resultados'     → ningún inmueble coincidió
--
-- POST /rest/v1/rpc/consultar_disponibilidad_por_texto
--   { "p_texto": "707 Mi Mundo",
--     "p_fecha_desde": "2026-06-16",   ← opcional (default hoy)
--     "p_fecha_hasta": "2026-06-30" }  ← opcional (default hoy +14 días)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_disponibilidad_por_texto(
    p_texto       TEXT,
    p_fecha_desde DATE DEFAULT CURRENT_DATE,
    p_fecha_hasta DATE DEFAULT NULL
)
RETURNS TABLE (
    modo        TEXT,
    inmueble_id UUID,
    titulo      TEXT,
    direccion   TEXT,
    franja_id   UUID,
    fecha       DATE,
    hora_inicio TIME,
    hora_fin    TIME,
    asesor      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_hasta DATE    := coalesce(p_fecha_hasta, p_fecha_desde + 14);
    v_count INT;
    v_inm   RECORD;
    v_slot  RECORD;
    v_tiene BOOLEAN := false;
BEGIN
    SELECT count(*) INTO v_count FROM public.resolver_inmuebles_por_texto(p_texto);

    -- Sin resultados
    IF v_count = 0 THEN
        modo := 'sin_resultados'; inmueble_id := NULL; titulo := NULL; direccion := NULL;
        franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
        RETURN NEXT; RETURN;
    END IF;

    -- Varios → candidatos para que el agente pida precisión
    IF v_count > 1 THEN
        FOR v_inm IN
            SELECT r.id, r.titulo, r.direccion
            FROM public.resolver_inmuebles_por_texto(p_texto) r
            LIMIT 10
        LOOP
            modo := 'candidatos';
            inmueble_id := v_inm.id; titulo := v_inm.titulo; direccion := v_inm.direccion;
            franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
            RETURN NEXT;
        END LOOP;
        RETURN;
    END IF;

    -- Exactamente 1 → disponibilidad real
    SELECT r.id, r.titulo, r.direccion INTO v_inm
    FROM public.resolver_inmuebles_por_texto(p_texto) r
    LIMIT 1;

    FOR v_slot IN
        SELECT s.franja_id, s.fecha, s.hora_inicio, s.hora_fin, s.asesor
        FROM public.consultar_disponibilidad(v_inm.id, p_fecha_desde, v_hasta) s
    LOOP
        v_tiene := true;
        modo := 'disponibilidad';
        inmueble_id := v_inm.id; titulo := v_inm.titulo; direccion := v_inm.direccion;
        franja_id := v_slot.franja_id; fecha := v_slot.fecha;
        hora_inicio := v_slot.hora_inicio; hora_fin := v_slot.hora_fin; asesor := v_slot.asesor;
        RETURN NEXT;
    END LOOP;

    -- Encontrado pero sin franjas en el rango
    IF NOT v_tiene THEN
        modo := 'sin_disponibilidad';
        inmueble_id := v_inm.id; titulo := v_inm.titulo; direccion := v_inm.direccion;
        franja_id := NULL; fecha := NULL; hora_inicio := NULL; hora_fin := NULL; asesor := NULL;
        RETURN NEXT;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_disponibilidad_por_texto(TEXT, DATE, DATE) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- RPC: agendar_cita_por_texto
-- Resuelve el inmueble por texto (mismo resolver tokenizado) y, si es
-- exactamente 1, delega en agendar_cita() — con TODAS sus validaciones
-- (grilla 30 min, fecha no pasada, anti doble-reserva, hermanos de
-- ubicación) y el MISMO JSON de respuesta. Si es 0 o varios, pide
-- precisión sin agendar nada.
--
-- POST /rest/v1/rpc/agendar_cita_por_texto
--   { "p_texto": "707 Mi Mundo", "p_fecha": "2026-06-17",
--     "p_hora_inicio": "13:00", "p_hora_fin": "14:00",
--     "p_cliente_nombre": "Juan Pérez", "p_cliente_telefono": "3001234567" }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cita_por_texto(
    p_texto           TEXT,
    p_fecha           DATE,
    p_hora_inicio     TIME,
    p_hora_fin        TIME,
    p_cliente_nombre  TEXT,
    p_cliente_telefono TEXT,
    p_cliente_email   TEXT DEFAULT NULL,
    p_notas           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_count INT;
    v_id    UUID;
BEGIN
    SELECT count(*) INTO v_count FROM public.resolver_inmuebles_por_texto(p_texto);

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
                     '". Sé más específico para saber cuál agendar (agrega el número de apartamento o el edificio).'
        );
    END IF;

    SELECT r.id INTO v_id
    FROM public.resolver_inmuebles_por_texto(p_texto) r
    LIMIT 1;

    -- Delega TODA la lógica de validación y el formato de respuesta
    RETURN public.agendar_cita(
        v_id, p_fecha, p_hora_inicio, p_hora_fin,
        p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_notas
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cita_por_texto(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
