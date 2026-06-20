-- =====================================================================
-- MIGRACIÓN: RPC buscar_inmueble_por_codigo (agente n8n)
-- Fecha: 2026-06-20
-- Permite al agente encontrar un inmueble por su código del ERP
-- (arrendasoft_id), que el cliente ve en los portales (ej. "el 2026154").
-- SECURITY DEFINER: no expone la columna cruda a anon y puede devolver
-- inmuebles en cualquier estado (para que el agente distinga
-- "no existe" de "ya está arrendado").
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

-- arrendasoft_id es BIGINT UNIQUE → ya está indexado; el match numérico de
-- abajo (= v_codigo) usa ese índice único. No hace falta índice adicional.

CREATE OR REPLACE FUNCTION public.buscar_inmueble_por_codigo(p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    -- El código es numérico; extraemos solo dígitos por si llega como
    -- "el 2026154" o con espacios. Sin dígitos válidos → arreglo vacío.
    v_digits TEXT := regexp_replace(COALESCE(p_codigo, ''), '\D', '', 'g');
    v_codigo BIGINT;
BEGIN
    IF v_digits = '' OR length(v_digits) > 18 THEN
        RETURN '[]'::jsonb;
    END IF;
    v_codigo := v_digits::bigint;

    -- Devuelve un arreglo JSON (vacío si el código no existe). Como
    -- arrendasoft_id es UNIQUE, trae 0 o 1 elemento.
    -- Solo columnas comerciales (NO incluye arrendasoft_contrato_info ni datos del inquilino).
    -- Devuelve TODOS los estados a propósito; para limitar a disponibles,
    -- añade:  AND i.estado = 'disponible'  al WHERE.
    RETURN COALESCE((
        SELECT jsonb_agg(t)
        FROM (
            SELECT
                i.id, i.arrendasoft_id, i.titulo, i.descripcion,
                i.tipo_inmueble, i.tipo_transaccion, i.precio,
                i.direccion, i.unidad, i.ciudad, i.barrio,
                i.habitaciones, i.banos, i.estado
            FROM public.inmuebles i
            WHERE i.arrendasoft_id = v_codigo
        ) t
    ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_inmueble_por_codigo(TEXT) TO anon, authenticated;
