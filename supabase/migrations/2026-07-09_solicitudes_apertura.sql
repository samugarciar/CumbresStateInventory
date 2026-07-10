-- =====================================================================
-- MIGRACIÓN: solicitudes de apertura de agenda
-- Fecha: 2026-07-09
-- Cuando un cliente quiere visitar y NO hay franja que cubra el horario que
-- pide, el agente registra una solicitud formal (vía RPC, con el mismo
-- resolver por texto de agendar_cita_por_texto). Un admin la aprueba (crea la
-- franja + agenda la cita de una vez, desde la app) o la deniega; al decidir,
-- la app dispara un webhook n8n que le manda el veredicto al cliente por
-- WhatsApp (mismo patrón que "Confirmar citas": Header Auth X-Webhook-Token).
-- anon NO lee la tabla: solo inserta a través de la RPC SECURITY DEFINER.
-- Idempotente. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabla
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitudes_apertura (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    -- Inmueble resuelto por texto. Si alcance='unidad' es un apto representativo
    -- (el más barato), igual que en las citas a nivel unidad.
    inmueble_id UUID NOT NULL REFERENCES public.inmuebles(id) ON DELETE CASCADE,
    alcance TEXT NOT NULL DEFAULT 'inmueble' CHECK (alcance IN ('inmueble', 'unidad')),
    unidad TEXT,             -- nombre de la unidad cuando alcance='unidad'
    tipo_transaccion TEXT,   -- 'arriendo' | 'venta' | NULL (lo que pidió el cliente)
    -- Slot DESEADO por el cliente (aún no existe franja que lo cubra)
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL,
    cliente_email TEXT,
    notas TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'denegada')),
    motivo_denegacion TEXT,
    -- Si se aprueba: la cita creada (franja + cita se crean desde la app)
    cita_id UUID REFERENCES public.citas(id) ON DELETE SET NULL,
    decidido_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    decidido_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT solicitudes_hora_fin_mayor CHECK (hora_fin > hora_inicio),
    CONSTRAINT solicitudes_grilla_30min CHECK (
        EXTRACT(MINUTE FROM hora_inicio)::int % 30 = 0 AND EXTRACT(SECOND FROM hora_inicio) = 0 AND
        EXTRACT(MINUTE FROM hora_fin)::int % 30 = 0 AND EXTRACT(SECOND FROM hora_fin) = 0
    )
);

CREATE INDEX IF NOT EXISTS idx_solicitudes_estado ON public.solicitudes_apertura(inmobiliaria_id, estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_telefono ON public.solicitudes_apertura(cliente_telefono);

ALTER TABLE public.solicitudes_apertura ENABLE ROW LEVEL SECURITY;

-- Solo admins gestionan solicitudes (v1). anon NO tiene acceso directo
-- (datos personales): inserta únicamente vía la RPC SECURITY DEFINER.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'solicitudes_apertura' AND policyname = 'Admins gestionan solicitudes de su inmobiliaria'
    ) THEN
        CREATE POLICY "Admins gestionan solicitudes de su inmobiliaria"
            ON public.solicitudes_apertura
            FOR ALL
            USING (
                inmobiliaria_id = public.get_my_inmobiliaria() AND
                public.get_my_role() = 'admin'
            );
    END IF;
END $$;

REVOKE ALL ON public.solicitudes_apertura FROM anon;

-- ---------------------------------------------------------------------
-- 2. RPC: solicitar_apertura_agenda (para el agente, EXECUTE a anon)
--
-- POST /rest/v1/rpc/solicitar_apertura_agenda
--   { "p_texto": "Mi Mundo", "p_fecha": "2026-07-15",
--     "p_hora_inicio": "10:00", "p_hora_fin": "10:30",
--     "p_cliente_nombre": "Juan Pérez", "p_cliente_telefono": "3001234567",
--     "p_alcance": "unidad", "p_tipo_transaccion": "arriendo" }
--
-- Devuelve:
--   éxito → { success:true, ya_existia:false, solicitud_id, alcance,
--             inmueble, unidad, fecha, hora_inicio, hora_fin }
--   dedupe → igual pero ya_existia:true (había una pendiente idéntica)
--   slot ya cubierto → { success:false, ya_disponible:true, error } (agendar directo)
--   error → { success:false, error } (español, listo para leerle al cliente)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.solicitar_apertura_agenda(
    p_texto            TEXT,
    p_fecha            DATE,
    p_hora_inicio      TIME,
    p_hora_fin         TIME,
    p_cliente_nombre   TEXT,
    p_cliente_telefono TEXT,
    p_cliente_email    TEXT DEFAULT NULL,
    p_notas            TEXT DEFAULT NULL,
    p_alcance          TEXT DEFAULT 'inmueble',
    p_tipo_transaccion TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    -- ---- Validaciones básicas (mismos criterios que agendar_cita) ----
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

    IF p_fecha < CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se pueden solicitar horarios en fechas pasadas.');
    END IF;

    -- ---- Resolver por texto (mismo resolver tokenizado del agendamiento) ----
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

    -- Representativo (el más barato; para alcance=inmueble es el único)
    SELECT r.id, r.titulo, r.direccion, r.unidad INTO v_inm
    FROM public.resolver_inmuebles_por_texto(p_texto, p_tipo_transaccion) r
    ORDER BY r.precio LIMIT 1;

    SELECT i.inmobiliaria_id INTO v_inmobiliaria FROM inmuebles i WHERE i.id = v_inm.id;

    v_nombre_pub := CASE WHEN v_alcance = 'unidad' THEN v_unidad ELSE v_inm.titulo END;

    -- ---- Guarda: ¿ya hay una franja que cubre ese horario? → no es apertura ----
    -- (con el modelo de citas múltiples, una franja que cubre el slot SIEMPRE es
    -- agendable; el agente debe usar agendar_cita_por_texto directamente)
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

    -- ---- Dedupe: pendiente idéntica del mismo teléfono (misma ubicación + slot) ----
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

    -- ---- Insertar ----
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

    RETURN jsonb_build_object(
        'success', true, 'ya_existia', false,
        'solicitud_id', v_id, 'alcance', v_alcance,
        'inmueble', v_nombre_pub, 'unidad', v_unidad,
        'fecha', p_fecha, 'hora_inicio', p_hora_inicio, 'hora_fin', p_hora_fin
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.solicitar_apertura_agenda(TEXT, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- Recargar el cache de PostgREST para exponer la RPC y la tabla nuevas
NOTIFY pgrst, 'reload schema';
