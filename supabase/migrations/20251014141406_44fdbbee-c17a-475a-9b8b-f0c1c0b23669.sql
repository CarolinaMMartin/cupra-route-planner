-- Eliminar la tabla ventas_cupra existente
DROP TABLE IF EXISTS public.ventas_cupra CASCADE;

-- Recrear la tabla ventas_cupra con la estructura del Excel
CREATE TABLE public.ventas_cupra (
  id bigserial PRIMARY KEY,
  client_id text,
  ticket text,
  letra text,
  fecha_emision date,
  cuit_dni text,
  razon_social text,
  fantasia text,
  cajas integer,
  codigo_producto text,
  nombre text,
  marca text,
  facturacion_ars numeric,
  vendedor text,
  telefono text,
  celular text,
  correo text,
  direccion text,
  ciudad text,
  provincia text,
  pais text,
  categorias text,
  created_at timestamp with time zone DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.ventas_cupra ENABLE ROW LEVEL SECURITY;

-- Política para que usuarios autenticados puedan ver los datos
CREATE POLICY "Authenticated users can view ventas_cupra" 
ON public.ventas_cupra 
FOR SELECT 
USING (auth.role() = 'authenticated');