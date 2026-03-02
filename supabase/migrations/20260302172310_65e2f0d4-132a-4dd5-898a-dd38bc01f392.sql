
-- Tabla de activaciones (degustaciones, capacitaciones, eventos)
CREATE TABLE public.activaciones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendedor_id UUID NOT NULL,
  tipo TEXT NOT NULL, -- 'degustacion', 'capacitacion', 'evento', 'otro'
  descripcion TEXT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  client_id TEXT,
  prospecto_place_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.activaciones ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Usuarios autenticados pueden ver activaciones"
ON public.activaciones FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Vendedores pueden crear sus activaciones"
ON public.activaciones FOR INSERT
TO authenticated
WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY "Vendedores pueden actualizar sus activaciones"
ON public.activaciones FOR UPDATE
TO authenticated
USING (vendedor_id = auth.uid())
WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY "Vendedores pueden eliminar sus activaciones"
ON public.activaciones FOR DELETE
TO authenticated
USING (vendedor_id = auth.uid());

CREATE POLICY "Asignadores acceso completo activaciones"
ON public.activaciones FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = 'asignador'::app_role)
WITH CHECK (get_user_role(auth.uid()) = 'asignador'::app_role);

-- Index para queries por vendedor y mes
CREATE INDEX idx_activaciones_vendedor_fecha ON public.activaciones (vendedor_id, fecha);
