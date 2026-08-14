-- 1. Revocar todo acceso anónimo a las tablas hoy expuestas
REVOKE ALL ON public.ventas_cupra FROM anon;
REVOKE ALL ON public.sucursales FROM anon;
REVOKE ALL ON public.visitas FROM anon;
REVOKE ALL ON public.clientes_recomendaciones_temporal FROM anon;
REVOKE ALL ON public.places FROM anon;
REVOKE ALL ON public.areas FROM anon;
REVOKE ALL ON public.areas_places FROM anon;
REVOKE ALL ON public.areas_vendedores FROM anon;
REVOKE ALL ON public.v_clientes_priorizacion FROM anon;

-- 2. VENTAS_CUPRA: lectura solo usuarios activos, escritura solo service_role
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.ventas_cupra FROM authenticated;
GRANT SELECT ON public.ventas_cupra TO authenticated;
GRANT ALL ON public.ventas_cupra TO service_role;
ALTER TABLE public.ventas_cupra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios activos leen ventas" ON public.ventas_cupra
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- 3. SUCURSALES
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sucursales FROM authenticated;
GRANT SELECT ON public.sucursales TO authenticated;
GRANT ALL ON public.sucursales TO service_role;
ALTER TABLE public.sucursales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios activos leen sucursales" ON public.sucursales
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- 4. CLIENTES_RECOMENDACIONES_TEMPORAL
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clientes_recomendaciones_temporal FROM authenticated;
GRANT SELECT ON public.clientes_recomendaciones_temporal TO authenticated;
GRANT ALL ON public.clientes_recomendaciones_temporal TO service_role;
ALTER TABLE public.clientes_recomendaciones_temporal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios activos leen recomendaciones temporales" ON public.clientes_recomendaciones_temporal
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- 5. VISITAS: cada vendedor las suyas, asignadores/admin todas
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visitas TO authenticated;
GRANT ALL ON public.visitas TO service_role;
ALTER TABLE public.visitas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vendedores ven sus visitas" ON public.visitas
  FOR SELECT TO authenticated
  USING (vendedor_id = auth.uid() OR public.is_active_assignor(auth.uid()));
CREATE POLICY "Vendedores registran sus visitas" ON public.visitas
  FOR INSERT TO authenticated
  WITH CHECK (vendedor_id = auth.uid() AND public.is_active_user(auth.uid()));
CREATE POLICY "Vendedores actualizan sus visitas" ON public.visitas
  FOR UPDATE TO authenticated
  USING (vendedor_id = auth.uid() OR public.is_active_assignor(auth.uid()))
  WITH CHECK (vendedor_id = auth.uid() OR public.is_active_assignor(auth.uid()));
CREATE POLICY "Asignadores borran visitas" ON public.visitas
  FOR DELETE TO authenticated USING (public.is_active_assignor(auth.uid()));

-- 6. PLACES: catálogo geográfico, lectura para usuarios activos, alta para usuarios activos
GRANT SELECT, INSERT, UPDATE ON public.places TO authenticated;
GRANT ALL ON public.places TO service_role;
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios activos leen places" ON public.places
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Usuarios activos agregan places" ON public.places
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user(auth.uid()));
CREATE POLICY "Asignadores actualizan places" ON public.places
  FOR UPDATE TO authenticated
  USING (public.is_active_assignor(auth.uid()))
  WITH CHECK (public.is_active_assignor(auth.uid()));

-- 7. AREAS y relaciones: lectura usuarios activos, escritura asignadores/admin
GRANT SELECT, INSERT, UPDATE, DELETE ON public.areas TO authenticated;
GRANT ALL ON public.areas TO service_role;
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.areas_places TO authenticated;
GRANT ALL ON public.areas_places TO service_role;
ALTER TABLE public.areas_places ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.areas_vendedores TO authenticated;
GRANT ALL ON public.areas_vendedores TO service_role;
ALTER TABLE public.areas_vendedores ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['areas','areas_places','areas_vendedores'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Usuarios activos leen ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Asignadores gestionan ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()))',
      'Usuarios activos leen ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_active_assignor(auth.uid())) WITH CHECK (public.is_active_assignor(auth.uid()))',
      'Asignadores gestionan ' || t, t);
  END LOOP;
END $$;

-- 8. Vista de priorización: respeta permisos de quien consulta
ALTER VIEW public.v_clientes_priorizacion SET (security_invoker = on);
GRANT SELECT ON public.v_clientes_priorizacion TO authenticated;
GRANT SELECT ON public.v_clientes_priorizacion TO service_role;

-- 9. Funciones internas: sin ejecución anónima
REVOKE EXECUTE ON FUNCTION public.canonical_vendedor(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clean_old_recommendations() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_import_staging() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_ventas_import(jsonb, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_vendedor_barrios_top(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_active_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_active_assignor(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_active_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_assignor_like(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_places_catalog() FROM anon;
REVOKE EXECUTE ON FUNCTION public.titlecase_nombre(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.vendedor_key(text) FROM anon;