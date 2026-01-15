-- Tabla de notificaciones para vendedores
CREATE TABLE public.notificaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendedor_id UUID NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  leida BOOLEAN DEFAULT false,
  asignacion_id UUID REFERENCES public.asignaciones_vendedores_clientes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.notificaciones ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Vendedores ven sus notificaciones"
  ON public.notificaciones FOR SELECT
  USING (vendedor_id = auth.uid());

CREATE POLICY "Vendedores pueden marcar como leidas"
  ON public.notificaciones FOR UPDATE
  USING (vendedor_id = auth.uid())
  WITH CHECK (vendedor_id = auth.uid());

CREATE POLICY "Service role acceso completo notificaciones"
  ON public.notificaciones FOR ALL
  USING (true)
  WITH CHECK (true);

-- Índices para performance
CREATE INDEX idx_notificaciones_vendedor_id ON public.notificaciones(vendedor_id);
CREATE INDEX idx_notificaciones_asignacion_id ON public.notificaciones(asignacion_id);
CREATE INDEX idx_notificaciones_leida ON public.notificaciones(leida);

-- Habilitar realtime para notificaciones
ALTER PUBLICATION supabase_realtime ADD TABLE public.notificaciones;