-- =====================================================================
-- MIGRACIÓN: Rol 'revisor' en usuarios
-- Fecha: 2026-10-17
--
-- Para la revisión de la app de Meta: los revisores necesitan entrar a la
-- plataforma y abrir el registro integrado de WhatsApp. Su cuenta vive en
-- una inmobiliaria de demostración y solo llega a /whatsapp:
-- - El rol 'revisor' no pasa ninguna política que pida 'admin' o 'asesor',
--   y las demás filtran por inmobiliaria, así que no ve datos reales.
-- - La aplicación lo manda a /whatsapp desde cualquier otra página y solo
--   lo deja conectar números de su propia inmobiliaria.
--
-- Antes de esta migración el CHECK solo admitía 'admin' y 'asesor'.
-- =====================================================================

ALTER TABLE public.usuarios DROP CONSTRAINT usuarios_rol_check;

ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY['admin'::text, 'asesor'::text, 'revisor'::text]));
