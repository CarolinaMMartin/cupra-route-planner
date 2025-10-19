-- Add missing columns to recomendaciones_ia table
ALTER TABLE public.recomendaciones_ia
  ADD COLUMN IF NOT EXISTS ciudad_principa text,
  ADD COLUMN IF NOT EXISTS barrio_principal text,
  ADD COLUMN IF NOT EXISTS direccion_principal text,
  ADD COLUMN IF NOT EXISTS provincia_principal text,
  ADD COLUMN IF NOT EXISTS vendedor_principal text,
  ADD COLUMN IF NOT EXISTS productos_comprados text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS todas_ciudades text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS todos_barrios text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS todas_direcciones text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS todos_vendedores text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS requiere_visita text,
  ADD COLUMN IF NOT EXISTS canal text,
  ADD COLUMN IF NOT EXISTS last_recomendation timestamp with time zone;