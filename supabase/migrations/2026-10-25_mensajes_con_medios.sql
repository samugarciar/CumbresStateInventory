-- =====================================================================
-- MIGRACIÓN: fotos, audios, videos y documentos de WhatsApp
-- Fecha: 2026-10-25
--
-- EL PROBLEMA
-- Desde el 25 oct la comercial entra directo por la Cloud API (+57 312
-- 229 5313). Una foto o una nota de voz se guardaba como «[el cliente
-- mandó audio, que todavía no sabemos leer]»: el bot no la entendía y el
-- CRM no la mostraba. Antes eso lo resolvía n8n.
--
-- LO QUE AÑADE
-- · `agente_comercial_mensajes.medio` (jsonb): tipo, mime, ruta en el
--   bucket, tamaño, caption, nombre, si es nota de voz, la transcripción o
--   descripción y el error si lo hubo. Lo escribe el webhook
--   (lib/whatsapp/medios.ts). `contenido` sigue siendo el texto que leen el
--   bot y el CRM: la nota de voz transcrita, la foto descrita.
-- · El bucket PRIVADO `whatsapp_medios`, en <inmobiliaria>/<teléfono>/
--   <wamid>.<ext>. Escribe solo la plataforma (service_role); leen los
--   usuarios de la misma inmobiliaria, por la carpeta, como en
--   firmas_biometricas. El CRM pide URLs firmadas con la sesión del usuario.
--
-- Va ANTES del push del webhook: sin la columna, el insert de un medio falla.
-- =====================================================================

ALTER TABLE public.agente_comercial_mensajes
  ADD COLUMN IF NOT EXISTS medio jsonb;

COMMENT ON COLUMN public.agente_comercial_mensajes.medio IS
  'La foto, audio, video o documento del mensaje: {tipo, mime, ruta, bytes, caption, nombre, voz, texto, error}. ruta es la del bucket whatsapp_medios. Vacío en los mensajes de texto.';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('whatsapp_medios', 'whatsapp_medios', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520;

DROP POLICY IF EXISTS "Medios de WhatsApp de su inmobiliaria" ON storage.objects;
CREATE POLICY "Medios de WhatsApp de su inmobiliaria"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'whatsapp_medios'
    AND (storage.foldername(name))[1] = public.get_my_inmobiliaria()::text
  );
