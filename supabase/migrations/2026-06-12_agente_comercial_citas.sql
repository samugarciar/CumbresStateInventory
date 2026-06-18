-- =====================================================================
-- MIGRACIÓN: Agente comercial (n8n) — búsqueda de inmuebles y citas
-- Fecha: 2026-06-12
-- Ejecutar completa en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. INMUEBLES: columnas estructuradas para búsqueda + tipo 'oficina'
-- ---------------------------------------------------------------------
ALTER TABLE public.inmuebles
    ADD COLUMN IF NOT EXISTS unidad TEXT,
    ADD COLUMN IF NOT EXISTS ciudad TEXT,
    ADD COLUMN IF NOT EXISTS barrio TEXT,
    ADD COLUMN IF NOT EXISTS habitaciones INTEGER,
    ADD COLUMN IF NOT EXISTS banos INTEGER;

ALTER TABLE public.inmuebles DROP CONSTRAINT IF EXISTS inmuebles_tipo_inmueble_check;
ALTER TABLE public.inmuebles ADD CONSTRAINT inmuebles_tipo_inmueble_check
    CHECK (tipo_inmueble IN ('casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro'));

-- Clave de ubicación: agrupa inmuebles del mismo lugar.
-- Usa la unidad si existe; si no, la dirección exacta (normalizada).
CREATE OR REPLACE FUNCTION public.ubicacion_key(p_unidad TEXT, p_direccion TEXT)
RETURNS TEXT AS $$
  SELECT lower(trim(coalesce(nullif(trim(p_unidad), ''), p_direccion)))
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- 2. TABLA CITAS (sub-bloques de 30 min dentro de una franja horaria)
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS public.citas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    franja_id UUID NOT NULL REFERENCES public.franjas_horarias(id) ON DELETE CASCADE,
    inmueble_id UUID NOT NULL REFERENCES public.inmuebles(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    cliente_nombre TEXT NOT NULL,
    cliente_telefono TEXT NOT NULL,
    cliente_email TEXT,
    notas TEXT,
    estado TEXT NOT NULL DEFAULT 'agendada' CHECK (estado IN ('agendada', 'cancelada', 'completada')),
    origen TEXT NOT NULL DEFAULT 'n8n' CHECK (origen IN ('n8n', 'app')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT citas_hora_fin_mayor CHECK (hora_fin > hora_inicio),
    -- Las citas inician y terminan alineadas a la grilla de 30 minutos
    CONSTRAINT citas_grilla_30min CHECK (
        EXTRACT(MINUTE FROM hora_inicio)::int % 30 = 0 AND EXTRACT(SECOND FROM hora_inicio) = 0 AND
        EXTRACT(MINUTE FROM hora_fin)::int % 30 = 0 AND EXTRACT(SECOND FROM hora_fin) = 0
    )
);

-- Garantía a nivel de motor contra doble reserva concurrente:
-- dos citas agendadas de la misma franja no pueden cruzarse en el tiempo.
ALTER TABLE public.citas DROP CONSTRAINT IF EXISTS citas_sin_cruce;
ALTER TABLE public.citas ADD CONSTRAINT citas_sin_cruce EXCLUDE USING gist (
    franja_id WITH =,
    tsrange((fecha + hora_inicio), (fecha + hora_fin)) WITH &&
) WHERE (estado = 'agendada');

CREATE INDEX IF NOT EXISTS idx_citas_franja ON public.citas(franja_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha ON public.citas(fecha);
CREATE INDEX IF NOT EXISTS idx_citas_inmobiliaria ON public.citas(inmobiliaria_id);

ALTER TABLE public.citas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins gestionan citas de su inmobiliaria" ON public.citas;
CREATE POLICY "Admins gestionan citas de su inmobiliaria"
    ON public.citas
    FOR ALL
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND
        public.get_my_role() = 'admin'
    );

DROP POLICY IF EXISTS "Asesores ven citas de sus franjas" ON public.citas;
CREATE POLICY "Asesores ven citas de sus franjas"
    ON public.citas
    FOR SELECT
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND
        EXISTS (
            SELECT 1 FROM public.franjas_horarias f
            WHERE f.id = franja_id AND f.asesor_id = auth.uid()
        )
    );

-- ---------------------------------------------------------------------
-- 3. ACCESO DE LECTURA PARA EL AGENTE (rol anon vía PostgREST)
-- ---------------------------------------------------------------------
-- Inmuebles: anon solo ve los disponibles y solo columnas comerciales.
-- IMPORTANTE: con grants por columna, las peticiones del agente DEBEN
-- incluir ?select= con columnas explícitas (select=* devuelve error 401/403).
DROP POLICY IF EXISTS "Agente anon lee inmuebles disponibles" ON public.inmuebles;
CREATE POLICY "Agente anon lee inmuebles disponibles"
    ON public.inmuebles
    FOR SELECT
    TO anon
    USING (estado = 'disponible');

REVOKE SELECT ON public.inmuebles FROM anon;
GRANT SELECT (
    id, inmobiliaria_id, titulo, descripcion, direccion, unidad, ciudad, barrio,
    habitaciones, banos, precio, tipo_transaccion, tipo_inmueble,
    estado, imagenes, created_at
) ON public.inmuebles TO anon;

-- Franjas horarias: anon puede leerlas (solo contienen horarios, sin datos personales)
DROP POLICY IF EXISTS "Agente anon lee franjas" ON public.franjas_horarias;
CREATE POLICY "Agente anon lee franjas"
    ON public.franjas_horarias
    FOR SELECT
    TO anon
    USING (true);

GRANT SELECT ON public.franjas_horarias TO anon;

-- Citas: SIN política ni grant para anon (datos personales de clientes).
-- El agente agenda/cancela únicamente a través de las funciones RPC de abajo.
REVOKE ALL ON public.citas FROM anon;

-- ---------------------------------------------------------------------
-- 4. VISTA franjas_inmuebles
-- Expande cada franja a TODOS los inmuebles de la misma ubicación
-- (misma unidad, o misma dirección si no tienen unidad).
-- El agente consulta: GET /franjas_inmuebles?inmueble_id=eq.<uuid>&fecha=gte.<hoy>
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS public.franjas_inmuebles;
CREATE VIEW public.franjas_inmuebles
WITH (security_invoker = true) AS
SELECT
    f.id          AS franja_id,
    vinculado.id  AS inmueble_id,
    f.inmobiliaria_id,
    f.asesor_id,
    f.fecha,
    f.hora_inicio,
    f.hora_fin
FROM public.franjas_horarias f
JOIN public.inmuebles base ON base.id = f.inmueble_id
JOIN public.inmuebles vinculado
    ON vinculado.inmobiliaria_id = f.inmobiliaria_id
   AND public.ubicacion_key(vinculado.unidad, vinculado.direccion)
     = public.ubicacion_key(base.unidad, base.direccion);

GRANT SELECT ON public.franjas_inmuebles TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. RPC: consultar_disponibilidad
-- Devuelve los bloques LIBRES (franja menos citas agendadas) para un
-- inmueble, incluyendo franjas de otros inmuebles de su misma ubicación.
-- Llamada del agente: POST /rest/v1/rpc/consultar_disponibilidad
--   body: { "p_inmueble_id": "<uuid>", "p_fecha_desde": "2026-06-12", "p_fecha_hasta": "2026-06-26" }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_disponibilidad(
    p_inmueble_id UUID,
    p_fecha_desde DATE DEFAULT CURRENT_DATE,
    p_fecha_hasta DATE DEFAULT NULL
)
RETURNS TABLE (franja_id UUID, fecha DATE, hora_inicio TIME, hora_fin TIME, asesor TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_hasta DATE := coalesce(p_fecha_hasta, p_fecha_desde + 14);
    f RECORD;
    c RECORD;
    v_cursor TIME;
BEGIN
    FOR f IN
        SELECT fr.id, fr.fecha, fr.hora_inicio, fr.hora_fin, u.nombre_completo
        FROM franjas_horarias fr
        JOIN inmuebles base ON base.id = fr.inmueble_id
        JOIN inmuebles obj ON obj.id = p_inmueble_id
            AND obj.inmobiliaria_id = fr.inmobiliaria_id
            AND ubicacion_key(obj.unidad, obj.direccion) = ubicacion_key(base.unidad, base.direccion)
        JOIN usuarios u ON u.id = fr.asesor_id
        WHERE fr.fecha BETWEEN p_fecha_desde AND v_hasta
          AND obj.estado = 'disponible'
        ORDER BY fr.fecha, fr.hora_inicio
    LOOP
        v_cursor := f.hora_inicio;
        FOR c IN
            SELECT ci.hora_inicio AS ini, ci.hora_fin AS fin
            FROM citas ci
            WHERE ci.franja_id = f.id AND ci.estado = 'agendada'
            ORDER BY ci.hora_inicio
        LOOP
            IF c.ini > v_cursor THEN
                franja_id := f.id; fecha := f.fecha; asesor := f.nombre_completo;
                hora_inicio := v_cursor; hora_fin := c.ini;
                RETURN NEXT;
            END IF;
            v_cursor := greatest(v_cursor, c.fin);
        END LOOP;
        IF v_cursor < f.hora_fin THEN
            franja_id := f.id; fecha := f.fecha; asesor := f.nombre_completo;
            hora_inicio := v_cursor; hora_fin := f.hora_fin;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_disponibilidad(UUID, DATE, DATE) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. RPC: agendar_cita
-- Agenda una cita en sub-bloques de 30 min (combinables: 30, 60, 90...)
-- dentro de una franja. Encuentra automáticamente la franja correcta
-- aunque esté vinculada a otro inmueble de la misma ubicación.
-- Llamada del agente: POST /rest/v1/rpc/agendar_cita
--   body: { "p_inmueble_id": "...", "p_fecha": "2026-06-15", "p_hora_inicio": "09:00",
--           "p_hora_fin": "09:30", "p_cliente_nombre": "...", "p_cliente_telefono": "..." }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agendar_cita(
    p_inmueble_id UUID,
    p_fecha DATE,
    p_hora_inicio TIME,
    p_hora_fin TIME,
    p_cliente_nombre TEXT,
    p_cliente_telefono TEXT,
    p_cliente_email TEXT DEFAULT NULL,
    p_notas TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_inmueble RECORD;
    v_franja RECORD;
    v_cita_id UUID;
BEGIN
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

    IF p_fecha < CURRENT_DATE THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se pueden agendar citas en fechas pasadas.');
    END IF;

    SELECT id, inmobiliaria_id, estado, unidad, direccion, titulo
    INTO v_inmueble FROM inmuebles WHERE id = p_inmueble_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Inmueble no encontrado.');
    END IF;

    IF v_inmueble.estado <> 'disponible' THEN
        RETURN jsonb_build_object('success', false, 'error', 'El inmueble ya no está disponible.');
    END IF;

    -- Franja que cubre el rango pedido, en la misma ubicación, sin citas cruzadas
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
      AND NOT EXISTS (
          SELECT 1 FROM citas ci
          WHERE ci.franja_id = fr.id AND ci.estado = 'agendada'
            AND ci.hora_inicio < p_hora_fin AND ci.hora_fin > p_hora_inicio
      )
    ORDER BY fr.hora_inicio
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No hay disponibilidad para ese inmueble en el horario solicitado. Usa consultar_disponibilidad para ver los bloques libres.');
    END IF;

    INSERT INTO citas (
        inmobiliaria_id, franja_id, inmueble_id, fecha, hora_inicio, hora_fin,
        cliente_nombre, cliente_telefono, cliente_email, notas, origen
    ) VALUES (
        v_inmueble.inmobiliaria_id, v_franja.id, p_inmueble_id, p_fecha, p_hora_inicio, p_hora_fin,
        trim(p_cliente_nombre), trim(p_cliente_telefono), nullif(trim(p_cliente_email), ''), p_notas, 'n8n'
    )
    RETURNING id INTO v_cita_id;

    RETURN jsonb_build_object(
        'success', true,
        'cita_id', v_cita_id,
        'inmueble', v_inmueble.titulo,
        'fecha', p_fecha,
        'hora_inicio', p_hora_inicio,
        'hora_fin', p_hora_fin,
        'asesor', v_franja.asesor
    );
EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ese horario acaba de ser reservado por otra persona. Intenta con otro bloque.');
END;
$$;

GRANT EXECUTE ON FUNCTION public.agendar_cita(UUID, DATE, TIME, TIME, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. RPC: cancelar_cita (el cliente cancela verificando su teléfono)
-- Llamada del agente: POST /rest/v1/rpc/cancelar_cita
--   body: { "p_cita_id": "<uuid>", "p_cliente_telefono": "..." }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_cita(
    p_cita_id UUID,
    p_cliente_telefono TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE citas
    SET estado = 'cancelada'
    WHERE id = p_cita_id
      AND trim(cliente_telefono) = trim(p_cliente_telefono)
      AND estado = 'agendada';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'No se encontró una cita agendada con ese ID y teléfono.');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancelar_cita(UUID, TEXT) TO anon, authenticated;
