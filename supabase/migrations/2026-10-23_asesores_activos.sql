-- =====================================================================
-- MIGRACIÓN: asesores activos e inactivos
-- Fecha: 2026-10-23
--
-- Cuando un asesor se va de la empresa no se puede borrar: usuarios.id
-- referencia auth.users con ON DELETE CASCADE, franjas_horarias.asesor_id
-- también es CASCADE y citas.franja_id → franjas_horarias otra vez CASCADE.
-- Borrar a un asesor borra su agenda y todas sus citas históricas.
-- En su lugar se desactiva:
-- - usuarios.activo = false (y desactivado_at). La aplicación lo saca de
--   listados, selectores y del emparejamiento con Nuby, y además banea su
--   usuario de Auth para que no pueda iniciar sesión.
-- - get_my_role() y get_my_inmobiliaria() devuelven NULL para un inactivo:
--   todas las políticas que dependen de ellas (75) le niegan el acceso,
--   aunque le quede un token vigente de la última hora.
--
-- Arreglo de seguridad que va con esto: la política "Los usuarios pueden
-- actualizar su propio perfil" dejaba a cualquier usuario cambiar CUALQUIER
-- columna de su fila (rol, inmobiliaria_id y ahora activo) llamando a la API
-- con su token. Un asesor o la cuenta del revisor de Meta podían volverse
-- admin. La aplicación nunca escribe en usuarios con el token del usuario
-- (registrar y editar asesores va con la llave de servicio), así que se
-- elimina, igual que la de "inserción de primer perfil" (el registro público
-- está cerrado y los perfiles los crea el admin). Y nadie borra usuarios con
-- su token: el borrado arrastra la agenda y las citas.
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS desactivado_at TIMESTAMPTZ;

-- CREATE OR REPLACE conserva dueño y permisos (la revocación a anon/PUBLIC
-- de 2026-10-09 sigue vigente).
CREATE OR REPLACE FUNCTION public.get_my_inmobiliaria()
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET row_security TO 'off'
AS $function$
  SELECT inmobiliaria_id FROM public.usuarios WHERE id = auth.uid() AND activo;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET row_security TO 'off'
AS $function$
  SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo;
$function$;

DROP POLICY IF EXISTS "Los usuarios pueden actualizar su propio perfil" ON public.usuarios;
DROP POLICY IF EXISTS "Permitir inserción de primer perfil" ON public.usuarios;

REVOKE DELETE ON public.usuarios FROM anon, authenticated;
