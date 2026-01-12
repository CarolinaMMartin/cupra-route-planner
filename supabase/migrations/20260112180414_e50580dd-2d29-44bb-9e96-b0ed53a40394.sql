-- 1. Agregar columna con CHECK constraint (no texto libre)
ALTER TABLE asignaciones_vendedores_clientes 
ADD COLUMN IF NOT EXISTS origen_asignacion text 
  NOT NULL 
  DEFAULT 'asignador'
  CHECK (origen_asignacion IN ('auto', 'asignador'));

-- 2. Backfill de registros existentes (por si hay NULLs de antes del NOT NULL)
UPDATE asignaciones_vendedores_clientes 
SET origen_asignacion = 'asignador' 
WHERE origen_asignacion IS NULL;

-- 3. Ajustar política DELETE para vendedores
-- Solo pueden eliminar SUS PROPIAS asignaciones con origen 'auto'
DROP POLICY IF EXISTS "Vendedores pueden eliminar sus asignaciones" 
  ON asignaciones_vendedores_clientes;

CREATE POLICY "Vendedores pueden eliminar sus auto-asignaciones"
ON asignaciones_vendedores_clientes
FOR DELETE TO authenticated
USING (
  vendedor_id = auth.uid() 
  AND origen_asignacion = 'auto'
);