-- Fase A: Backfill correctivo - client_places es la fuente de verdad

-- A1) Actualizar barrio_principal/direccion_principal/provincia_principal 
-- desde client_places primario SIEMPRE que difiera (no solo cuando es NULL)
UPDATE clientes c
SET 
  barrio_principal = cp.barrio_principal,
  direccion_principal = cp.direccion_principal,
  provincia_principal = cp.provincia_principal
FROM client_places cp
WHERE c.client_id = cp.client_id
  AND cp.is_primary = true
  AND cp.barrio_principal IS NOT NULL
  AND (
    c.barrio_principal IS NULL 
    OR lower(trim(c.barrio_principal)) != lower(trim(cp.barrio_principal))
  );

-- A2) Recomputar todos_barrios desde TODOS los client_places
-- para TODOS los clientes con places (no solo arrays vacíos)
UPDATE clientes c
SET todos_barrios = subq.barrios_array
FROM (
  SELECT 
    client_id,
    ARRAY_AGG(DISTINCT barrio_principal) FILTER (WHERE barrio_principal IS NOT NULL) as barrios_array
  FROM client_places
  GROUP BY client_id
) subq
WHERE c.client_id = subq.client_id
  AND subq.barrios_array IS NOT NULL;