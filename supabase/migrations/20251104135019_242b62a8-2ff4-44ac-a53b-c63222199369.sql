-- Agregar campo para excluir clientes de recomendaciones
ALTER TABLE clientes 
ADD COLUMN excluir_recomendaciones BOOLEAN DEFAULT false;

-- Crear índice para mejorar el rendimiento de las consultas
CREATE INDEX idx_clientes_excluir_recomendaciones ON clientes(excluir_recomendaciones);

-- Comentario explicativo
COMMENT ON COLUMN clientes.excluir_recomendaciones IS 'Indica si el cliente debe ser excluido de futuras recomendaciones (cerrado definitivamente o relación terminada)';