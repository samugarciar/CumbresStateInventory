-- =====================================================================
-- ALTA MANUAL DE UNA INMOBILIARIA (con su primer administrador)
--
-- NO ES UNA MIGRACIÓN. Vive fuera de supabase/migrations/ a propósito:
-- se ejecuta a mano, una vez por inmobiliaria nueva, y nunca al desplegar.
--
-- POR QUÉ A MANO
-- Decisión de Samuel (1 oct 2026): se cierra el alta abierta. Se quitaron
-- la página /registro-inmobiliaria y la acción signupInmobiliaria(). Hasta
-- que haya un plan de alta real, las inmobiliarias nuevas las crea alguien
-- con acceso al panel de Supabase, en dos pasos.
--
-- PASO 1 — Crear el usuario en Supabase Auth (en el panel, no en SQL)
--   Authentication → Users → Add user → Create new user
--     · correo del administrador y una contraseña provisional
--     · marcar «Auto Confirm User»
--   Funciona con «Allow new users to sign up» apagado: el panel usa la API
--   de administración, igual que el alta de asesores (auth.admin.createUser
--   en app/actions/admin.ts). La contraseña se entrega por un canal privado,
--   como hoy con los asesores.
--
-- PASO 2 — Este script, en el SQL Editor (corre como postgres)
--   Rellena los cuatro valores de «DATOS». Es UNA sola sentencia (un bloque
--   DO): si algo falla —el correo no existe en Auth, el NIT ya está, el
--   usuario ya tiene perfil— no queda nada a medias.
--
-- QUÉ CREA (lo mismo que hacía signupInmobiliaria)
--   · una fila en public.inmobiliarias (nombre, nit)
--   · una fila en public.usuarios con rol 'admin', enlazada al usuario de Auth
-- QUÉ NO CREA (tampoco lo hacía la página): filas de agentes_config, líneas
-- de WhatsApp ni nada del esquema crm. Eso se configura aparte.
-- =====================================================================

DO $$
DECLARE
    -- ------------------------- DATOS -------------------------
    v_nombre_inmobiliaria TEXT := 'CAMBIAR: nombre de la inmobiliaria';
    v_nit                 TEXT := 'CAMBIAR: NIT';
    v_nombre_admin        TEXT := 'CAMBIAR: nombre completo del administrador';
    v_email_admin         TEXT := 'CAMBIAR: correo del administrador';
    -- ---------------------------------------------------------
    v_usuario      UUID;
    v_inmobiliaria UUID;
BEGIN
    IF v_nombre_inmobiliaria LIKE 'CAMBIAR:%' OR v_nit LIKE 'CAMBIAR:%'
       OR v_nombre_admin LIKE 'CAMBIAR:%' OR v_email_admin LIKE 'CAMBIAR:%' THEN
        RAISE EXCEPTION 'Faltan datos: rellena la sección DATOS antes de ejecutar.';
    END IF;

    v_email_admin := lower(trim(v_email_admin));

    SELECT id INTO v_usuario FROM auth.users WHERE lower(email) = v_email_admin;
    IF v_usuario IS NULL THEN
        RAISE EXCEPTION 'No hay usuario en Auth con el correo %. Haz primero el PASO 1.', v_email_admin;
    END IF;

    IF EXISTS (SELECT 1 FROM public.usuarios WHERE id = v_usuario) THEN
        RAISE EXCEPTION 'El usuario % ya tiene perfil en public.usuarios (ya pertenece a una inmobiliaria).', v_email_admin;
    END IF;

    -- Un NIT repetido corta aquí con el error 23505 de la restricción UNIQUE.
    INSERT INTO public.inmobiliarias (nombre, nit)
    VALUES (trim(v_nombre_inmobiliaria), trim(v_nit))
    RETURNING id INTO v_inmobiliaria;

    INSERT INTO public.usuarios (id, inmobiliaria_id, nombre_completo, email, rol)
    VALUES (v_usuario, v_inmobiliaria, trim(v_nombre_admin), v_email_admin, 'admin');

    RAISE NOTICE 'Inmobiliaria % creada; administrador % (%).', v_inmobiliaria, v_email_admin, v_usuario;
END $$;

-- PASO 3 — Comprobar (solo lectura)
-- SELECT i.nombre, i.nit, u.email, u.rol, u.created_at
-- FROM public.usuarios u JOIN public.inmobiliarias i ON i.id = u.inmobiliaria_id
-- ORDER BY u.created_at DESC
-- LIMIT 5;
