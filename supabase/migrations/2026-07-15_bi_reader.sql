-- =====================================================================
-- Rol de solo lectura para el Asesor BI integrado (/inteligencia)
-- Ejecutar UNA VEZ en el SQL Editor de Supabase (como postgres),
-- cambiando antes la contraseña. La cadena de conexión resultante va en
-- la variable de entorno BI_DATABASE_URL (Vercel), con el session pooler:
--   postgresql://bi_reader.<PROJECT_REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
--
-- Por qué un rol propio y no anon/service_role:
--  * anon (el que usa el agente n8n) solo ve inmuebles disponibles y
--    franjas — sin citas ni solicitudes, insuficiente para BI.
--  * service_role puede ESCRIBIR todo; demasiado poder para un lector.
--  * bi_reader: SELECT explícito tabla por tabla, transacciones
--    forzadas a solo lectura y timeout corto. Si mañana se agrega una
--    tabla sensible, BI no la ve hasta otorgarle grant+policy a propósito.
--
-- No toca el contrato del agente n8n (grants/policies de anon intactos).
-- =====================================================================

-- 1. Rol con login (cambiar la contraseña antes de ejecutar)
CREATE ROLE bi_reader LOGIN PASSWORD 'CAMBIAR-ESTA-CONTRASENA' NOINHERIT;

-- Defensa en profundidad: aunque solo tiene SELECT, cualquier intento
-- de escritura falla también a nivel de transacción.
ALTER ROLE bi_reader SET default_transaction_read_only = on;
ALTER ROLE bi_reader SET statement_timeout = '20s';

GRANT USAGE ON SCHEMA public TO bi_reader;

-- 2. SELECT solo sobre las tablas que BI necesita
GRANT SELECT ON public.inmobiliarias        TO bi_reader;
GRANT SELECT ON public.usuarios             TO bi_reader; -- nombres de asesores para joins
GRANT SELECT ON public.inmuebles            TO bi_reader;
GRANT SELECT ON public.inventarios          TO bi_reader;
GRANT SELECT ON public.franjas_horarias     TO bi_reader;
GRANT SELECT ON public.citas                TO bi_reader;
GRANT SELECT ON public.solicitudes_apertura TO bi_reader;
GRANT SELECT ON public.tareas               TO bi_reader;
GRANT SELECT ON public.webhook_logs         TO bi_reader;
GRANT SELECT ON public.franjas_inmuebles    TO bi_reader;

-- 3. Las tablas tienen RLS y sus policies dependen de auth.uid(),
--    que es NULL en una conexión directa. Policies de lectura total
--    explícitas para bi_reader (solo SELECT; INSERT/UPDATE/DELETE
--    siguen sin grant, así que siguen bloqueados).
CREATE POLICY "BI reader lee inmobiliarias"        ON public.inmobiliarias        FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee usuarios"             ON public.usuarios             FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee inmuebles"            ON public.inmuebles            FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee inventarios"          ON public.inventarios          FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee franjas"              ON public.franjas_horarias     FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee citas"                ON public.citas                FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee solicitudes_apertura" ON public.solicitudes_apertura FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee tareas"               ON public.tareas               FOR SELECT TO bi_reader USING (true);
CREATE POLICY "BI reader lee webhook_logs"         ON public.webhook_logs         FOR SELECT TO bi_reader USING (true);

-- 4. Verificación rápida (conectado como bi_reader):
--    SELECT count(*) FROM public.citas;              -- debe devolver filas
--    DELETE FROM public.tareas;                      -- debe FALLAR
