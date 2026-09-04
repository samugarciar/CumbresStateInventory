-- =====================================================================
-- MIGRACIÓN: el asesor marca una cita como REALIZADA (completada)
-- Fecha: 2026-08-15
-- El asesor necesita poder marcar, desde /citas, que una visita se realizó
-- satisfactoriamente. `estado` ya admite 'completada', pero los asesores tienen
-- SOLO SELECT en citas (RLS) — no pueden UPDATE. Se resuelve con un RPC
-- SECURITY DEFINER que valida que quien llama sea el asesor dueño de la franja
-- de esa cita, en vez de abrir una policy de UPDATE (que sería demasiado amplia).
-- Se registra quién/cuándo, igual que confirmada_at/por. Idempotente.
-- =====================================================================

ALTER TABLE public.citas
    ADD COLUMN IF NOT EXISTS completada_at  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS completada_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.citas.completada_at IS 'Cuándo el asesor marcó la cita como realizada; NULL = no marcada';
COMMENT ON COLUMN public.citas.completada_por IS 'Asesor que marcó la cita como realizada';

-- RPC: marca la cita como realizada. Solo el asesor dueño de la franja de esa
-- cita puede hacerlo, y solo si sigue 'agendada'. Devuelve {success, error?}.
CREATE OR REPLACE FUNCTION public.marcar_cita_realizada(p_cita_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asesor uuid;
  v_estado text;
BEGIN
  SELECT f.asesor_id, c.estado
    INTO v_asesor, v_estado
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

  UPDATE public.citas
     SET estado = 'completada', completada_at = now(), completada_por = auth.uid()
   WHERE id = p_cita_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Postgres da EXECUTE a PUBLIC por defecto: se lo quitamos y lo damos solo a
-- usuarios autenticados (el asesor). anon (el agente) NO debe poder llamarlo.
REVOKE EXECUTE ON FUNCTION public.marcar_cita_realizada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_cita_realizada(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
