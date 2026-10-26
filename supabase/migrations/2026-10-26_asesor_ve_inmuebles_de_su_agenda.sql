-- =====================================================================
-- MIGRACIÓN: el asesor ve el inmueble de sus propias visitas
-- Fecha: 2026-10-26
--
-- EL PROBLEMA (S-02, versión estrecha)
-- Un asesor solo ve los inmuebles que tiene asignados (asesor_id o
-- asesor_id_override). Pero la agenda no sigue esa regla: el admin le pone
-- franjas y citas sobre inmuebles de otro asesor, y las franjas cubren a los
-- «hermanos» de la misma unidad. En producción, el 25 oct, 10 de 30 visitas
-- futuras y 17 de 29 franjas le salían al asesor que las atiende SIN
-- dirección en /citas, /agenda y Mi día del CRM: sabía que tenía una visita
-- pero no a dónde ir.
--
-- LO QUE AÑADE
-- · public.inmuebles_de_mi_agenda(): los ids de los inmuebles donde quien
--   llama tiene una franja, más los de las citas que caen en sus franjas.
--   SECURITY DEFINER para que la política de inmuebles no dependa de las
--   políticas de franjas y citas (y no entre en recursión si un día alguna
--   de ellas consulta inmuebles). Cerrada a anon.
-- · La política SELECT «Asesores ven los inmuebles de su agenda»: solo
--   para el rol asesor, solo su inmobiliaria, solo esos inmuebles. Es
--   permisiva, así que SUMA a la que ya había; no toca UPDATE ni INSERT
--   (el asesor sigue sin poder editar el inmueble de otro).
--
-- LO QUE NO HACE: abrirle al asesor todo el inventario disponible (la
-- versión amplia). Eso lo decide Samuel.
--
-- /inmuebles no cambia: para un asesor ya filtra por asesor_id en la
-- consulta, así que su lista sigue siendo la de sus inmuebles.
--
-- Idempotente: se puede correr dos veces en el SQL Editor sin error.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.inmuebles_de_mi_agenda()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT f.inmueble_id
    FROM public.franjas_horarias f
   WHERE f.asesor_id = auth.uid()
  UNION
  SELECT c.inmueble_id
    FROM public.citas c
    JOIN public.franjas_horarias f ON f.id = c.franja_id
   WHERE f.asesor_id = auth.uid();
$$;

COMMENT ON FUNCTION public.inmuebles_de_mi_agenda() IS
  'Inmuebles de la agenda de quien llama: los de sus franjas y los de las citas en sus franjas. '
  'La usa la política «Asesores ven los inmuebles de su agenda» de public.inmuebles.';

REVOKE ALL ON FUNCTION public.inmuebles_de_mi_agenda() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inmuebles_de_mi_agenda() TO authenticated, service_role;

DROP POLICY IF EXISTS "Asesores ven los inmuebles de su agenda" ON public.inmuebles;
CREATE POLICY "Asesores ven los inmuebles de su agenda"
  ON public.inmuebles
  FOR SELECT
  TO authenticated
  USING (
    inmobiliaria_id = public.get_my_inmobiliaria()
    AND public.get_my_role() = 'asesor'
    AND id IN (SELECT public.inmuebles_de_mi_agenda())
  );

NOTIFY pgrst, 'reload schema';
