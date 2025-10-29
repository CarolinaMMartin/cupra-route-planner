-- Agregar campo de comentarios a la tabla areas para que los asignadores puedan dejar notas
ALTER TABLE public.areas 
ADD COLUMN comentarios TEXT;