-- =====================================================================
-- MIGRACIÓN: inmobiliaria y rol se averiguan UNA vez por consulta en la RLS
-- Fecha: 2026-11-23
--
-- EL PROBLEMA
-- Las políticas de public y storage decían `inmobiliaria_id =
-- get_my_inmobiliaria()` y `get_my_role() = 'admin'`. Ambas funciones son
-- VOLATILE + SECURITY DEFINER: Postgres las ejecuta en CADA fila (una
-- consulta a public.usuarios por fila revisada). El 23 nov /analitica del
-- CRM se cayó por eso (authenticated tiene statement_timeout = 8 s); el CRM
-- ya arregló sus cuatro tablas grandes (CumbresCRM, 20261123100001).
--
-- LO QUE CAMBIA
-- Las 32 políticas de public y la de storage.objects (medios de WhatsApp)
-- pasan a `(SELECT public.get_my_…())`, que Postgres evalúa una sola vez
-- por consulta (InitPlan). Mismo comando, mismos roles, mismo USING y
-- WITH CHECK; solo cambia la envoltura (y las tablas de los EXISTS quedan
-- con esquema explícito). La migración gemela del CRM
-- (20261123120001_crm_rls_resto_una_vez.sql) hace lo mismo con crm.
--
-- CÓMO SE PROBÓ (transacción revertida en producción, como authenticated
-- con request.jwt.claims de admin, dos asesores, revisor y un asesor
-- inactivo)
-- · Significado: el texto de las 73 políticas, quitando la envoltura,
--   queda idéntico; ni cmd, ni roles ni permissive cambian.
-- · Visibilidad: en las 41 tablas, cada usuario ve exactamente las mismas
--   filas (conteo + md5 del contenido). El asesor sigue viendo solo sus
--   inmuebles, citas, franjas, tareas y logs.
-- · Tiempo (mejor de 3, select * completo, admin → asesor igual o mejor):
--     agente_comercial_mensajes        3357 → 116 ms
--     agente_comercial_uso             2147 →  12 ms
--     agente_comercial_conversaciones   174 → 2,4 ms
--     citas 46 → 2 ms · tareas 26 → 0,5 ms · inmuebles 19 → 0,7 ms
--     storage.objects (whatsapp_medios) 11 → 3,7 ms
--
-- SIN TOCAR: auth.uid() sigue sin envolver (es STABLE y barato).
-- =====================================================================

-- SELECT · {public}
ALTER POLICY "Admins ven las conversaciones de su inmobiliaria" ON public.agente_comercial_conversaciones
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- SELECT · {public}
ALTER POLICY "Admins ven los mensajes de su inmobiliaria" ON public.agente_comercial_mensajes
  USING ((EXISTS ( SELECT 1
   FROM public.agente_comercial_conversaciones c
  WHERE ((c.id = agente_comercial_mensajes.conversacion_id) AND (c.inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))));

-- SELECT · {public}
ALTER POLICY "Admins ven el uso comercial de su inmobiliaria" ON public.agente_comercial_uso
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admins gestionan los agentes de su inmobiliaria" ON public.agentes_config
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admins ven y gestionan los informes de su inmobiliaria" ON public.bi_artefactos
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admin gestiona sus propias conversaciones" ON public.bi_conversaciones
  USING (((usuario_id = auth.uid()) AND (inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((usuario_id = auth.uid()) AND (inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admins ven y registran el uso BI de su inmobiliaria" ON public.bi_uso
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admins gestionan la cola de su inmobiliaria" ON public.captacion_cola
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admins gestionan prospectos de su inmobiliaria" ON public.captacion_prospectos
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- SELECT · {public}
ALTER POLICY "Asesores ven sus prospectos asignados" ON public.captacion_prospectos
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (asesor_id = auth.uid())));

-- SELECT · {public}
ALTER POLICY "Admins ven el uso de captaciones de su inmobiliaria" ON public.captacion_uso
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- ALL · {public}
ALTER POLICY "Admins gestionan citas de su inmobiliaria" ON public.citas
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- SELECT · {public}
ALTER POLICY "Asesores ven citas de sus franjas" ON public.citas
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (EXISTS ( SELECT 1
   FROM public.franjas_horarias f
  WHERE ((f.id = citas.franja_id) AND (f.asesor_id = auth.uid()))))));

-- ALL · {public}
ALTER POLICY "Admins CRUD franjas de su inmobiliaria" ON public.franjas_horarias
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- SELECT · {public}
ALTER POLICY "Asesores ven sus franjas asignadas" ON public.franjas_horarias
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'asesor'::text) AND (asesor_id = auth.uid())));

-- SELECT · {public}
ALTER POLICY "Los usuarios pueden ver su propia inmobiliaria" ON public.inmobiliarias
  USING ((id = (SELECT public.get_my_inmobiliaria())));

-- ALL · {public}
ALTER POLICY "Admins gestionan cualquier inmueble de su inmobiliaria" ON public.inmuebles
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- SELECT · {public}
ALTER POLICY "Admins ven todos los inmuebles de su inmobiliaria; Asesores ven" ON public.inmuebles
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (((SELECT public.get_my_role()) = 'admin'::text) OR (COALESCE(asesor_id_override, asesor_id) = auth.uid()))));

-- UPDATE · {public}
ALTER POLICY "Asesores pueden actualizar sus propios inmuebles asignados" ON public.inmuebles
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'asesor'::text) AND (COALESCE(asesor_id_override, asesor_id) = auth.uid())))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'asesor'::text) AND (COALESCE(asesor_id_override, asesor_id) = auth.uid())));

-- INSERT · {public}
ALTER POLICY "Asesores pueden insertar inmuebles de su propia inmobiliaria as" ON public.inmuebles
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'asesor'::text) AND (COALESCE(asesor_id_override, asesor_id) = auth.uid())));

-- SELECT · {authenticated}
ALTER POLICY "Asesores ven los inmuebles de su agenda" ON public.inmuebles
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'asesor'::text) AND (id IN ( SELECT public.inmuebles_de_mi_agenda()))));

-- ALL · {public}
ALTER POLICY "Admins gestionan todos los inventarios de su inmobiliaria" ON public.inventarios
  USING ((EXISTS ( SELECT 1
   FROM public.inmuebles i
  WHERE ((i.id = inventarios.inmueble_id) AND (i.inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.inmuebles i
  WHERE ((i.id = inventarios.inmueble_id) AND (i.inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))));

-- SELECT · {public}
ALTER POLICY "Admins ven inventarios de su inmobiliaria; Asesores ven de sus " ON public.inventarios
  USING ((EXISTS ( SELECT 1
   FROM public.inmuebles i
  WHERE ((i.id = inventarios.inmueble_id) AND (i.inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (((SELECT public.get_my_role()) = 'admin'::text) OR (COALESCE(i.asesor_id_override, i.asesor_id) = auth.uid()) OR (inventarios.creado_por = auth.uid()))))));

-- ALL · {public}
ALTER POLICY "Asesores pueden crear y editar inventarios para sus inmuebles a" ON public.inventarios
  USING ((EXISTS ( SELECT 1
   FROM public.inmuebles i
  WHERE ((i.id = inventarios.inmueble_id) AND (i.inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((COALESCE(i.asesor_id_override, i.asesor_id) = auth.uid()) OR (inventarios.creado_por = auth.uid()))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.inmuebles i
  WHERE ((i.id = inventarios.inmueble_id) AND (i.inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((COALESCE(i.asesor_id_override, i.asesor_id) = auth.uid()) OR (inventarios.creado_por = auth.uid()))))));

-- ALL · {public}
ALTER POLICY "Admins gestionan solicitudes de su inmobiliaria" ON public.solicitudes_apertura
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- UPDATE · {public}
ALTER POLICY "Solo admins pueden actualizar tareas" ON public.tareas
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- INSERT · {public}
ALTER POLICY "Usuarios pueden insertar tareas" ON public.tareas
  WITH CHECK ((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())));

-- SELECT · {public}
ALTER POLICY "Usuarios ven tareas según rol y pertenencia" ON public.tareas
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (((SELECT public.get_my_role()) = 'admin'::text) OR (usuario_id = auth.uid()))));

-- ALL · {public}
ALTER POLICY "Los administradores pueden gestionar usuarios de su inmobiliari" ON public.usuarios
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)))
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND ((SELECT public.get_my_role()) = 'admin'::text)));

-- SELECT · {public}
ALTER POLICY "Los usuarios pueden ver perfiles de su misma inmobiliaria" ON public.usuarios
  USING ((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())));

-- SELECT · {public}
ALTER POLICY "Admins ven todos los logs de su inmobiliaria; Asesores ven los " ON public.webhook_logs
  USING (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (((SELECT public.get_my_role()) = 'admin'::text) OR (usuario_id = auth.uid()))));

-- INSERT · {public}
ALTER POLICY "Los usuarios pueden insertar sus propios logs" ON public.webhook_logs
  WITH CHECK (((inmobiliaria_id = (SELECT public.get_my_inmobiliaria())) AND (usuario_id = auth.uid())));

-- SELECT · {authenticated}
ALTER POLICY "Medios de WhatsApp de su inmobiliaria" ON storage.objects
  USING (((bucket_id = 'whatsapp_medios'::text) AND ((storage.foldername(name))[1] = ((SELECT public.get_my_inmobiliaria()))::text)));
