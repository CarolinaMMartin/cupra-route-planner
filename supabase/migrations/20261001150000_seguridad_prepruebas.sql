-- Las políticas restrictivas se suman a las permisivas existentes: ninguna regla
-- antigua puede dar acceso de negocio a una cuenta deshabilitada.
DO $block$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'profiles' LOOP
    EXECUTE format('CREATE POLICY cuenta_activa_requerida ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.is_active_user(auth.uid()))) WITH CHECK ((SELECT public.is_active_user(auth.uid())))',t.tablename);
  END LOOP;
END $block$;

-- Los RPC auxiliares deben respetar las mismas políticas de lectura que la API.
ALTER FUNCTION public.rubros_disponibles() SECURITY INVOKER;
ALTER FUNCTION public.sync_places_catalog() SECURITY INVOKER;
ALTER FUNCTION public.get_vendedor_barrios_top(uuid,integer) SECURITY INVOKER;
ALTER FUNCTION public.get_user_role(uuid) SECURITY INVOKER;

DROP POLICY IF EXISTS "Service role acceso completo notificaciones" ON public.notificaciones;
DROP POLICY IF EXISTS "Vendedores pueden marcar como leidas" ON public.notificaciones;
DROP POLICY IF EXISTS "Vendedores ven sus notificaciones" ON public.notificaciones;
REVOKE ALL ON public.notificaciones FROM anon, PUBLIC;
REVOKE ALL ON public.notificaciones FROM authenticated;
GRANT SELECT, INSERT ON public.notificaciones TO authenticated;
GRANT UPDATE(leida) ON public.notificaciones TO authenticated;
GRANT ALL ON public.notificaciones TO service_role;
CREATE POLICY notificaciones_propias_lectura ON public.notificaciones FOR SELECT TO authenticated USING (vendedor_id=auth.uid());
CREATE POLICY notificaciones_propias_leida ON public.notificaciones FOR UPDATE TO authenticated USING (vendedor_id=auth.uid()) WITH CHECK (vendedor_id=auth.uid());
-- La interfaz actual materializa los recordatorios del propio usuario.
CREATE POLICY recordatorios_propios_notificacion ON public.notificaciones FOR INSERT TO authenticated WITH CHECK (vendedor_id=auth.uid() AND tipo='recordatorio' AND asignacion_id IS NULL);
CREATE POLICY notificaciones_servicio ON public.notificaciones FOR ALL TO service_role USING (true) WITH CHECK (true);

-- El histórico de ventas está reservado a administradores en la matriz de permisos.
CREATE POLICY ventas_lectura_administrador ON public.ventas_cupra AS RESTRICTIVE FOR SELECT TO authenticated USING (public.is_active_admin(auth.uid()));

-- El cron ejecuta SQL interno, sin un token público que habilite escrituras de servidor.
CREATE OR REPLACE FUNCTION public.generar_notificaciones_pendientes()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cupra_notificaciones_pendientes'));
  INSERT INTO public.notificaciones(vendedor_id,tipo,titulo,mensaje,asignacion_id,leida)
  SELECT a.vendedor_id,'asignacion_pendiente','Asignación pendiente de cierre',
    '"'||COALESCE(CASE WHEN a.es_prospecto THEN p.nombre ELSE c.razon_social END,'Cliente')||'" lleva '||
    ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date-COALESCE(a.fecha_programada,(a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date))||' días sin cerrar. Por favor, actualiza el estado o registra tu visita.',
    a.id,false
  FROM public.asignaciones_vendedores_clientes a
  JOIN public.profiles perfil ON perfil.user_id=a.vendedor_id AND perfil.activo
  LEFT JOIN public.clientes c ON c.client_id=a.client_id
  LEFT JOIN public.prospectos p ON p.place_id=a.prospecto_place_id
  WHERE a.estado IN ('Asignado','Por visitar')
    AND COALESCE(a.fecha_programada,(a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)<=(now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date-3
    AND NOT EXISTS(SELECT 1 FROM public.notificaciones n WHERE n.asignacion_id=a.id AND n.tipo='asignacion_pendiente');
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION public.generar_notificaciones_pendientes() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generar_notificaciones_pendientes() TO service_role;

DO $block$
DECLARE j record;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOR j IN SELECT jobid FROM cron.job WHERE command LIKE '%functions/v1/cleanup-visited-assignments%' LOOP
      PERFORM cron.alter_job(j.jobid,active:=false);
    END LOOP;
    FOR j IN SELECT jobid FROM cron.job WHERE command LIKE '%functions/v1/check-pending-assignments%' LOOP
      PERFORM cron.alter_job(j.jobid,command:='SELECT public.generar_notificaciones_pendientes();');
    END LOOP;
  END IF;
END $block$;
