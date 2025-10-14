-- Vaciar las tablas ventas_cupra y clientes
TRUNCATE TABLE public.ventas_cupra CASCADE;
TRUNCATE TABLE public.clientes CASCADE;

-- Agregar columna client_id a la tabla sucursales (si no existe)
ALTER TABLE public.sucursales 
ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Agregar índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_sucursales_client_id ON public.sucursales(client_id);

-- Agregar columna client_id a la tabla cliente_feedbacks (si no existe)
ALTER TABLE public.cliente_feedbacks 
ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Agregar índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_cliente_feedbacks_client_id ON public.cliente_feedbacks(client_id);

-- Agregar columna client_id a la tabla recomendaciones_ia (si no existe)
ALTER TABLE public.recomendaciones_ia 
ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Agregar índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_recomendaciones_ia_client_id ON public.recomendaciones_ia(client_id);

-- Agregar columna client_id a la tabla ventas_cupra para las nuevas relaciones
ALTER TABLE public.ventas_cupra 
ADD COLUMN IF NOT EXISTS client_id TEXT;

-- Agregar índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_client_id ON public.ventas_cupra(client_id);

-- Agregar columna client_id a la tabla clientes
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS client_id TEXT UNIQUE;

-- Agregar índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_clientes_client_id ON public.clientes(client_id);