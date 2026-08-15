-- =====================================================================
-- MIGRACIÓN: bucket de Storage para fotos de captación
-- Fecha: 2026-08-03
-- Motivo: el formulario subía las fotos a través del Server Action (función
-- serverless en Vercel), que tiene un tope de body de ~4.5 MB. Cualquier
-- captación con fotos pesadas fallaba SOLO en producción ("error inesperado
-- al conectar con el servidor").
-- Solución (Opción A): el navegador sube las fotos DIRECTO a Supabase Storage
-- (sin pasar por Vercel) y al webhook de n8n solo viajan las URLs públicas.
-- n8n descarga las imágenes desde esas URLs.
-- Ejecutar en el SQL Editor de Supabase. Es idempotente.
-- =====================================================================

-- Bucket público (n8n descarga las imágenes por URL, sin auth). Límite de 5 MB
-- por archivo y solo imágenes, como defensa a nivel de Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'captaciones', 'captaciones', true, 5242880,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

-- Subida: solo usuarios autenticados pueden subir al bucket 'captaciones'.
drop policy if exists "captaciones: subida autenticada" on storage.objects;
create policy "captaciones: subida autenticada"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'captaciones');

-- Lectura: pública (para que n8n y el navegador descarguen las imágenes).
drop policy if exists "captaciones: lectura publica" on storage.objects;
create policy "captaciones: lectura publica"
  on storage.objects for select to public
  using (bucket_id = 'captaciones');
