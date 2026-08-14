ALTER TABLE public.asignaciones_vendedores_clientes
  ADD COLUMN IF NOT EXISTS fecha_programada date;

CREATE INDEX IF NOT EXISTS idx_asignaciones_fecha_programada
  ON public.asignaciones_vendedores_clientes (vendedor_id, fecha_programada);