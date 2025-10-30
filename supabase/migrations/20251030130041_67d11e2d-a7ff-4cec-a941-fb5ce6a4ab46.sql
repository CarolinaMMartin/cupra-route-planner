-- Crear tabla client_places para almacenar ubicaciones geocodificadas
CREATE TABLE public.client_places (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  
  -- Datos normalizados desde n8n
  barrio_principal TEXT,
  direccion_principal TEXT NOT NULL,
  provincia_principal TEXT,
  comuna TEXT,
  
  -- Coordenadas
  lat NUMERIC(10, 7) NOT NULL,
  long NUMERIC(10, 7) NOT NULL,
  
  -- Link de Google Maps
  place_id TEXT,
  google_maps_link TEXT,
  
  -- Control
  is_primary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraint único para evitar duplicados
  UNIQUE(client_id, direccion_principal)
);

-- Índices para búsquedas rápidas
CREATE INDEX idx_client_places_client_id ON public.client_places(client_id);
CREATE INDEX idx_client_places_barrio ON public.client_places(barrio_principal);
CREATE INDEX idx_client_places_provincia ON public.client_places(provincia_principal);
CREATE INDEX idx_client_places_comuna ON public.client_places(comuna);
CREATE INDEX idx_client_places_is_primary ON public.client_places(is_primary);

-- Trigger para actualizar updated_at
CREATE TRIGGER update_client_places_updated_at
  BEFORE UPDATE ON public.client_places
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies
ALTER TABLE public.client_places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver client_places"
  ON public.client_places
  FOR SELECT
  USING (true);

CREATE POLICY "Service role acceso completo client_places"
  ON public.client_places
  FOR ALL
  USING (true)
  WITH CHECK (true);