-- Habilitar RLS en asignaciones_vendedores_clientes
ALTER TABLE public.asignaciones_vendedores_clientes ENABLE ROW LEVEL SECURITY;

-- Política para que usuarios autenticados puedan ver todas las asignaciones
CREATE POLICY "Usuarios autenticados pueden ver asignaciones"
ON public.asignaciones_vendedores_clientes
FOR SELECT
TO authenticated
USING (true);

-- Política para que usuarios autenticados puedan crear asignaciones
CREATE POLICY "Usuarios autenticados pueden crear asignaciones"
ON public.asignaciones_vendedores_clientes
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política para que usuarios autenticados puedan actualizar asignaciones
CREATE POLICY "Usuarios autenticados pueden actualizar asignaciones"
ON public.asignaciones_vendedores_clientes
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Política para que usuarios autenticados puedan eliminar asignaciones
CREATE POLICY "Usuarios autenticados pueden eliminar asignaciones"
ON public.asignaciones_vendedores_clientes
FOR DELETE
TO authenticated
USING (true);

-- Política para service role (usado por edge functions)
CREATE POLICY "Service role acceso completo asignaciones"
ON public.asignaciones_vendedores_clientes
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);