-- Modificar estructura de recomendaciones_ia

-- Renombrar columna name a razon_social
ALTER TABLE public.recomendaciones_ia RENAME COLUMN name TO razon_social;

-- Eliminar columnas que ya no se necesitan
ALTER TABLE public.recomendaciones_ia 
  DROP COLUMN IF EXISTS contacto,
  DROP COLUMN IF EXISTS comuna,
  DROP COLUMN IF EXISTS barrio,
  DROP COLUMN IF EXISTS longitud,
  DROP COLUMN IF EXISTS subzona,
  DROP COLUMN IF EXISTS vendedor_asignado,
  DROP COLUMN IF EXISTS mapa,
  DROP COLUMN IF EXISTS provincia,
  DROP COLUMN IF EXISTS direccion,
  DROP COLUMN IF EXISTS latitud;

-- Agregar nuevas columnas
ALTER TABLE public.recomendaciones_ia
  ADD COLUMN cuit_dni TEXT,
  ADD COLUMN monto_total_vendido NUMERIC DEFAULT 0,
  ADD COLUMN orders_count INTEGER DEFAULT 0,
  ADD COLUMN avg_ticket NUMERIC DEFAULT 0,
  ADD COLUMN first_purchase_at DATE,
  ADD COLUMN last_purchase_at DATE,
  ADD COLUMN days_since_last_purchase INTEGER,
  ADD COLUMN participacion NUMERIC DEFAULT 0,
  ADD COLUMN score_volumen TEXT,
  ADD COLUMN score_recencia TEXT,
  ADD COLUMN score_comercial TEXT,
  ADD COLUMN score_volumen_num INTEGER,
  ADD COLUMN score_recencia_num INTEGER,
  ADD COLUMN priority_score INTEGER,
  ADD COLUMN etiquetas TEXT[],
  ADD COLUMN ciudades TEXT[],
  ADD COLUMN provincias TEXT[],
  ADD COLUMN telefonos TEXT[],
  ADD COLUMN vendedores TEXT[];

-- Desactivar todas las RLS policies para desarrollo
DROP POLICY IF EXISTS "Authenticated users can view recomendaciones_ia" ON public.recomendaciones_ia;
DROP POLICY IF EXISTS "Asignadores can insert recomendaciones_ia" ON public.recomendaciones_ia;
DROP POLICY IF EXISTS "Asignadores can update recomendaciones_ia" ON public.recomendaciones_ia;

-- Desactivar RLS en la tabla
ALTER TABLE public.recomendaciones_ia DISABLE ROW LEVEL SECURITY;