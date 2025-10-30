-- Crear foreign key entre client_places y clientes
-- Esto permitirá que Supabase haga JOINs correctamente

ALTER TABLE public.client_places
ADD CONSTRAINT client_places_client_id_fkey 
FOREIGN KEY (client_id) 
REFERENCES public.clientes(client_id)
ON DELETE CASCADE;