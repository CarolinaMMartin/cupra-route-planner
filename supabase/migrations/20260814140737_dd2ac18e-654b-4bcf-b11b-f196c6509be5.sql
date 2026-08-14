-- CLIENT_PLACES: cerrar acceso anónimo
DROP POLICY IF EXISTS "Usuarios autenticados pueden ver client_places" ON public.client_places;
DROP POLICY IF EXISTS "Service role acceso completo client_places" ON public.client_places;

REVOKE ALL ON public.client_places FROM anon;
GRANT SELECT ON public.client_places TO authenticated;
GRANT ALL ON public.client_places TO service_role;

CREATE POLICY "Usuarios activos ven client_places" ON public.client_places
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Asignadores gestionan client_places" ON public.client_places
  FOR ALL TO authenticated
  USING (public.is_active_assignor(auth.uid()))
  WITH CHECK (public.is_active_assignor(auth.uid()));
CREATE POLICY "Service role acceso completo client_places" ON public.client_places
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- FUNCIONES: quitar ejecución pública (PUBLIC), re-otorgar donde corresponde
REVOKE EXECUTE ON FUNCTION public.is_active_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_assignor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_assignor_like(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_vendedor_barrios_top(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_vendedor(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.titlecase_nombre(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vendedor_key(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_places_catalog() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_assignor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_assignor_like(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_vendedor_barrios_top(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canonical_vendedor(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.titlecase_nombre(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vendedor_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_places_catalog() TO authenticated, service_role;

-- Solo procesos internos
REVOKE EXECUTE ON FUNCTION public.commit_ventas_import(jsonb, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clean_old_recommendations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_import_staging() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_ventas_import(jsonb, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.clean_old_recommendations() TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_import_staging() TO service_role;