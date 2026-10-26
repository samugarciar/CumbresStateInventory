-- =====================================================================
-- MIGRACIÓN: las funciones del bot, cerradas a los usuarios con sesión;
-- y fuera los accesos anónimos que dejó el agente viejo de n8n
-- Fecha: 2026-10-26
--
-- EL PROBLEMA (auditoría de seguridad de la noche del 25 oct, S-01/S-03/S-04)
-- 1. Las herramientas del agente comercial son SECURITY DEFINER: corren
--    como su dueño y se saltan la RLS. El 9 oct se le quitaron a anon, pero
--    siguen abiertas a `authenticated` (el privilegio por defecto de
--    Supabase se lo da a toda función nueva). Cualquier usuario con sesión
--    —un asesor, la cuenta revisora de Meta— podía llamarlas por PostgREST
--    con el id de cualquier inmobiliaria: agendar o cancelar citas por
--    texto, abrir solicitudes, leer la disponibilidad o tomar el candado
--    del agente de una conversación ajena.
--    Quién las llama de verdad (grep del 26 oct): solo el agente
--    (lib/agente-comercial/tools.ts) y el webhook (app/api/whatsapp/webhook),
--    los dos con createAdminClient(), o sea service_role. agendar_cita NO
--    entra aquí: la usa /citas (app/actions/solicitudes.ts) con la sesión
--    del admin; desde 2026-10-26_funciones_agenda_bogota_y_tildes.sql
--    tiene su propia guarda (solo admin, solo su inmobiliaria).
-- 2. Dos políticas para `anon` que eran del agente viejo de n8n (que leía
--    con la llave anónima): «Agente anon lee franjas» (todas las franjas de
--    todas las inmobiliarias, con asesor y horario) y «Agente anon lee
--    inmuebles disponibles». Ese agente ya no existe; la página pública
--    /f/[codigo] lee con service_role.
-- 3. «Permitir la creación de inmobiliaria en el registro» (INSERT con
--    WITH CHECK true): el alta abierta se cerró el 1 oct; hoy las
--    inmobiliarias se crean a mano (supabase/manual/alta-inmobiliaria.sql).
--    Y anon y authenticated conservaban INSERT/UPDATE/DELETE sobre la tabla.
--    Ningún código de la app escribe en public.inmobiliarias (grep del
--    26 oct: solo lecturas).
--
-- LO QUE NO TOCA: las lecturas de la app, agendar_cita, las políticas de
-- admins y asesores, ni nada del rol bi_reader.
--
-- Idempotente: se puede correr dos veces en el SQL Editor sin error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Las herramientas del agente: solo service_role
--
-- Firmas vigentes (pg_get_function_identity_arguments en producción):
--   agendar_cita_por_texto(text, date, time, time, text, text, text, text, text, text)
--   cancelar_cita(uuid, text)
--   solicitar_apertura_agenda(text, date, time, time, text, text, text, text, text, text)
--   consultar_disponibilidad(uuid, date, date)
--   consultar_disponibilidad_por_texto(text, date, date, text)
--   buscar_inmueble_por_codigo(text)
--   resolver_inmuebles_por_texto(text, text)
--   adquirir_bloqueo_agente(uuid, integer)
--   liberar_bloqueo_agente(uuid)
-- y, si sobrevive alguna, la sobrecarga vieja resolver_inmuebles_por_texto(text)
-- que nombra 2026-10-09_revocar_security_definer_anon.sql. El bucle recorre
-- TODAS las sobrecargas de cada nombre, así que ninguna se queda abierta.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid::regprocedure AS firma
          FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
               'agendar_cita_por_texto',
               'cancelar_cita',
               'solicitar_apertura_agenda',
               'consultar_disponibilidad',
               'consultar_disponibilidad_por_texto',
               'buscar_inmueble_por_codigo',
               'resolver_inmuebles_por_texto',
               'adquirir_bloqueo_agente',
               'liberar_bloqueo_agente'
           )
    ) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.firma);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.firma);
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Las políticas anónimas del agente viejo de n8n
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Agente anon lee franjas" ON public.franjas_horarias;
DROP POLICY IF EXISTS "Agente anon lee inmuebles disponibles" ON public.inmuebles;

-- ---------------------------------------------------------------------
-- 3. Nadie crea, cambia ni borra inmobiliarias desde la app
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir la creación de inmobiliaria en el registro" ON public.inmobiliarias;

-- TRUNCATE también: no lo frena la RLS. PostgREST no lo expone, pero no hay
-- razón para que estos roles lo tengan.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.inmobiliarias FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
