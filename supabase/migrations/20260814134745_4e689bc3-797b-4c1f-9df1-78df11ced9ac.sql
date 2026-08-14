CREATE TABLE public.visita_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id text,
  prospecto_place_id text,
  briefing text NOT NULL,
  hechos jsonb NOT NULL DEFAULT '{}'::jsonb,
  modelo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX visita_briefings_client_uidx ON public.visita_briefings (client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX visita_briefings_prospecto_uidx ON public.visita_briefings (prospecto_place_id) WHERE prospecto_place_id IS NOT NULL;

GRANT SELECT ON public.visita_briefings TO authenticated;
GRANT ALL ON public.visita_briefings TO service_role;

ALTER TABLE public.visita_briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios activos pueden ver briefings"
ON public.visita_briefings FOR SELECT TO authenticated
USING (public.is_active_user(auth.uid()));

CREATE TRIGGER visita_briefings_set_updated_at
BEFORE UPDATE ON public.visita_briefings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();