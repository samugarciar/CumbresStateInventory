-- =====================================================================
-- MIGRACIÓN: Control de concurrencia para el agente comercial en el camino directo
-- Fecha: 2026-10-09
--
-- Evita dos ejecuciones simultáneas del agente para el mismo contacto
-- (por ejemplo, ante mensajes en ráfaga o entregas rápidas de Meta).
-- Solo service_role puede adquirir y liberar el bloqueo.
-- =====================================================================

ALTER TABLE public.agente_comercial_conversaciones
    ADD COLUMN IF NOT EXISTS procesando_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN public.agente_comercial_conversaciones.procesando_at IS
    'Cuándo empezó a correr la ejecución activa del agente. Si es menor a 60 segundos atrás, bloquea una segunda ejecución concurrente para el mismo contacto.';

-- ---------------------------------------------------------------------
-- adquirir_bloqueo_agente: intento atómico de adquirir el turno del agente
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adquirir_bloqueo_agente(
    p_conversacion_id UUID,
    p_segundos INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.agente_comercial_conversaciones
    SET procesando_at = timezone('utc'::text, now())
    WHERE id = p_conversacion_id
      AND (
          procesando_at IS NULL
          OR procesando_at < timezone('utc'::text, now()) - (p_segundos || ' seconds')::INTERVAL
      );

    RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------
-- liberar_bloqueo_agente: libera el turno del agente al terminar o fallar
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.liberar_bloqueo_agente(
    p_conversacion_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.agente_comercial_conversaciones
    SET procesando_at = NULL
    WHERE id = p_conversacion_id;
END;
$$;

-- Seguridad: solo service_role (usado por el webhook en Next.js) puede llamar estas funciones
REVOKE ALL ON FUNCTION public.adquirir_bloqueo_agente(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adquirir_bloqueo_agente(UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION public.liberar_bloqueo_agente(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.liberar_bloqueo_agente(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
