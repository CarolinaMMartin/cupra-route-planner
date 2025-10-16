-- Desactivar Row Level Security para la tabla ventas_cupra
ALTER TABLE public.ventas_cupra DISABLE ROW LEVEL SECURITY;

-- Eliminar las políticas existentes
DROP POLICY IF EXISTS "Authenticated users can view ventas_cupra" ON public.ventas_cupra;