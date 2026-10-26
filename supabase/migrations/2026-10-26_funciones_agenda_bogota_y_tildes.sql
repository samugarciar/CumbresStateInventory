-- =====================================================================
-- MIGRACIÓN: agenda en hora de Colombia, tildes sanas, «realizada» solo
-- para visitas que ya pasaron y guarda en agendar_cita
-- Fecha: 2026-10-26
--
-- DE DÓNDE SALE
-- Las ocho funciones se copiaron de pg_get_functiondef de PRODUCCIÓN (leída
-- en solo lectura la noche del 25 oct; copias en el scratchpad de la noche,
-- seguridad/public_definer.sql e integridad/funciones_fechas.sql) y no de
-- las migraciones del repo, para no revertir lógica que se cambió a mano.
-- Antes se comprobó que coinciden con el stack local. Mismas firmas,
-- SECURITY DEFINER, search_path y permisos (CREATE OR REPLACE los conserva).
--
-- LO QUE CAMBIA
-- 1. Tildes. Los mensajes que el bot le lee al cliente y los comentarios
--    venían dañados por una copia en Mac Roman: «est√° pausado», «tel√©fono»,
--    «¬ø», «‚Üí». Se decodificó cada secuencia (√°→á, √©→é, √≠→í, √≥→ó,
--    √∫→ú, √±→ñ, ‚Üí→→, ‚Äî→—, ‚â•→≥, ¬ø→¿, ¬∑→·). Ninguna otra.
-- 2. Fechas. La base corre en UTC: CURRENT_DATE es «mañana» desde las 7 p. m.
--    de Colombia, y agendar_cita y solicitar_apertura_agenda rechazaban la
--    fecha de HOY como «fecha pasada». Todo CURRENT_DATE de estas funciones
--    pasa a (now() AT TIME ZONE 'America/Bogota')::date, incluidos los
--    DEFAULT de consultar_disponibilidad y consultar_disponibilidad_por_texto.
-- 3. marcar_cita_realizada rechaza la cita cuya fecha es posterior a hoy en
--    Bogotá: «La visita todavía no ha pasado.»
-- 4. agendar_cita (S-01): con la sesión de un usuario, solo un admin y solo
--    en su inmobiliaria; si no, {success:false, error:'No autorizado'}. Con
--    service_role (el bot) auth.uid() es nulo y nada cambia.
--
-- Datos: el título «Sincronización ERP» de las tareas ya creadas se arregla
-- aparte, en supabase/manual/2026-10-26_tildes_tareas_sync.sql.
--
-- Idempotente: se puede correr dos veces en el SQL Editor sin error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- agendar_cita
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cita(p_inmueble_id uuid, p_fecha date, p_hora_inicio time without time zone, p_hora_fin time without time zone, p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_alcance text DEFAULT 'inmueble'::text, p_unidad text DEFAULT NULL::text, p_aptos_snapshot jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_inmueble RECORD;
    v_franja   RECORD;
    v_cita_id  UUID;
    v_alcance  TEXT := coalesce(nullif(trim(p_alcance), ''), 'inmueble');
    v_unidad   TEXT;
BEGIN
    IF v_alcance NOT IN ('inmueble', 'unidad') THEN
        RETURN jsonb_build_object('success', false, 'error', 'alcance inválido (usa inmueble o unidad).');
    END IF;

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

    IF p_fecha < (now() AT TIME ZONE 'America/Bogota')::date THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se pueden agendar citas en fechas pasadas.');
    END IF;

    SELECT id, inmobiliaria_id, estado, unidad, direccion, titulo
    INTO v_inmueble FROM inmuebles WHERE id = p_inmueble_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Inmueble no encontrado.');
    END IF;

    -- Guarda (S-01, 26 oct 2026): con la sesión de un usuario solo agenda
    -- un admin, y solo en su inmobiliaria (aprobar una solicitud en /citas).
    -- El bot llama con service_role, sin auth.uid(): para él no cambia nada.
    IF auth.uid() IS NOT NULL
       AND (public.get_my_role() IS DISTINCT FROM 'admin'
            OR v_inmueble.inmobiliaria_id IS DISTINCT FROM public.get_my_inmobiliaria()) THEN
        RETURN jsonb_build_object('success', false, 'error', 'No autorizado');
    END IF;

    -- Guarda: agente comercial pausado por la inmobiliaria
    IF public.agente_comercial_pausado(v_inmueble.inmobiliaria_id) THEN
        RETURN jsonb_build_object(
            'success', false, 'agente_pausado', true,
            'error', 'El agente está pausado temporalmente por la inmobiliaria. Un asesor humano continuará la conversación; no se agendó nada.'
        );
    END IF;

    IF v_inmueble.estado <> 'disponible' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El inmueble ya no está disponible.');
    END IF;

    v_unidad := coalesce(nullif(trim(p_unidad), ''), v_inmueble.unidad);

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
        cliente_nombre, cliente_telefono, cliente_email, notas, origen,
        alcance, unidad, aptos_snapshot
    ) VALUES (
        v_inmueble.inmobiliaria_id, v_franja.id, p_inmueble_id, p_fecha, p_hora_inicio, p_hora_fin,
        trim(p_cliente_nombre), trim(p_cliente_telefono), nullif(trim(p_cliente_email), ''), p_notas, 'n8n',
        v_alcance,
        CASE WHEN v_alcance = 'unidad' THEN v_unidad         ELSE NULL END,
        CASE WHEN v_alcance = 'unidad' THEN p_aptos_snapshot ELSE NULL END
    )
    RETURNING id INTO v_cita_id;

    RETURN jsonb_build_object(
        'success', true,
        'cita_id', v_cita_id,
        'alcance', v_alcance,
        'inmueble', CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE v_inmueble.titulo END,
        'unidad', CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE NULL END,
        'aptos_count', CASE WHEN v_alcance = 'unidad' AND p_aptos_snapshot IS NOT NULL
                            THEN jsonb_array_length(p_aptos_snapshot) ELSE NULL END,
        'fecha', p_fecha,
        'hora_inicio', p_hora_inicio,
        'hora_fin', p_hora_fin,
        'asesor', v_franja.asesor
    );
END;
$function$;

-- ---------------------------------------------------------------------
-- agendar_cita_por_texto
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cita_por_texto(p_texto text, p_fecha date, p_hora_inicio time without time zone, p_hora_fin time without time zone, p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_alcance text DEFAULT 'inmueble'::text, p_tipo_transaccion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_alcance     TEXT := coalesce(nullif(trim(p_alcance), ''), 'inmueble');
    v_count       INT;
    v_id          UUID;
    v_dist_unidad INT;
    v_dist_tipo   INT;
    v_sin_unidad  INT;
    v_unidad      TEXT;
    v_rep         UUID;
    v_snapshot    JSONB;
BEGIN
    IF v_alcance NOT IN ('inmueble', 'unidad') THEN
        RETURN jsonb_build_object('success', false, 'error', 'alcance inválido (usa inmueble o unidad).');
    END IF;

    -- ---- Agendar a la UNIDAD ----
    IF v_alcance = 'unidad' THEN
        SELECT count(*), count(DISTINCT r.unidad), count(DISTINCT r.tipo_transaccion),
               count(*) FILTER (WHERE r.unidad IS NULL), max(r.unidad)
        INTO v_count, v_dist_unidad, v_dist_tipo, v_sin_unidad, v_unidad
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

        IF v_count = 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'No encontré aptos disponibles que coincidan con "' || p_texto ||
                         '". Sé más específico (nombre de la unidad y, si aplica, arriendo o venta).'
            );
        END IF;

        IF NOT (v_dist_unidad = 1 AND v_dist_tipo = 1 AND v_sin_unidad = 0) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'No pude identificar una sola unidad y tipo para "' || p_texto ||
                         '". Indica la unidad exacta y si es arriendo o venta, o agenda un apto puntual (alcance=inmueble).'
            );
        END IF;

        -- snapshot de aptos + representativo (el más barato; comparten franjas)
        SELECT jsonb_agg(
                   jsonb_build_object(
                       'inmueble_id', r.id, 'titulo', r.titulo,
                       'precio', r.precio, 'habitaciones', r.habitaciones, 'banos', r.banos
                   ) ORDER BY r.precio),
               (array_agg(r.id ORDER BY r.precio))[1]
        INTO v_snapshot, v_rep
        FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

        RETURN public.agendar_cita(
            v_rep, p_fecha, p_hora_inicio, p_hora_fin,
            p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_notas,
            'unidad', v_unidad, v_snapshot
        );
    END IF;

    -- ---- Agendar a un INMUEBLE puntual (comportamiento clásico) ----
    SELECT count(*) INTO v_count
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion);

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
                     '". Sé más específico para saber cuál agendar (agrega el número de apartamento o el edificio), o agenda a la unidad con alcance=unidad.'
        );
    END IF;

    SELECT r.id INTO v_id
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
    LIMIT 1;

    -- Delega TODA la validación y el formato de respuesta (alcance=inmueble por default)
    RETURN public.agendar_cita(
        v_id, p_fecha, p_hora_inicio, p_hora_fin,
        p_cliente_nombre, p_cliente_telefono, p_cliente_email, p_notas
    );
END;
$function$;

-- ---------------------------------------------------------------------
-- cancelar_cita
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_cita(p_cita_id uuid, p_cliente_telefono text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_inmobiliaria UUID;
BEGIN
    SELECT c.inmobiliaria_id INTO v_inmobiliaria
    FROM citas c
    WHERE c.id = p_cita_id
      AND trim(c.cliente_telefono) = trim(p_cliente_telefono)
      AND c.estado = 'agendada';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se encontró una cita agendada con ese ID y teléfono.');
    END IF;

    -- Guarda: agente comercial pausado por la inmobiliaria
    IF public.agente_comercial_pausado(v_inmobiliaria) THEN
        RETURN jsonb_build_object(
            'success', false, 'agente_pausado', true,
            'error', 'El agente está pausado temporalmente por la inmobiliaria. Un asesor humano continuará la conversación; la cita NO se canceló.'
        );
    END IF;

    UPDATE citas
    SET estado = 'cancelada'
    WHERE id = p_cita_id
      AND trim(cliente_telefono) = trim(p_cliente_telefono)
      AND estado = 'agendada';

    RETURN jsonb_build_object('success', true);
END;
$function$;

-- ---------------------------------------------------------------------
-- consultar_disponibilidad
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_disponibilidad(p_inmueble_id uuid, p_fecha_desde date DEFAULT (now() AT TIME ZONE 'America/Bogota')::date, p_fecha_hasta date DEFAULT NULL::date)
 RETURNS TABLE(franja_id uuid, fecha date, hora_inicio time without time zone, hora_fin time without time zone, asesor text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------
-- consultar_disponibilidad_por_texto
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_disponibilidad_por_texto(p_texto text, p_fecha_desde date DEFAULT (now() AT TIME ZONE 'America/Bogota')::date, p_fecha_hasta date DEFAULT NULL::date, p_tipo_transaccion text DEFAULT NULL::text)
 RETURNS TABLE(modo text, inmueble_id uuid, titulo text, direccion text, unidad text, aptos_count integer, aptos jsonb, franja_id uuid, fecha date, hora_inicio time without time zone, hora_fin time without time zone, asesor text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_hasta        DATE := coalesce(p_fecha_hasta, p_fecha_desde + 14);
    v_count        INT;
    v_dist_unidad  INT;
    v_dist_tipo    INT;
    v_sin_unidad   INT;
    v_unidad       TEXT;
    v_aptos        JSONB;
    v_aptos_count  INT;
    v_rep          UUID;
    v_inm          RECORD;
    v_slot         RECORD;
    v_tiene        BOOLEAN := false;
    v_inmobiliaria UUID;
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

    -- Guarda: agente comercial pausado por la inmobiliaria → señal explícita
    SELECT i.inmobiliaria_id INTO v_inmobiliaria
    FROM inmuebles i
    WHERE i.id = (SELECT r.id FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r LIMIT 1);

    IF public.agente_comercial_pausado(v_inmobiliaria) THEN
        modo := 'agente_pausado';
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
        -- Nota: NO usar min(r.id): Postgres no tiene min(uuid).
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
$function$;

-- ---------------------------------------------------------------------
-- crear_tarea_actualizar_inmuebles
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crear_tarea_actualizar_inmuebles()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_inmo RECORD;
    v_hoy  DATE := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
    FOR v_inmo IN SELECT id FROM inmobiliarias LOOP
        IF NOT EXISTS (
            SELECT 1 FROM tareas t
            WHERE t.inmobiliaria_id = v_inmo.id
              AND t.evento_origen = 'sync_diario_inmuebles'
              AND (t.created_at AT TIME ZONE 'America/Bogota')::date = v_hoy
        ) THEN
            INSERT INTO tareas (
                inmobiliaria_id, usuario_id, entidad_tipo, entidad_id,
                evento_origen, evento_titulo, titulo, estado
            ) VALUES (
                v_inmo.id, NULL, 'general', NULL,
                'sync_diario_inmuebles',
                'Sincronización ERP',
                'Actualizar inmuebles (' || to_char(v_hoy, 'DD/MM') || ')',
                'pendiente'
            );
        END IF;
    END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------
-- marcar_cita_realizada
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_cita_realizada(p_cita_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_asesor uuid;
  v_estado text;
  v_fecha  date;
BEGIN
  SELECT f.asesor_id, c.estado, c.fecha
    INTO v_asesor, v_estado, v_fecha
    FROM public.citas c
    JOIN public.franjas_horarias f ON f.id = c.franja_id
   WHERE c.id = p_cita_id;

  IF v_asesor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cita no encontrada.');
  END IF;
  IF v_asesor <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Solo el asesor de la cita puede marcarla como realizada.');
  END IF;
  IF v_estado <> 'agendada' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La cita ya no está agendada (fue cancelada o ya se marcó).');
  END IF;
  -- Solo se marca lo que ya pasó: una visita de mañana no se hizo todavía
  -- (26 oct 2026). Hoy cuenta, en el día de Bogotá.
  IF v_fecha > (now() AT TIME ZONE 'America/Bogota')::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'La visita todavía no ha pasado.');
  END IF;

  UPDATE public.citas
     SET estado = 'completada', completada_at = now(), completada_por = auth.uid()
   WHERE id = p_cita_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ---------------------------------------------------------------------
-- solicitar_apertura_agenda
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_apertura_agenda(p_texto text, p_fecha date, p_hora_inicio time without time zone, p_hora_fin time without time zone, p_cliente_nombre text, p_cliente_telefono text, p_cliente_email text DEFAULT NULL::text, p_notas text DEFAULT NULL::text, p_alcance text DEFAULT 'inmueble'::text, p_tipo_transaccion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_alcance      TEXT := coalesce(nullif(trim(p_alcance), ''), 'inmueble');
    v_count        INT;
    v_dist_unidad  INT;
    v_dist_tipo    INT;
    v_sin_unidad   INT;
    v_unidad       TEXT;
    v_inm          RECORD;
    v_inmobiliaria UUID;
    v_ya_franja    BOOLEAN;
    v_dup          RECORD;
    v_id           UUID;
    v_nombre_pub   TEXT;
BEGIN
    IF v_alcance NOT IN ('inmueble', 'unidad') THEN
        RETURN jsonb_build_object('success', false, 'error', 'alcance inválido (usa inmueble o unidad).');
    END IF;

    IF p_tipo_transaccion IS NOT NULL AND p_tipo_transaccion NOT IN ('arriendo', 'venta') THEN
        RETURN jsonb_build_object('success', false, 'error', 'tipo_transaccion inválido (usa arriendo o venta).');
    END IF;

    IF p_cliente_nombre IS NULL OR trim(p_cliente_nombre) = ''
       OR p_cliente_telefono IS NULL OR trim(p_cliente_telefono) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El nombre y el teléfono del cliente son obligatorios.');
    END IF;

    IF p_hora_fin <= p_hora_inicio THEN
        RETURN jsonb_build_object('success', false, 'error', 'La hora de fin debe ser posterior a la hora de inicio.');
    END IF;

    IF EXTRACT(MINUTE FROM p_hora_inicio)::int % 30 <> 0 OR EXTRACT(MINUTE FROM p_hora_fin)::int % 30 <> 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Los horarios deben iniciar y terminar en bloques de 30 minutos (ej. 09:00, 09:30, 10:00).');
    END IF;

    IF p_fecha < (now() AT TIME ZONE 'America/Bogota')::date THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se pueden solicitar horarios en fechas pasadas.');
    END IF;

    SELECT count(*), count(DISTINCT r.unidad), count(DISTINCT r.tipo_transaccion),
           count(*) FILTER (WHERE r.unidad IS NULL), max(r.unidad)
    INTO v_count, v_dist_unidad, v_dist_tipo, v_sin_unidad, v_unidad
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r;

    IF v_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No encontré ningún inmueble disponible que coincida con "' || p_texto ||
                     '". Sé más específico: el nombre del edificio, el número de apartamento o el barrio.'
        );
    END IF;

    IF v_alcance = 'unidad' THEN
        IF NOT (v_dist_unidad = 1 AND v_dist_tipo = 1 AND v_sin_unidad = 0) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'No pude identificar una sola unidad y tipo para "' || p_texto ||
                         '". Indica la unidad exacta y si es arriendo o venta, o solicita para un apto puntual (alcance=inmueble).'
            );
        END IF;
    ELSE
        IF v_count > 1 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Encontré varios inmuebles que coinciden con "' || p_texto ||
                         '". Sé más específico (agrega el número de apartamento o el edificio), o solicita a la unidad con alcance=unidad.'
            );
        END IF;
        v_unidad := NULL;
    END IF;

    SELECT r.id, r.titulo, r.direccion, r.unidad INTO v_inm
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
    ORDER BY r.precio LIMIT 1;

    SELECT i.inmobiliaria_id INTO v_inmobiliaria FROM inmuebles i WHERE i.id = v_inm.id;

    -- Guarda: agente comercial pausado por la inmobiliaria
    IF public.agente_comercial_pausado(v_inmobiliaria) THEN
        RETURN jsonb_build_object(
            'success', false, 'agente_pausado', true,
            'error', 'El agente está pausado temporalmente por la inmobiliaria. Un asesor humano continuará la conversación; no se registró la solicitud.'
        );
    END IF;

    v_nombre_pub := CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE v_inm.titulo END;

    SELECT EXISTS (
        SELECT 1
        FROM franjas_horarias fr
        JOIN inmuebles base ON base.id = fr.inmueble_id
        WHERE fr.inmobiliaria_id = v_inmobiliaria
          AND fr.fecha = p_fecha
          AND fr.hora_inicio <= p_hora_inicio
          AND fr.hora_fin >= p_hora_fin
          AND ubicacion_key(base.unidad, base.direccion) = ubicacion_key(v_inm.unidad, v_inm.direccion)
    ) INTO v_ya_franja;

    IF v_ya_franja THEN
        RETURN jsonb_build_object(
            'success', false, 'ya_disponible', true,
            'error', 'Ese horario ya está cubierto por la agenda: no necesitas solicitar apertura. Agenda directamente con agendar_cita_por_texto.'
        );
    END IF;

    SELECT s.id INTO v_dup
    FROM solicitudes_apertura s
    JOIN inmuebles si ON si.id = s.inmueble_id
    WHERE s.estado = 'pendiente'
      AND s.cliente_telefono = trim(p_cliente_telefono)
      AND s.fecha = p_fecha
      AND s.hora_inicio = p_hora_inicio
      AND s.hora_fin = p_hora_fin
      AND ubicacion_key(si.unidad, si.direccion) = ubicacion_key(v_inm.unidad, v_inm.direccion)
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true, 'ya_existia', true,
            'solicitud_id', v_dup.id, 'alcance', v_alcance,
            'inmueble', v_nombre_pub, 'unidad', v_unidad,
            'fecha', p_fecha, 'hora_inicio', p_hora_inicio, 'hora_fin', p_hora_fin,
            'mensaje', 'Esta solicitud ya estaba registrada y sigue pendiente de revisión.'
        );
    END IF;

    INSERT INTO solicitudes_apertura (
        inmobiliaria_id, inmueble_id, alcance, unidad, tipo_transaccion,
        fecha, hora_inicio, hora_fin,
        cliente_nombre, cliente_telefono, cliente_email, notas
    ) VALUES (
        v_inmobiliaria, v_inm.id, v_alcance, v_unidad, p_tipo_transaccion,
        p_fecha, p_hora_inicio, p_hora_fin,
        trim(p_cliente_nombre), trim(p_cliente_telefono), nullif(trim(p_cliente_email), ''), p_notas
    )
    RETURNING id INTO v_id;

    INSERT INTO tareas (
        inmobiliaria_id, usuario_id, entidad_tipo, entidad_id,
        evento_origen, evento_titulo, titulo, estado
    ) VALUES (
        v_inmobiliaria,
        NULL,
        'general',
        v_id,
        'solicitud_apertura',
        'Solicitud de apertura — ' || v_nombre_pub,
        'Aprobar o denegar: ' || trim(p_cliente_nombre) || ' · ' ||
            to_char(p_fecha, 'DD/MM') || ' ' || left(p_hora_inicio::text, 5),
        'pendiente'
    );

    RETURN jsonb_build_object(
        'success', true, 'ya_existia', false,
        'solicitud_id', v_id, 'alcance', v_alcance,
        'inmueble', v_nombre_pub, 'unidad', v_unidad,
        'fecha', p_fecha, 'hora_inicio', p_hora_inicio, 'hora_fin', p_hora_fin
    );
END;
$function$;
