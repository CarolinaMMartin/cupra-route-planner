-- Agregar políticas RLS para que vendedores puedan crear prospectos manualmente

-- Política para INSERT: usuarios autenticados pueden crear prospectos
CREATE POLICY "Vendedores pueden crear prospectos"
  ON public.prospectos
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Política para UPDATE: usuarios autenticados pueden actualizar prospectos
CREATE POLICY "Vendedores pueden actualizar prospectos"
  ON public.prospectos
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);