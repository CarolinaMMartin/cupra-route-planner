-- PASO 1: Sincronizar barrio_principal desde client_places primario
UPDATE clientes c
SET 
  barrio_principal = cp.barrio_principal,
  direccion_principal = COALESCE(c.direccion_principal, cp.direccion_principal),
  provincia_principal = COALESCE(c.provincia_principal, cp.provincia_principal)
FROM client_places cp
WHERE c.client_id = cp.client_id
  AND cp.is_primary = true
  AND c.barrio_principal IS NULL
  AND cp.barrio_principal IS NOT NULL;

-- PASO 2: Poblar todos_barrios desde todos los client_places
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
  AND subq.barrios_array IS NOT NULL
  AND (c.todos_barrios IS NULL OR c.todos_barrios = '{}');