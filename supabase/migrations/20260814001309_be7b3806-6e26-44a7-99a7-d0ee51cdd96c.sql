ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS monto_total_cupra numeric,
  ADD COLUMN IF NOT EXISTS share_cupra numeric,
  ADD COLUMN IF NOT EXISTS fuente_monto text NOT NULL DEFAULT 'producto';

COMMENT ON COLUMN public.clientes.monto_total_cupra IS 'Facturación atribuible a CUPRA (hoja Ventas por Producto).';
COMMENT ON COLUMN public.clientes.share_cupra IS 'Porcentaje 0-100 de CUPRA sobre la facturación total del cliente.';
COMMENT ON COLUMN public.clientes.fuente_monto IS 'Origen de monto_total_historico: comprobante (universo completo) o producto (solo CUPRA).';

UPDATE public.clientes
SET monto_total_cupra = monto_total_historico,
    share_cupra = 100,
    fuente_monto = 'producto'
WHERE monto_total_cupra IS NULL;