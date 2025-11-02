-- Agregar constraint única para permitir upsert en client_places
ALTER TABLE public.client_places 
ADD CONSTRAINT client_places_client_id_lat_long_key 
UNIQUE (client_id, lat, long);