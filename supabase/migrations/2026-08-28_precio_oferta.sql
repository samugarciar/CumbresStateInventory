-- =====================================================================
-- MIGRACIÓN: precio de oferta para inmuebles en desocupación
-- Fecha: 2026-08-28
--
-- POR QUÉ
-- Un inmueble arrendado que se desocupa se vuelve a ofrecer casi siempre a
-- un canon MAYOR (IPC, inflación), pero el ERP sigue mostrando el precio del
-- contrato viejo hasta que se firma el nuevo. Hoy el agente comercial cotiza
-- ese precio viejo.
--
-- Peor todavía: los asesores escriben el precio a mano dentro de las
-- observaciones del ERP, que caen en `descripcion`. El 28/ago el agente le
-- ofreció a un cliente (Julian, Luna del Valle apto 510) $1.200.000 leyéndolo
-- de la descripción, cuando la columna `precio` decía $1.367.600. Auditados
-- los 42 arriendos disponibles, 2 se contradicen así a sí mismos.
--
-- La raíz es que el sistema le entrega al modelo DOS precios distintos y le
-- pide que elija. Este es el mismo patrón que ya falló con las fechas, los
-- códigos y las tildes: lo que el modelo tiene que deducir, termina fallando.
--
-- QUÉ HACE
-- `precio_oferta` es soberanía LOCAL, igual que `estado_override`: lo escribe
-- el admin al apretar "Ofertar (desocupado)" y el sync del ERP NUNCA lo pisa
-- (no va en el payload de sync-nuby.ts). NULL = no hay precio de oferta y
-- manda el del ERP.
--
-- El precio EFECTIVO es COALESCE(precio_oferta, precio). Ni el agente ni el
-- cliente ven nunca los dos números: las tools y esta RPC colapsan a uno solo,
-- que es justamente lo que evita que el modelo tenga que elegir.
-- Idempotente.
-- =====================================================================

ALTER TABLE public.inmuebles
    ADD COLUMN IF NOT EXISTS precio_oferta NUMERIC;

COMMENT ON COLUMN public.inmuebles.precio_oferta IS
    'Canon con el que se está ofreciendo un inmueble en desocupación (sube por IPC). '
    'Override local: el sync del ERP no lo toca. NULL = usar precio. '
    'El precio efectivo es COALESCE(precio_oferta, precio).';

-- ---------------------------------------------------------------------
-- buscar_inmueble_por_codigo: devolver el precio EFECTIVO
-- Misma firma y mismas claves que antes; solo cambia de dónde sale `precio`.
-- Se mantiene el nombre de la clave a propósito: quien la consume (la tool
-- del agente) sigue viendo un único campo `precio` y no puede confundirse.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_inmueble_por_codigo(p_codigo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_digits TEXT := regexp_replace(COALESCE(p_codigo, ''), '\D', '', 'g');
    v_codigo BIGINT;
BEGIN
    IF v_digits = '' OR length(v_digits) > 18 THEN
        RETURN '[]'::jsonb;
    END IF;
    v_codigo := v_digits::bigint;

    RETURN COALESCE((
        SELECT jsonb_agg(t)
        FROM (
            SELECT
                i.id, i.arrendasoft_id, i.titulo, i.descripcion,
                i.tipo_inmueble, i.tipo_transaccion,
                COALESCE(i.precio_oferta, i.precio) AS precio,
                i.direccion, i.unidad, i.ciudad, i.barrio,
                i.habitaciones, i.banos, i.estado
            FROM public.inmuebles i
            WHERE i.arrendasoft_id = v_codigo
        ) t
    ), '[]'::jsonb);
END;
$$;
