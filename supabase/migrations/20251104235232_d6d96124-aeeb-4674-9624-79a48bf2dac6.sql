-- Agregar campo para prospectos en cliente_feedbacks
ALTER TABLE cliente_feedbacks 
ADD COLUMN prospecto_place_id text;

-- Hacer que client_id sea nullable ya que puede ser prospecto o cliente
ALTER TABLE cliente_feedbacks 
ALTER COLUMN client_id DROP NOT NULL;

-- Agregar FK a prospectos
ALTER TABLE cliente_feedbacks
ADD CONSTRAINT cliente_feedbacks_prospecto_place_id_fkey 
FOREIGN KEY (prospecto_place_id) 
REFERENCES prospectos(place_id) 
ON DELETE CASCADE;

-- Agregar constraint para asegurar que tenga o client_id o prospecto_place_id (pero no ambos)
ALTER TABLE cliente_feedbacks
ADD CONSTRAINT cliente_feedbacks_check_client_or_prospecto 
CHECK (
  (client_id IS NOT NULL AND prospecto_place_id IS NULL) OR
  (client_id IS NULL AND prospecto_place_id IS NOT NULL)
);

-- Crear índice para búsquedas eficientes
CREATE INDEX idx_cliente_feedbacks_prospecto_place_id ON cliente_feedbacks(prospecto_place_id);

-- Comentario para documentar
COMMENT ON COLUMN cliente_feedbacks.prospecto_place_id IS 'Place ID del prospecto si el feedback es para un prospecto';
COMMENT ON COLUMN cliente_feedbacks.client_id IS 'Client ID si el feedback es para un cliente existente';