-- Eliminar constraint único de cuit_dni en tabla clientes
ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_cuit_dni_key;

-- Asegurar que client_id tenga constraint único
ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_client_id_key;
ALTER TABLE public.clientes ADD CONSTRAINT clientes_client_id_key UNIQUE (client_id);