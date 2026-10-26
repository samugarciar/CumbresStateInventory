-- =====================================================================
-- ARREGLO DE DATOS: el título «Sincronización ERP» de las tareas ya creadas
-- Fecha: 2026-10-26
--
-- NO ES UNA MIGRACIÓN. Se corre a mano, una vez, en el SQL Editor, DESPUÉS
-- de 2026-10-26_funciones_agenda_bogota_y_tildes.sql (que arregla la función
-- crear_tarea_actualizar_inmuebles para las tareas nuevas).
--
-- QUÉ ARREGLA
-- crear_tarea_actualizar_inmuebles escribía el evento como
-- «Sincronizaci√≥n ERP»: la tilde se dañó al copiar la función con una
-- codificación Mac Roman. Las tareas que ya se crearon así se ven con ese
-- texto en /tareas y en Mi día del CRM. Este UPDATE las deja en
-- «Sincronización ERP». No toca ninguna otra columna ni otra tarea.
--
-- CUÁNTAS: en producción se esperan 96 filas (lectura del 25 oct).
--
-- CÓMO CORRERLO
--   1. Pegar todo y ejecutar: muestra el conteo antes, hace el UPDATE,
--      muestra el conteo después y DESHACE (ROLLBACK).
--   2. Si el conteo es el esperado, cambiar el ROLLBACK del final por
--      COMMIT y volver a ejecutar.
-- =====================================================================

BEGIN;

-- Antes: cuántas tienen el título dañado (se esperan 96).
SELECT count(*) AS titulos_danados
  FROM public.tareas
 WHERE evento_titulo LIKE 'Sincronizaci%n ERP'
   AND evento_titulo <> 'Sincronización ERP';

UPDATE public.tareas
   SET evento_titulo = 'Sincronización ERP'
 WHERE evento_titulo LIKE 'Sincronizaci%n ERP'
   AND evento_titulo <> 'Sincronización ERP';

-- Después: no debe quedar ninguna dañada.
SELECT count(*) AS quedan_danados
  FROM public.tareas
 WHERE evento_titulo LIKE 'Sincronizaci%n ERP'
   AND evento_titulo <> 'Sincronización ERP';

SELECT count(*) AS ya_sanas
  FROM public.tareas
 WHERE evento_titulo = 'Sincronización ERP';

-- Cambiar por COMMIT cuando el conteo de arriba sea el esperado.
ROLLBACK;
