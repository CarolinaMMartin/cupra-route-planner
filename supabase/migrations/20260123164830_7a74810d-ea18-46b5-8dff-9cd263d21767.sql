-- Fase 1: Normalización Geográfica Completa

-- 1.1 Normalizar provincias en client_places (fuente de verdad)
UPDATE client_places
SET provincia_principal = 'Provincia de Buenos Aires'
WHERE provincia_principal IN ('Buenos Aires', 'Buenos Aires Province');

-- 1.2 Sincronizar clientes desde client_places primario (SIEMPRE, sin condición NULL)
UPDATE clientes c
SET 
  provincia_principal = cp.provincia_principal,
  barrio_principal = cp.barrio_principal,
  direccion_principal = cp.direccion_principal
FROM client_places cp
WHERE c.client_id = cp.client_id
  AND cp.is_primary = true;

-- 1.3 Recalcular todos_barrios como array de todos los barrios del cliente
UPDATE clientes c
SET todos_barrios = subq.barrios_array
FROM (
  SELECT client_id, 
         ARRAY_AGG(DISTINCT barrio_principal) FILTER (WHERE barrio_principal IS NOT NULL) as barrios_array
  FROM client_places 
  GROUP BY client_id
) subq
WHERE c.client_id = subq.client_id;