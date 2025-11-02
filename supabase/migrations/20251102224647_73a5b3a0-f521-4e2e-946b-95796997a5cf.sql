-- Eliminar foreign key constraint en client_places
ALTER TABLE public.client_places 
DROP CONSTRAINT IF EXISTS client_places_client_id_fkey;