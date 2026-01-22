-- Agregar constraint UNIQUE a places para prevenir duplicados
-- Esto permite usar upserts idempotentes con ON CONFLICT
ALTER TABLE places 
ADD CONSTRAINT places_barrio_provincia_unique 
UNIQUE (barrio_principal, provincia_principal);