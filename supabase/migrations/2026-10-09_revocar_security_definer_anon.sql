-- =====================================================================
-- MIGRACIÓN: Revocar ejecución a 'anon' y 'PUBLIC' en funciones SECURITY DEFINER de public
-- Fecha: 2026-10-09
--
-- AUDITORÍA DE SEGURIDAD:
-- En PostgreSQL, las funciones creadas otorgan permiso de ejecución a PUBLIC
-- por defecto. El rol 'anon' de Supabase hereda de PUBLIC, lo que expone
-- las funciones SECURITY DEFINER como endpoints RPC públicos vía PostgREST.
--
-- Se evaluaron las 11 funciones identificadas y se determinó que 'anon' no
-- requiere acceso a NINGUNA de ellas:
-- 1. get_my_role(): Helper RLS para usuario en sesión. Solo requiere 'authenticated' y 'service_role'.
-- 2. get_my_inmobiliaria(): Helper RLS. Solo requiere 'authenticated' y 'service_role'.
-- 3. cancelar_cita(): Usada por el agente comercial ('service_role').
-- 4. agendar_cita(): Usada por Server Actions ('authenticated') y agente ('service_role').
-- 5. consultar_disponibilidad(): Usada en UI autenticada y agente ('service_role').
-- 6. solicitar_apertura_agenda(): Usada por el agente comercial ('service_role').
-- 7. agendar_cita_por_texto(): Usada por el agente comercial ('service_role').
-- 8. consultar_disponibilidad_por_texto(): Usada por el agente comercial ('service_role').
-- 9. buscar_inmueble_por_codigo(): Usada por el agente comercial ('service_role').
-- 10. resolver_inmuebles_por_texto(): Usada por el agente comercial ('service_role').
-- 11. rls_auto_enable(): Trigger interno de base de datos. Solo postgres/service_role.
-- =====================================================================

-- 1. get_my_role
REVOKE ALL ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;

-- 2. get_my_inmobiliaria
REVOKE ALL ON FUNCTION public.get_my_inmobiliaria() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_inmobiliaria() TO authenticated, service_role;

-- 3. cancelar_cita
REVOKE ALL ON FUNCTION public.cancelar_cita(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_cita(UUID, TEXT) TO authenticated, service_role;

-- 4. agendar_cita (cubriendo posibles sobrecargas históricas)
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 5. consultar_disponibilidad
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.consultar_disponibilidad(UUID, DATE, DATE) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.consultar_disponibilidad(UUID, DATE, DATE) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 6. solicitar_apertura_agenda
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.solicitar_apertura_agenda(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.solicitar_apertura_agenda(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 7. agendar_cita_por_texto
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.agendar_cita_por_texto(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.agendar_cita_por_texto(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 8. consultar_disponibilidad_por_texto
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.consultar_disponibilidad_por_texto(TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.consultar_disponibilidad_por_texto(TEXT, DATE, DATE, TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 9. buscar_inmueble_por_codigo
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.buscar_inmueble_por_codigo(TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.buscar_inmueble_por_codigo(TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 10. resolver_inmuebles_por_texto
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.resolver_inmuebles_por_texto(TEXT, TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.resolver_inmuebles_por_texto(TEXT, TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.resolver_inmuebles_por_texto(TEXT) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.resolver_inmuebles_por_texto(TEXT) TO authenticated, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- 11. rls_auto_enable (función de trigger interno)
DO $$
BEGIN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO postgres, service_role;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;

-- Bloque dinámico defensivo: asegura revocar 'anon' y 'PUBLIC' de cualquier otra
-- sobrecarga existente de estas 11 funciones en el esquema public
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.proname, pg_catalog.oidvectortypes(p.proargtypes) AS argtypes
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'get_my_role',
              'get_my_inmobiliaria',
              'cancelar_cita',
              'agendar_cita',
              'consultar_disponibilidad',
              'solicitar_apertura_agenda',
              'agendar_cita_por_texto',
              'consultar_disponibilidad_por_texto',
              'buscar_inmueble_por_codigo',
              'resolver_inmuebles_por_texto',
              'rls_auto_enable'
          )
    ) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon;', r.proname, r.argtypes);
        IF r.proname = 'rls_auto_enable' THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO postgres, service_role;', r.proname, r.argtypes);
        ELSE
            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role;', r.proname, r.argtypes);
        END IF;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
