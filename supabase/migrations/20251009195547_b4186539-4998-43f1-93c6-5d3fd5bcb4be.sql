-- Crear tipo enum para el estado de asignaciones
CREATE TYPE estado_asignacion AS ENUM ('Asignado', 'Por visitar', 'Visitado');

-- Agregar campo estado a asignaciones_vendedores_clientes
ALTER TABLE asignaciones_vendedores_clientes
ADD COLUMN estado estado_asignacion NOT NULL DEFAULT 'Asignado';

-- Crear política RLS para que vendedores puedan actualizar el estado de sus asignaciones
CREATE POLICY "Vendedores can update their own asignaciones estado"
ON asignaciones_vendedores_clientes
FOR UPDATE
TO authenticated
USING (vendedor_id = auth.uid())
WITH CHECK (vendedor_id = auth.uid());

-- Crear política RLS para que vendedores puedan ver sus propias asignaciones
CREATE POLICY "Vendedores can view their own asignaciones"
ON asignaciones_vendedores_clientes
FOR SELECT
TO authenticated
USING (vendedor_id = auth.uid());