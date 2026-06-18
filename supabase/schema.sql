-- =====================================================================
-- Cumbres State Inventory - Database Schema & Security Policies
-- =====================================================================

-- Habilitar la extensión UUID si no está habilitada
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Limpieza previa (opcional, para desarrollo)
DROP TABLE IF EXISTS public.inventarios CASCADE;
DROP TABLE IF EXISTS public.inmuebles CASCADE;
DROP TABLE IF EXISTS public.usuarios CASCADE;
DROP TABLE IF EXISTS public.inmobiliarias CASCADE;

-- 1. TABLA INMOBILIARIAS
CREATE TABLE public.inmobiliarias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    nit TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en inmobiliarias
ALTER TABLE public.inmobiliarias ENABLE ROW LEVEL SECURITY;

-- 2. TABLA USUARIOS (Perfiles públicos conectados a auth.users)
CREATE TABLE public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    nombre_completo TEXT NOT NULL,
    email TEXT NOT NULL,
    telefono TEXT,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'asesor')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en usuarios
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- 3. TABLA INMUEBLES
CREATE TABLE public.inmuebles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    asesor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    asesor_id_override UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    direccion TEXT NOT NULL,
    unidad TEXT, -- Nombre de la unidad/edificio. Agrupa inmuebles del mismo lugar (si es NULL se usa la dirección)
    ciudad TEXT,
    barrio TEXT,
    habitaciones INTEGER,
    banos INTEGER,
    precio NUMERIC NOT NULL CHECK (precio >= 0),
    tipo_transaccion TEXT NOT NULL CHECK (tipo_transaccion IN ('venta', 'arriendo')),
    tipo_inmueble TEXT NOT NULL CHECK (tipo_inmueble IN ('casa', 'apartamento', 'lote', 'local', 'bodega', 'oficina', 'otro')),
    estado TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'arrendado', 'inactivo')),
    arrendasoft_id BIGINT UNIQUE,
    arrendasoft_contrato_id TEXT,
    contrato_id_propuesto TEXT,
    arrendasoft_contrato_info JSONB,
    imagenes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en inmuebles
ALTER TABLE public.inmuebles ENABLE ROW LEVEL SECURITY;

-- 4. TABLA INVENTARIOS
CREATE TABLE public.inventarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmueble_id UUID NOT NULL REFERENCES public.inmuebles(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    items JSONB NOT NULL, -- Almacena toda la estructura jerárquica del PDF (llaves, exteriores, salas, alcobas, firmas)
    creado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completado')),
    arrendasoft_contrato_id TEXT,
    contrato_id_propuesto TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en inventarios
ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- FUNCIONES AUXILIARES PARA POLÍTICAS (Evitar recursiones infinitas)
-- =====================================================================

-- Obtener el rol del usuario logueado
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT rol FROM public.usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET row_security = off;

-- Obtener el id de la inmobiliaria del usuario logueado
CREATE OR REPLACE FUNCTION public.get_my_inmobiliaria()
RETURNS UUID AS $$
  SELECT inmobiliaria_id FROM public.usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER SET row_security = off;


-- =====================================================================
-- POLÍTICAS RLS (Row Level Security)
-- =====================================================================

-- --- POLÍTICAS DE INMOBILIARIAS ---
CREATE POLICY "Los usuarios pueden ver su propia inmobiliaria"
    ON public.inmobiliarias
    FOR SELECT
    USING (id = public.get_my_inmobiliaria());

CREATE POLICY "Permitir la creación de inmobiliaria en el registro"
    ON public.inmobiliarias
    FOR INSERT
    WITH CHECK (true); -- Cualquiera puede registrar una inmobiliaria nueva al crear una cuenta

-- --- POLÍTICAS DE USUARIOS ---
CREATE POLICY "Los usuarios pueden ver perfiles de su misma inmobiliaria"
    ON public.usuarios
    FOR SELECT
    USING (inmobiliaria_id = public.get_my_inmobiliaria());

CREATE POLICY "Los administradores pueden gestionar usuarios de su inmobiliaria"
    ON public.usuarios
    FOR ALL
    USING (inmobiliaria_id = public.get_my_inmobiliaria() AND public.get_my_role() = 'admin')
    WITH CHECK (inmobiliaria_id = public.get_my_inmobiliaria() AND public.get_my_role() = 'admin');

CREATE POLICY "Los usuarios pueden actualizar su propio perfil"
    ON public.usuarios
    FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY "Permitir inserción de primer perfil"
    ON public.usuarios
    FOR INSERT
    WITH CHECK (id = auth.uid()); -- Permite que el usuario que se registra cree su perfil

-- --- POLÍTICAS DE INMUEBLES ---
CREATE POLICY "Admins ven todos los inmuebles de su inmobiliaria; Asesores ven los suyos"
    ON public.inmuebles
    FOR SELECT
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND (
            public.get_my_role() = 'admin' OR 
            coalesce(asesor_id_override, asesor_id) = auth.uid()
        )
    );

CREATE POLICY "Admins gestionan cualquier inmueble de su inmobiliaria"
    ON public.inmuebles
    FOR ALL
    USING (inmobiliaria_id = public.get_my_inmobiliaria() AND public.get_my_role() = 'admin')
    WITH CHECK (inmobiliaria_id = public.get_my_inmobiliaria() AND public.get_my_role() = 'admin');

CREATE POLICY "Asesores pueden insertar inmuebles de su propia inmobiliaria asignados a sí mismos"
    ON public.inmuebles
    FOR INSERT
    WITH CHECK (
        inmobiliaria_id = public.get_my_inmobiliaria() AND 
        public.get_my_role() = 'asesor' AND 
        coalesce(asesor_id_override, asesor_id) = auth.uid()
    );

CREATE POLICY "Asesores pueden actualizar sus propios inmuebles asignados"
    ON public.inmuebles
    FOR UPDATE
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND 
        public.get_my_role() = 'asesor' AND 
        coalesce(asesor_id_override, asesor_id) = auth.uid()
    )
    WITH CHECK (
        inmobiliaria_id = public.get_my_inmobiliaria() AND 
        public.get_my_role() = 'asesor' AND 
        coalesce(asesor_id_override, asesor_id) = auth.uid()
    );

-- --- POLÍTICAS DE INVENTARIOS ---
CREATE POLICY "Admins ven inventarios de su inmobiliaria; Asesores ven de sus inmuebles"
    ON public.inventarios
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.inmuebles i
            WHERE i.id = inmueble_id AND i.inmobiliaria_id = public.get_my_inmobiliaria() AND (
                public.get_my_role() = 'admin' OR
                coalesce(i.asesor_id_override, i.asesor_id) = auth.uid() OR
                creado_por = auth.uid()
            )
        )
    );

CREATE POLICY "Admins gestionan todos los inventarios de su inmobiliaria"
    ON public.inventarios
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.inmuebles i
            WHERE i.id = inmueble_id AND i.inmobiliaria_id = public.get_my_inmobiliaria() AND public.get_my_role() = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.inmuebles i
            WHERE i.id = inmueble_id AND i.inmobiliaria_id = public.get_my_inmobiliaria() AND public.get_my_role() = 'admin'
        )
    );

CREATE POLICY "Asesores pueden crear y editar inventarios para sus inmuebles asignados"
    ON public.inventarios
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.inmuebles i
            WHERE i.id = inmueble_id AND i.inmobiliaria_id = public.get_my_inmobiliaria() AND (
                coalesce(i.asesor_id_override, i.asesor_id) = auth.uid() OR
                inventarios.creado_por = auth.uid()
            )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.inmuebles i
            WHERE i.id = inmueble_id AND i.inmobiliaria_id = public.get_my_inmobiliaria() AND (
                coalesce(i.asesor_id_override, i.asesor_id) = auth.uid() OR
                inventarios.creado_por = auth.uid()
            )
        )
    );

-- =====================================================================
-- 5. TABLA WEBHOOK LOGS (Trazabilidad de captaciones enviadas a n8n)
-- =====================================================================
CREATE TABLE public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    titulo_captacion TEXT NOT NULL,
    asesor_nombre TEXT NOT NULL,
    precio NUMERIC NOT NULL,
    estado TEXT NOT NULL DEFAULT 'enviando' CHECK (estado IN ('enviando', 'exito', 'fallido')),
    error_detalles TEXT,
    payload JSONB NOT NULL,
    files_count INTEGER NOT NULL DEFAULT 0,
    files_size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS en webhook_logs
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins ven todos los logs de su inmobiliaria; Asesores ven los propios"
    ON public.webhook_logs
    FOR SELECT
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND (
            public.get_my_role() = 'admin' OR 
            usuario_id = auth.uid()
        )
    );

CREATE POLICY "Los usuarios pueden insertar sus propios logs"
    ON public.webhook_logs
    FOR INSERT
    WITH CHECK (
        inmobiliaria_id = public.get_my_inmobiliaria() AND 
        usuario_id = auth.uid()
    );

-- =====================================================================
-- 6. TABLA TAREAS OPERATIVAS (Flujo administrativo polimórfico)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tareas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, -- Asesor creador del evento
    entidad_tipo TEXT NOT NULL DEFAULT 'general' CHECK (entidad_tipo IN ('captacion', 'inventario', 'inmueble', 'general')),
    entidad_id UUID, -- ID de referencia genérica
    evento_origen TEXT, -- 'captacion_creada', 'inventario_creado', etc.
    evento_titulo TEXT NOT NULL, -- Título descriptivo para agrupar (ej. "Apartamento Laureles")
    titulo TEXT NOT NULL, -- "Subir a marketplace", "Subir a ERP", etc.
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completada')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    completada_at TIMESTAMP WITH TIME ZONE,
    completada_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL
);

-- Habilitar RLS en tareas
ALTER TABLE public.tareas ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para tareas
CREATE POLICY "Usuarios ven tareas según rol y pertenencia"
    ON public.tareas
    FOR SELECT
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND (
            public.get_my_role() = 'admin' OR 
            usuario_id = auth.uid()
        )
    );

CREATE POLICY "Usuarios pueden insertar tareas"
    ON public.tareas
    FOR INSERT
    WITH CHECK (
        inmobiliaria_id = public.get_my_inmobiliaria()
    );

CREATE POLICY "Solo admins pueden actualizar tareas de su inmobiliaria"
    ON public.tareas
    FOR UPDATE
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND
        public.get_my_role() = 'admin'
    );


-- =============================================================
-- Tabla: franjas_horarias (Agenda semanal de visitas/eventos)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.franjas_horarias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inmobiliaria_id UUID NOT NULL REFERENCES public.inmobiliarias(id) ON DELETE CASCADE,
    inmueble_id UUID NOT NULL REFERENCES public.inmuebles(id) ON DELETE CASCADE,
    asesor_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    color TEXT DEFAULT '#00abd8',
    creado_por UUID NOT NULL REFERENCES public.usuarios(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- La hora de fin debe ser mayor que la de inicio
    CONSTRAINT hora_fin_mayor CHECK (hora_fin > hora_inicio)
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_franjas_fecha ON public.franjas_horarias(fecha);
CREATE INDEX IF NOT EXISTS idx_franjas_asesor ON public.franjas_horarias(asesor_id);
CREATE INDEX IF NOT EXISTS idx_franjas_inmobiliaria ON public.franjas_horarias(inmobiliaria_id);

-- Habilitar RLS
ALTER TABLE public.franjas_horarias ENABLE ROW LEVEL SECURITY;

-- Admin: CRUD completo para su inmobiliaria
CREATE POLICY "Admins CRUD franjas de su inmobiliaria"
    ON public.franjas_horarias
    FOR ALL
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND
        public.get_my_role() = 'admin'
    );

-- Asesor: solo lectura de sus propias franjas
CREATE POLICY "Asesores ven sus franjas asignadas"
    ON public.franjas_horarias
    FOR SELECT
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND
        public.get_my_role() = 'asesor' AND
        asesor_id = auth.uid()
    );


-- =====================================================================
-- AGENTE COMERCIAL (n8n): citas, acceso anon y funciones RPC
-- (Ver migración: supabase/migrations/2026-06-12_agente_comercial_citas.sql)
-- =====================================================================

-- Clave de ubicación: agrupa inmuebles del mismo lugar.
-- Usa la unidad si existe; si no, la dirección exacta (normalizada).
CREATE OR REPLACE FUNCTION public.ubicacion_key(p_unidad TEXT, p_direccion TEXT)
RETURNS TEXT AS $$
  SELECT lower(trim(coalesce(nullif(trim(p_unidad), ''), p_direccion)))
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------
-- Tabla: citas (sub-bloques de 30 min dentro de una franja horaria)
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
    ),
    -- Garantía a nivel de motor contra doble reserva concurrente
    CONSTRAINT citas_sin_cruce EXCLUDE USING gist (
        franja_id WITH =,
        tsrange((fecha + hora_inicio), (fecha + hora_fin)) WITH &&
    ) WHERE (estado = 'agendada')
);

CREATE INDEX IF NOT EXISTS idx_citas_franja ON public.citas(franja_id);
CREATE INDEX IF NOT EXISTS idx_citas_fecha ON public.citas(fecha);
CREATE INDEX IF NOT EXISTS idx_citas_inmobiliaria ON public.citas(inmobiliaria_id);

ALTER TABLE public.citas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins gestionan citas de su inmobiliaria"
    ON public.citas
    FOR ALL
    USING (
        inmobiliaria_id = public.get_my_inmobiliaria() AND
        public.get_my_role() = 'admin'
    );

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
-- Acceso de LECTURA para el agente (rol anon vía PostgREST)
-- ---------------------------------------------------------------------
-- Inmuebles: anon solo ve disponibles y solo columnas comerciales.
-- IMPORTANTE: el agente DEBE pedir columnas explícitas con ?select=
-- (select=* falla por los grants a nivel de columna).
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

-- Franjas horarias: anon puede leerlas (solo horarios, sin datos personales)
CREATE POLICY "Agente anon lee franjas"
    ON public.franjas_horarias
    FOR SELECT
    TO anon
    USING (true);

GRANT SELECT ON public.franjas_horarias TO anon;

-- Citas: SIN política ni grant anon (datos personales). El agente usa las RPC.
REVOKE ALL ON public.citas FROM anon;

-- ---------------------------------------------------------------------
-- Vista: franjas_inmuebles
-- Expande cada franja a TODOS los inmuebles de la misma ubicación
-- (misma unidad, o misma dirección si no tienen unidad).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.franjas_inmuebles
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
-- RPC para el agente (cuerpos completos en las migraciones correspondientes):
--   consultar_disponibilidad, agendar_cita, cancelar_cita
--   → 2026-06-12_agente_comercial_citas.sql
--   resolver_inmuebles_por_texto (helper), consultar_disponibilidad_por_texto,
--   agendar_cita_por_texto  (resuelven el inmueble por texto libre, sin UUID)
--   → 2026-06-16_consultar_disponibilidad_por_texto.sql
-- ---------------------------------------------------------------------
