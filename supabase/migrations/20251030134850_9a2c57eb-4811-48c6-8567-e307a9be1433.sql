-- Agregar columna google_maps_link a recomendaciones_ia
ALTER TABLE public.recomendaciones_ia 
ADD COLUMN IF NOT EXISTS google_maps_link TEXT;