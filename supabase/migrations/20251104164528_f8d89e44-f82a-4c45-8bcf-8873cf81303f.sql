-- Crear tabla de prospectos
CREATE TABLE IF NOT EXISTS public.prospectos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id TEXT NOT NULL UNIQUE,
  client_id TEXT,
  nombre TEXT NOT NULL,
  telefono TEXT,
  direccion TEXT NOT NULL,
  barrio TEXT,
  comuna TEXT,
  ciudad TEXT NOT NULL,
  provincia TEXT NOT NULL,
  latitud NUMERIC NOT NULL,
  longitud NUMERIC NOT NULL,
  rating NUMERIC DEFAULT 0,
  total_ratings INTEGER DEFAULT 0,
  nivel_precio TEXT,
  tipo_principal TEXT,
  tipos TEXT[] DEFAULT '{}',
  sirve_vinos BOOLEAN DEFAULT false,
  website TEXT,
  estado_negocio TEXT,
  es_cliente_cupra BOOLEAN DEFAULT false,
  last_recommendation_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Crear índices para optimizar búsquedas
CREATE INDEX idx_prospectos_barrio ON public.prospectos(barrio);
CREATE INDEX idx_prospectos_place_id ON public.prospectos(place_id);
CREATE INDEX idx_prospectos_es_cliente ON public.prospectos(es_cliente_cupra);
CREATE INDEX idx_prospectos_last_recommendation ON public.prospectos(last_recommendation_at);
CREATE INDEX idx_prospectos_telefono ON public.prospectos(telefono);

-- Habilitar RLS
ALTER TABLE public.prospectos ENABLE ROW LEVEL SECURITY;

-- Policies para prospectos
CREATE POLICY "Usuarios autenticados pueden ver prospectos"
  ON public.prospectos FOR SELECT
  USING (true);

CREATE POLICY "Service role acceso completo prospectos"
  ON public.prospectos FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger para updated_at
CREATE TRIGGER update_prospectos_updated_at
  BEFORE UPDATE ON public.prospectos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Modificar tabla recomendaciones_ia para soportar prospectos
ALTER TABLE public.recomendaciones_ia 
  ADD COLUMN IF NOT EXISTS es_prospecto BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS prospecto_place_id TEXT;

-- Crear índice para búsquedas de prospectos en recomendaciones
CREATE INDEX idx_recomendaciones_es_prospecto ON public.recomendaciones_ia(es_prospecto);
CREATE INDEX idx_recomendaciones_prospecto_place_id ON public.recomendaciones_ia(prospecto_place_id);

-- Comentarios para documentación
COMMENT ON TABLE public.prospectos IS 'Tabla de nuevos prospectos obtenidos de Google Places';
COMMENT ON COLUMN public.prospectos.place_id IS 'ID único de Google Places';
COMMENT ON COLUMN public.prospectos.client_id IS 'ID del cliente en Cupra cuando se convierta en cliente';
COMMENT ON COLUMN public.prospectos.es_cliente_cupra IS 'Indica si el prospecto ya es cliente de Cupra';
COMMENT ON COLUMN public.prospectos.last_recommendation_at IS 'Última vez que fue recomendado a un vendedor';