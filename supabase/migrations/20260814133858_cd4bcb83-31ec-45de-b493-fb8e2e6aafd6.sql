CREATE TABLE public.feedback_extraccion (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  feedback_id uuid NOT NULL UNIQUE REFERENCES public.cliente_feedbacks(id) ON DELETE CASCADE,
  client_id text,
  prospecto_place_id text,
  vendedor_id uuid,
  revisit_date date,
  revisit_dias integer,
  objecion text,
  interes_producto text[] NOT NULL DEFAULT '{}',
  riesgo_cobranza text NOT NULL DEFAULT 'ninguno',
  contacto_nombre text,
  contacto_rol text,
  sentimiento text,
  resumen text,
  no_ofrecer boolean NOT NULL DEFAULT false,
  confianza numeric NOT NULL DEFAULT 0,
  modelo text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_extraccion_client ON public.feedback_extraccion(client_id);
CREATE INDEX idx_feedback_extraccion_prospecto ON public.feedback_extraccion(prospecto_place_id);

GRANT SELECT ON public.feedback_extraccion TO authenticated;
GRANT ALL ON public.feedback_extraccion TO service_role;

ALTER TABLE public.feedback_extraccion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios activos ven las extracciones"
ON public.feedback_extraccion FOR SELECT TO authenticated
USING (public.is_active_user(auth.uid()));

CREATE TRIGGER feedback_extraccion_set_updated_at
BEFORE UPDATE ON public.feedback_extraccion
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();