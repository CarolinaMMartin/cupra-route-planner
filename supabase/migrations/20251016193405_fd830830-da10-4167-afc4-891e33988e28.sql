-- Fase 1: Vaciar ventas_cupra
TRUNCATE TABLE ventas_cupra CASCADE;

-- Fase 2: Reestructuración - Agregar Foreign Keys

-- 2.1 FK en asignaciones_vendedores_clientes
ALTER TABLE asignaciones_vendedores_clientes
  DROP CONSTRAINT IF EXISTS asignaciones_vendedores_clientes_client_id_fkey;

ALTER TABLE asignaciones_vendedores_clientes
  ADD CONSTRAINT asignaciones_vendedores_clientes_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE CASCADE;

-- 2.2 FK en clientes_recomendaciones_temporal
ALTER TABLE clientes_recomendaciones_temporal
  DROP CONSTRAINT IF EXISTS clientes_recomendaciones_temporal_client_id_fkey;

ALTER TABLE clientes_recomendaciones_temporal
  ADD CONSTRAINT clientes_recomendaciones_temporal_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE SET NULL;

-- 2.3 FK en sucursales
ALTER TABLE sucursales
  DROP CONSTRAINT IF EXISTS sucursales_client_id_fkey;

ALTER TABLE sucursales
  ADD CONSTRAINT sucursales_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE CASCADE;

-- 2.4 FK en ventas_cupra
ALTER TABLE ventas_cupra
  DROP CONSTRAINT IF EXISTS ventas_cupra_client_id_fkey;

ALTER TABLE ventas_cupra
  ADD CONSTRAINT ventas_cupra_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE SET NULL;

-- 2.5 FK en recomendaciones_ia
ALTER TABLE recomendaciones_ia
  DROP CONSTRAINT IF EXISTS recomendaciones_ia_client_id_fkey;

ALTER TABLE recomendaciones_ia
  ADD CONSTRAINT recomendaciones_ia_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE SET NULL;

-- 2.6 FK en cliente_feedbacks
ALTER TABLE cliente_feedbacks
  DROP CONSTRAINT IF EXISTS cliente_feedbacks_client_id_fkey;

ALTER TABLE cliente_feedbacks
  ADD CONSTRAINT cliente_feedbacks_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE CASCADE;