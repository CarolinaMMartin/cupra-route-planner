ALTER TABLE public.ventas_cupra DROP CONSTRAINT IF EXISTS ventas_cupra_tipo_comprobante_check;
ALTER TABLE public.ventas_cupra ADD CONSTRAINT ventas_cupra_tipo_comprobante_check
  CHECK (tipo_comprobante = ANY (ARRAY['venta'::text, 'nota_credito'::text, 'nota_credito_concepto'::text]));