
ALTER TABLE public.client_places
  ADD COLUMN IF NOT EXISTS precision_geocoding text,
  ADD COLUMN IF NOT EXISTS ubicacion_confiable boolean NOT NULL DEFAULT false;

UPDATE public.client_places
SET precision_geocoding = CASE
      WHEN direccion_verificada IS TRUE OR fuente_geocoding = 'correccion_manual' THEN 'manual'
      WHEN fuente_geocoding IN ('excel','erp') THEN 'erp'
      ELSE 'desconocida'
    END,
    ubicacion_confiable = (direccion_verificada IS TRUE
      OR fuente_geocoding IN ('correccion_manual','excel','erp'));

-- Ubicaciones falsas: 3+ clientes distintos en la misma coordenada exacta
WITH centroides AS (
  SELECT lat, long
  FROM public.client_places
  GROUP BY lat, long
  HAVING count(DISTINCT client_id) >= 3
), afectados AS (
  SELECT cp.id, cp.client_id
  FROM public.client_places cp
  JOIN centroides c ON c.lat = cp.lat AND c.long = cp.long
  WHERE cp.fuente_geocoding NOT IN ('correccion_manual')
    AND cp.direccion_verificada IS NOT TRUE
)
, limpieza AS (
  UPDATE public.clientes cl
  SET barrio_principal = NULL, updated_at = now()
  WHERE cl.client_id IN (SELECT client_id FROM afectados)
  RETURNING 1
)
DELETE FROM public.client_places p
WHERE p.id IN (SELECT id FROM afectados);

UPDATE public.client_places
SET barrio_principal = NULL, ubicacion_confiable = false
WHERE lower(public.unaccent(coalesce(barrio_principal,''))) IN
  ('buenos aires','ciudad autonoma de buenos aires','capital federal','caba','argentina');

UPDATE public.clientes
SET barrio_principal = NULL
WHERE lower(public.unaccent(coalesce(barrio_principal,''))) IN
  ('buenos aires','ciudad autonoma de buenos aires','capital federal','caba','argentina');

CREATE INDEX IF NOT EXISTS idx_client_places_confiable
  ON public.client_places (client_id) WHERE ubicacion_confiable;
