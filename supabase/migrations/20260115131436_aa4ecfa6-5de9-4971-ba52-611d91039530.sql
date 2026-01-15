-- Agregar columnas email e instagram a la tabla prospectos
ALTER TABLE prospectos 
ADD COLUMN IF NOT EXISTS email text DEFAULT NULL;

ALTER TABLE prospectos 
ADD COLUMN IF NOT EXISTS instagram text DEFAULT NULL;