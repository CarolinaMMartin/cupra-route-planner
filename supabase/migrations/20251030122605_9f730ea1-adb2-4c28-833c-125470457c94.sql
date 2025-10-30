-- Habilitar RLS en tablas críticas
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recomendaciones_ia ENABLE ROW LEVEL SECURITY;

-- Política para que usuarios autenticados puedan leer clientes
CREATE POLICY "Usuarios autenticados pueden ver clientes"
ON clientes
FOR SELECT
TO authenticated
USING (true);

-- Política para que usuarios autenticados puedan leer recomendaciones
CREATE POLICY "Usuarios autenticados pueden ver recomendaciones"
ON recomendaciones_ia
FOR SELECT
TO authenticated
USING (true);

-- Política para que usuarios autenticados puedan insertar recomendaciones
CREATE POLICY "Usuarios autenticados pueden crear recomendaciones"
ON recomendaciones_ia
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Política para service_role pueda hacer todo (edge functions)
CREATE POLICY "Service role acceso completo clientes"
ON clientes
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role acceso completo recomendaciones"
ON recomendaciones_ia
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);