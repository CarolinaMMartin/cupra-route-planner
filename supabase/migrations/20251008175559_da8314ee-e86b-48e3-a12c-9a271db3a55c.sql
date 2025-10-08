-- Agregar cliente_id a clientes_recomendaciones_temporal relacionado con clientes
ALTER TABLE clientes_recomendaciones_temporal ADD COLUMN cliente_id uuid REFERENCES clientes(id);