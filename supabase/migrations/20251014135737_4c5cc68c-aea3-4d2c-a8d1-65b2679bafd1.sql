-- Eliminar la columna cliente_id duplicada
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS cliente_id;

-- Cambiar el tipo de fecha_emision a DATE
ALTER TABLE public.ventas_cupra ALTER COLUMN fecha_emision TYPE DATE USING fecha_emision::DATE;