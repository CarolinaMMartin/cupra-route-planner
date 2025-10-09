-- Eliminar las RLS policies agregadas recientemente
DROP POLICY IF EXISTS "Asignadores can delete asignaciones" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Asignadores can insert asignaciones" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Vendedores can update their own asignaciones estado" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Vendedores can view their own asignaciones" ON public.asignaciones_vendedores_clientes;
DROP POLICY IF EXISTS "Authenticated users can view asignaciones" ON public.asignaciones_vendedores_clientes;

-- Recrear políticas básicas más permisivas
CREATE POLICY "Anyone authenticated can view asignaciones"
ON public.asignaciones_vendedores_clientes
FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone authenticated can insert asignaciones"
ON public.asignaciones_vendedores_clientes
FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Anyone authenticated can update asignaciones"
ON public.asignaciones_vendedores_clientes
FOR UPDATE
USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone authenticated can delete asignaciones"
ON public.asignaciones_vendedores_clientes
FOR DELETE
USING (auth.role() = 'authenticated');