ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS tipo_comprobante text NOT NULL DEFAULT 'venta';

UPDATE public.ventas_cupra SET tipo_comprobante = 'nota_credito' WHERE facturacion_ars < 0;

ALTER TABLE public.ventas_cupra ADD CONSTRAINT ventas_cupra_tipo_comprobante_check CHECK (tipo_comprobante IN ('venta','nota_credito'));

CREATE INDEX IF NOT EXISTS idx_ventas_cupra_tipo_comprobante ON public.ventas_cupra (tipo_comprobante);