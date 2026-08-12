-- Helper: administrador
CREATE OR REPLACE FUNCTION public.is_active_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND rol = 'administrador'::public.app_role AND activo IS TRUE
  );
$$;

-- Helper: asignador o administrador (perfiles con capacidades de asignacion)
CREATE OR REPLACE FUNCTION public.is_assignor_like(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id
      AND rol IN ('asignador'::public.app_role, 'administrador'::public.app_role)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_assignor(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id
      AND rol IN ('asignador'::public.app_role, 'administrador'::public.app_role)
      AND activo IS TRUE
  );
$$;

-- Politicas que comparaban rol = 'asignador'
DROP POLICY IF EXISTS "Asignadores pueden crear asignaciones" ON public.asignaciones_vendedores_clientes;
CREATE POLICY "Asignadores pueden crear asignaciones" ON public.asignaciones_vendedores_clientes
FOR INSERT TO authenticated WITH CHECK (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores pueden eliminar asignaciones" ON public.asignaciones_vendedores_clientes;
CREATE POLICY "Asignadores pueden eliminar asignaciones" ON public.asignaciones_vendedores_clientes
FOR DELETE TO authenticated USING (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores pueden ver historial de importaciones" ON public.import_batches;
CREATE POLICY "Asignadores pueden ver historial de importaciones" ON public.import_batches
FOR SELECT TO authenticated USING (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores pueden editar contacto de clientes" ON public.clientes;
CREATE POLICY "Asignadores pueden editar contacto de clientes" ON public.clientes
FOR UPDATE TO authenticated USING (public.is_assignor_like(auth.uid())) WITH CHECK (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores acceso completo activaciones" ON public.activaciones;
CREATE POLICY "Asignadores acceso completo activaciones" ON public.activaciones
FOR ALL TO authenticated USING (public.is_assignor_like(auth.uid())) WITH CHECK (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores pueden ver audit" ON public.asignaciones_manuales_audit;
CREATE POLICY "Asignadores pueden ver audit" ON public.asignaciones_manuales_audit
FOR SELECT TO authenticated USING (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores pueden insertar audit" ON public.asignaciones_manuales_audit;
CREATE POLICY "Asignadores pueden insertar audit" ON public.asignaciones_manuales_audit
FOR INSERT TO authenticated WITH CHECK (public.is_assignor_like(auth.uid()));

DROP POLICY IF EXISTS "Asignadores pueden ver staging de importaciones" ON public.import_staging_rows;
CREATE POLICY "Asignadores pueden ver staging de importaciones" ON public.import_staging_rows
FOR SELECT TO authenticated USING (
  public.is_assignor_like(auth.uid())
  AND EXISTS (SELECT 1 FROM public.import_batches b WHERE b.id = import_staging_rows.batch_id)
);

DROP POLICY IF EXISTS "Asignadores pueden ver cola de prospectos" ON public.prospect_discovery_queue;
CREATE POLICY "Asignadores pueden ver cola de prospectos" ON public.prospect_discovery_queue
FOR SELECT TO authenticated USING (public.is_assignor_like(auth.uid()));

-- Perfiles: administrador gestiona todo; asignador solo vendedores
DROP POLICY IF EXISTS "Asignadores activos gestionan perfiles" ON public.profiles;

CREATE POLICY "Administradores gestionan perfiles" ON public.profiles
FOR ALL TO authenticated
USING (public.is_active_admin(auth.uid()))
WITH CHECK (public.is_active_admin(auth.uid()));

CREATE POLICY "Asignadores ven perfiles" ON public.profiles
FOR SELECT TO authenticated USING (public.is_active_assignor(auth.uid()));

CREATE POLICY "Asignadores crean vendedores" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (public.is_active_assignor(auth.uid()) AND rol = 'vendedor'::public.app_role);

CREATE POLICY "Asignadores editan vendedores" ON public.profiles
FOR UPDATE TO authenticated
USING (public.is_active_assignor(auth.uid()) AND rol = 'vendedor'::public.app_role)
WITH CHECK (public.is_active_assignor(auth.uid()) AND rol = 'vendedor'::public.app_role);

CREATE POLICY "Asignadores eliminan vendedores" ON public.profiles
FOR DELETE TO authenticated
USING (public.is_active_assignor(auth.uid()) AND rol = 'vendedor'::public.app_role);