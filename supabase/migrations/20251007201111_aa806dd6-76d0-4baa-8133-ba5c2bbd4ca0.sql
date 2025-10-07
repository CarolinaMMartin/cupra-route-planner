-- Create clientes table
CREATE TABLE IF NOT EXISTS public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuit_dni TEXT UNIQUE NOT NULL,
  razon_social TEXT NOT NULL,
  last_recommendation_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS for clientes
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users to view clientes
CREATE POLICY "Authenticated users can view clientes"
ON public.clientes
FOR SELECT
TO authenticated
USING (auth.role() = 'authenticated');

-- Modify sucursales table: remove id_cliente and add cuit_dni_cliente
ALTER TABLE public.sucursales 
DROP COLUMN IF EXISTS id_cliente,
ADD COLUMN IF NOT EXISTS cuit_dni_cliente TEXT REFERENCES public.clientes(cuit_dni);

-- Create trigger for clientes updated_at
CREATE TRIGGER update_clientes_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();