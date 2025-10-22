-- Eliminar restricción UNIQUE para permitir que un place esté en múltiples áreas
ALTER TABLE public.areas_places DROP CONSTRAINT IF EXISTS areas_places_area_id_place_id_key;