
-- Enable unaccent extension for normalized name matching
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Function to get top barrios for a vendedor by historical revenue
CREATE OR REPLACE FUNCTION get_vendedor_barrios_top(vendedor_user_id uuid, top_n integer DEFAULT 3)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(barrio ORDER BY total_barrio DESC), '{}'::text[])
  FROM (
    SELECT 
      c.barrio_principal AS barrio,
      SUM(COALESCE(v.facturacion_ars, 0)) AS total_barrio
    FROM ventas_cupra v
    JOIN clientes c ON c.client_id = v.client_id
    JOIN profiles p ON UPPER(unaccent(p.nombre)) = UPPER(unaccent(v.vendedor))
    WHERE p.user_id = vendedor_user_id
      AND c.barrio_principal IS NOT NULL
    GROUP BY c.barrio_principal
    ORDER BY total_barrio DESC
    LIMIT top_n
  ) sub
$$;

-- View: Unified prioritized clients + prospects with commercial state classification
CREATE OR REPLACE VIEW v_clientes_priorizacion AS
WITH vendedor_afinidad AS (
  SELECT 
    v.client_id,
    v.vendedor AS vendedor_nombre,
    p.user_id AS vendedor_id,
    SUM(COALESCE(v.facturacion_ars, 0)) AS total_facturado,
    ROW_NUMBER() OVER (PARTITION BY v.client_id ORDER BY SUM(COALESCE(v.facturacion_ars, 0)) DESC) AS rn
  FROM ventas_cupra v
  LEFT JOIN profiles p ON UPPER(unaccent(p.nombre)) = UPPER(unaccent(v.vendedor))
  WHERE v.client_id IS NOT NULL AND v.vendedor IS NOT NULL
  GROUP BY v.client_id, v.vendedor, p.user_id
)
SELECT 
  c.client_id AS entity_id,
  c.razon_social,
  CASE 
    WHEN c.dias_desde_ultima_compra IS NULL THEN 'PERDIDO'
    WHEN c.dias_desde_ultima_compra <= 30 THEN 'ACTIVO'
    WHEN c.dias_desde_ultima_compra <= 90 THEN 'INACTIVO'
    ELSE 'PERDIDO'
  END AS estado_comercial,
  FALSE AS es_prospecto,
  va.vendedor_id AS vendedor_afin_id,
  va.vendedor_nombre AS vendedor_afin_nombre,
  cp.lat,
  cp.long,
  COALESCE(cp.barrio_principal, c.barrio_principal) AS barrio,
  c.direccion_principal AS direccion,
  c.dias_desde_ultima_compra,
  c.monto_total_historico,
  c.score_comercial,
  c.ticket_promedio,
  c.vendedor_actual,
  c.vendedor_principal,
  c.todos_vendedores,
  c.last_recommendation_at,
  c.excluir_recomendaciones,
  c.fantasia,
  c.cuit_dni,
  c.provincia_principal,
  cp.google_maps_link,
  NULL::text AS prospecto_place_id,
  NULL::text AS tipo_negocio,
  NULL::numeric AS rating
FROM clientes c
LEFT JOIN client_places cp ON cp.client_id = c.client_id AND cp.is_primary = true
LEFT JOIN vendedor_afinidad va ON va.client_id = c.client_id AND va.rn = 1

UNION ALL

SELECT 
  p.place_id AS entity_id,
  p.nombre AS razon_social,
  'POTENCIAL' AS estado_comercial,
  TRUE AS es_prospecto,
  NULL::uuid AS vendedor_afin_id,
  NULL::text AS vendedor_afin_nombre,
  p.latitud AS lat,
  p.longitud AS long,
  p.barrio,
  p.direccion,
  NULL::integer AS dias_desde_ultima_compra,
  NULL::numeric AS monto_total_historico,
  NULL::integer AS score_comercial,
  NULL::numeric AS ticket_promedio,
  NULL::text AS vendedor_actual,
  NULL::text AS vendedor_principal,
  NULL::text[] AS todos_vendedores,
  p.last_recommendation_at,
  FALSE AS excluir_recomendaciones,
  NULL::text AS fantasia,
  NULL::text AS cuit_dni,
  p.provincia AS provincia_principal,
  NULL::text AS google_maps_link,
  p.place_id AS prospecto_place_id,
  p.tipo_principal AS tipo_negocio,
  p.rating
FROM prospectos p;
