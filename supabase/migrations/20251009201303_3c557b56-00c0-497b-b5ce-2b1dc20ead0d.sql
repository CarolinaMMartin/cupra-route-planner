-- Crear tabla cliente_feedbacks para almacenar feedback de vendedores
CREATE TABLE public.cliente_feedbacks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id UUID NOT NULL,
  vendedor_id UUID NOT NULL,
  feedback TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Índice para búsquedas rápidas por cliente
CREATE INDEX idx_cliente_feedbacks_cliente_id ON public.cliente_feedbacks(cliente_id);

-- Índice para búsquedas rápidas por vendedor
CREATE INDEX idx_cliente_feedbacks_vendedor_id ON public.cliente_feedbacks(vendedor_id);

-- Habilitar RLS (sin políticas por ahora)
ALTER TABLE public.cliente_feedbacks ENABLE ROW LEVEL SECURITY;