ALTER TABLE public.client_places
  ADD COLUMN IF NOT EXISTS direccion_verificada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fuente_geocoding text;

COMMENT ON COLUMN public.client_places.direccion_verificada IS 'true = dirección corregida manualmente por un usuario; las importaciones de Excel no deben pisarla';
COMMENT ON COLUMN public.client_places.fuente_geocoding IS 'excel | geocoding_auto | correccion_manual';