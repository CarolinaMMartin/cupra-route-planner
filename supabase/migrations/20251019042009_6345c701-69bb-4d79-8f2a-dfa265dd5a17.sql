-- Add new columns to clientes table
ALTER TABLE public.clientes
ADD COLUMN IF NOT EXISTS todos_barrios text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS todas_direcciones text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS todos_vendedores text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS requiere_visita text,
ADD COLUMN IF NOT EXISTS canal text,
ADD COLUMN IF NOT EXISTS etiquetas text[] DEFAULT '{}';