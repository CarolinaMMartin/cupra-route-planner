-- Agregar columnas para el sistema de recomendaciones con IA
ALTER TABLE recomendaciones_ia
ADD COLUMN IF NOT EXISTS ai_reasoning TEXT,
ADD COLUMN IF NOT EXISTS score_geografico NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS request_id UUID,
ADD COLUMN IF NOT EXISTS vendedor_recomendado_id UUID,
ADD COLUMN IF NOT EXISTS factores_ia JSONB;

-- Crear índices para optimizar queries
CREATE INDEX IF NOT EXISTS idx_recomendaciones_request_id ON recomendaciones_ia(request_id);
CREATE INDEX IF NOT EXISTS idx_recomendaciones_vendedor ON recomendaciones_ia(vendedor_recomendado_id);
CREATE INDEX IF NOT EXISTS idx_recomendaciones_created_at ON recomendaciones_ia(created_at DESC);

-- Función para limpiar recomendaciones antiguas (más de 7 días)
CREATE OR REPLACE FUNCTION clean_old_recommendations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM recomendaciones_ia
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;