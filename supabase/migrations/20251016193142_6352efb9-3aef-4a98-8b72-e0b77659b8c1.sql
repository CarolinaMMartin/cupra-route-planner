-- Fase 1: Vaciar ventas_cupra
TRUNCATE TABLE ventas_cupra CASCADE;

-- Fase 2: Reestructuración de Base de Datos

-- 2.1 Modificar tabla clientes - hacer client_id único y no nulo
ALTER TABLE clientes
  ALTER COLUMN client_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_client_id_unique 
  ON clientes(client_id);

-- 2.2 Reestructurar asignaciones_vendedores_clientes
-- Eliminar FK actual
ALTER TABLE asignaciones_vendedores_clientes
  DROP CONSTRAINT IF EXISTS asignaciones_vendedores_clientes_cliente_id_fkey;

-- Cambiar tipo de columna de uuid a text
ALTER TABLE asignaciones_vendedores_clientes
  ALTER COLUMN cliente_id TYPE text USING cliente_id::text;

-- Renombrar columna
ALTER TABLE asignaciones_vendedores_clientes
  RENAME COLUMN cliente_id TO client_id;

-- Crear nueva FK a clientes.client_id
ALTER TABLE asignaciones_vendedores_clientes
  ADD CONSTRAINT asignaciones_vendedores_clientes_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE CASCADE;

-- 2.3 Reestructurar clientes_recomendaciones_temporal
-- Eliminar FK actual
ALTER TABLE clientes_recomendaciones_temporal
  DROP CONSTRAINT IF EXISTS clientes_recomendaciones_temporal_cliente_id_fkey;

-- Cambiar tipo de columna
ALTER TABLE clientes_recomendaciones_temporal
  ALTER COLUMN cliente_id TYPE text USING cliente_id::text;

-- Renombrar columna
ALTER TABLE clientes_recomendaciones_temporal
  RENAME COLUMN cliente_id TO client_id;

-- Crear FK a clientes.client_id
ALTER TABLE clientes_recomendaciones_temporal
  ADD CONSTRAINT clientes_recomendaciones_temporal_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE SET NULL;

-- 2.4 Limpiar y estandarizar sucursales
-- Eliminar FK obsoleta
ALTER TABLE sucursales
  DROP CONSTRAINT IF EXISTS sucursales_cliente_id_fkey;

-- Eliminar columna redundante
ALTER TABLE sucursales
  DROP COLUMN IF EXISTS cliente_id;

-- Hacer client_id NOT NULL
ALTER TABLE sucursales
  ALTER COLUMN client_id SET NOT NULL;

-- Agregar FK a clientes.client_id
ALTER TABLE sucursales
  ADD CONSTRAINT sucursales_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE CASCADE;

-- 2.5 Agregar FK en ventas_cupra
ALTER TABLE ventas_cupra
  ADD CONSTRAINT ventas_cupra_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE SET NULL;

-- 2.6 Agregar FK en recomendaciones_ia
ALTER TABLE recomendaciones_ia
  ADD CONSTRAINT recomendaciones_ia_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE SET NULL;

-- 2.7 Limpiar y estandarizar cliente_feedbacks
-- Eliminar columna cliente_id (uuid)
ALTER TABLE cliente_feedbacks
  DROP COLUMN IF EXISTS cliente_id;

-- Hacer client_id NOT NULL
ALTER TABLE cliente_feedbacks
  ALTER COLUMN client_id SET NOT NULL;

-- Agregar FK
ALTER TABLE cliente_feedbacks
  ADD CONSTRAINT cliente_feedbacks_client_id_fkey
  FOREIGN KEY (client_id) 
  REFERENCES clientes(client_id)
  ON DELETE CASCADE;