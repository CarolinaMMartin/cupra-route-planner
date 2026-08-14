ALTER TABLE public.cliente_feedbacks ADD COLUMN IF NOT EXISTS estado_cliente text;
ALTER TABLE public.prospectos ADD COLUMN IF NOT EXISTS resumen_google text;

CREATE TABLE IF NOT EXISTS public.recordatorios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id uuid NOT NULL,
  client_id text,
  prospecto_place_id text,
  titulo text NOT NULL,
  nota text,
  fecha_recordatorio timestamptz NOT NULL,
  notificado boolean NOT NULL DEFAULT false,
  completado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recordatorios TO authenticated;
GRANT ALL ON public.recordatorios TO service_role;

ALTER TABLE public.recordatorios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendedores gestionan sus recordatorios" ON public.recordatorios;
CREATE POLICY "Vendedores gestionan sus recordatorios"
ON public.recordatorios FOR ALL TO authenticated
USING (vendedor_id = auth.uid() OR public.is_active_assignor(auth.uid()))
WITH CHECK (vendedor_id = auth.uid() OR public.is_active_assignor(auth.uid()));

CREATE INDEX IF NOT EXISTS recordatorios_pendientes_idx
ON public.recordatorios (vendedor_id, notificado, fecha_recordatorio);

DROP TRIGGER IF EXISTS recordatorios_set_updated_at ON public.recordatorios;
CREATE TRIGGER recordatorios_set_updated_at
BEFORE UPDATE ON public.recordatorios
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();