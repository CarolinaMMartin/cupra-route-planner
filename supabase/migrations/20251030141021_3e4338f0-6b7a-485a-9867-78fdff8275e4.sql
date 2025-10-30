-- Permitir valores NULL en direccion_principal de client_places
ALTER TABLE public.client_places 
ALTER COLUMN direccion_principal DROP NOT NULL;