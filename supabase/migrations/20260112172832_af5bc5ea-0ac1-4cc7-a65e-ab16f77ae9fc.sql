-- =====================================================
-- 1. AJUSTAR POLICY INSERT (auto-asignación segura)
-- =====================================================
DROP POLICY IF EXISTS "Usuarios autenticados pueden crear asignaciones" 
  ON asignaciones_vendedores_clientes;

-- Vendedores pueden auto-asignarse
CREATE POLICY "Vendedores pueden auto-asignarse"
ON asignaciones_vendedores_clientes
FOR INSERT TO authenticated
WITH CHECK (vendedor_id = auth.uid());

-- Asignadores pueden crear asignaciones para otros
CREATE POLICY "Asignadores pueden crear asignaciones"
ON asignaciones_vendedores_clientes
FOR INSERT TO authenticated
WITH CHECK (public.get_user_role(auth.uid()) = 'asignador');

-- =====================================================
-- 2. AJUSTAR POLICY UPDATE (cerrar agujero de seguridad)
-- =====================================================
DROP POLICY IF EXISTS "Usuarios autenticados pueden actualizar asignaciones" 
  ON asignaciones_vendedores_clientes;

-- Vendedores pueden actualizar solo sus propias asignaciones
CREATE POLICY "Vendedores pueden actualizar sus asignaciones"
ON asignaciones_vendedores_clientes
FOR UPDATE TO authenticated
USING (vendedor_id = auth.uid())
WITH CHECK (vendedor_id = auth.uid());

-- =====================================================
-- 3. AJUSTAR POLICY DELETE (seguridad + funcionalidad asignador)
-- =====================================================
DROP POLICY IF EXISTS "Usuarios autenticados pueden eliminar asignaciones" 
  ON asignaciones_vendedores_clientes;

-- Asignadores pueden eliminar cualquier asignación (para reasignar)
CREATE POLICY "Asignadores pueden eliminar asignaciones"
ON asignaciones_vendedores_clientes
FOR DELETE TO authenticated
USING (public.get_user_role(auth.uid()) = 'asignador');

-- Vendedores pueden eliminar solo sus propias asignaciones
CREATE POLICY "Vendedores pueden eliminar sus asignaciones"
ON asignaciones_vendedores_clientes
FOR DELETE TO authenticated
USING (vendedor_id = auth.uid());

-- =====================================================
-- 4. ÍNDICES ÚNICOS para evitar duplicados
-- =====================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_vendedor_cliente 
ON asignaciones_vendedores_clientes (vendedor_id, client_id) 
WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_vendedor_prospecto 
ON asignaciones_vendedores_clientes (vendedor_id, prospecto_place_id) 
WHERE prospecto_place_id IS NOT NULL;