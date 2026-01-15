-- Agregar campo para justificación de exclusión
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS motivo_exclusion TEXT;