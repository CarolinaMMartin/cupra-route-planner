-- Habilitar RLS en cliente_feedbacks si no está habilitado
ALTER TABLE cliente_feedbacks ENABLE ROW LEVEL SECURITY;

-- Política para que usuarios autenticados puedan insertar sus propios feedbacks
CREATE POLICY "Vendedores pueden insertar sus feedbacks"
ON cliente_feedbacks
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = vendedor_id);

-- Política para que usuarios autenticados puedan ver feedbacks
CREATE POLICY "Usuarios autenticados pueden ver feedbacks"
ON cliente_feedbacks
FOR SELECT
TO authenticated
USING (true);

-- Política para que vendedores puedan actualizar sus propios feedbacks
CREATE POLICY "Vendedores pueden actualizar sus feedbacks"
ON cliente_feedbacks
FOR UPDATE
TO authenticated
USING (auth.uid() = vendedor_id)
WITH CHECK (auth.uid() = vendedor_id);

-- Política para service role (acceso completo para operaciones de backend)
CREATE POLICY "Service role acceso completo feedbacks"
ON cliente_feedbacks
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);