
CREATE TABLE public.asignaciones_manuales_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid NOT NULL,
  vendedor_anterior text,
  vendedor_nuevo_id uuid NOT NULL,
  vendedor_nuevo_nombre text NOT NULL,
  client_id text NOT NULL,
  razon_social text
);

ALTER TABLE public.asignaciones_manuales_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Asignadores pueden ver audit"
  ON public.asignaciones_manuales_audit
  FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'asignador'::app_role);

CREATE POLICY "Asignadores pueden insertar audit"
  ON public.asignaciones_manuales_audit
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role(auth.uid()) = 'asignador'::app_role);
