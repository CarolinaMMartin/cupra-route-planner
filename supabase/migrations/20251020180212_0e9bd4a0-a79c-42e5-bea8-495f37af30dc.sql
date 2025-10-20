-- Permitir valores NULL en campos de recomendaciones_ia
ALTER TABLE public.recomendaciones_ia 
  ALTER COLUMN razon_social DROP NOT NULL,
  ALTER COLUMN justificacion DROP NOT NULL;