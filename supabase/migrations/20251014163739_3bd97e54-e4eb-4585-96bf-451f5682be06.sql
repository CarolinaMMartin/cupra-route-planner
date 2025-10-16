-- Modificar tabla clientes para permitir NULL en todas las columnas excepto client_id e id
ALTER TABLE public.clientes ALTER COLUMN razon_social DROP NOT NULL;
ALTER TABLE public.clientes ALTER COLUMN cuit_dni DROP NOT NULL;

-- Asegurar que client_id NO permita NULL
ALTER TABLE public.clientes ALTER COLUMN client_id SET NOT NULL;