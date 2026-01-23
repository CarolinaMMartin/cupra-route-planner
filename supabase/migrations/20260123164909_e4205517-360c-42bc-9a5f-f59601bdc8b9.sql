-- Normalizar provincias de clientes que NO tienen client_places primario
UPDATE clientes
SET provincia_principal = 'Provincia de Buenos Aires'
WHERE provincia_principal IN ('BUENOS AIRES', 'Buenos Aires', 'Buenos Aires Province')
AND NOT EXISTS (
  SELECT 1 FROM client_places cp 
  WHERE cp.client_id = clientes.client_id AND cp.is_primary = true
);

UPDATE clientes
SET provincia_principal = 'Ciudad Autónoma de Buenos Aires'
WHERE provincia_principal = 'CABA'
AND NOT EXISTS (
  SELECT 1 FROM client_places cp 
  WHERE cp.client_id = clientes.client_id AND cp.is_primary = true
);