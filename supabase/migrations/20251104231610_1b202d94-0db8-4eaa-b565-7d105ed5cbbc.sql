-- Modificar la tabla asignaciones_vendedores_clientes para soportar prospectos
-- Primero hacer el client_id nullable
ALTER TABLE public.asignaciones_vendedores_clientes 
  ALTER COLUMN client_id DROP NOT NULL;

-- Agregar columnas para prospectos
ALTER TABLE public.asignaciones_vendedores_clientes 
  ADD COLUMN prospecto_place_id TEXT,
  ADD COLUMN es_prospecto BOOLEAN DEFAULT FALSE NOT NULL;

-- Agregar constraint para asegurar que tenga o client_id o prospecto_place_id
ALTER TABLE public.asignaciones_vendedores_clientes 
  ADD CONSTRAINT check_client_or_prospecto 
  CHECK (
    (client_id IS NOT NULL AND prospecto_place_id IS NULL AND es_prospecto = FALSE) OR
    (client_id IS NULL AND prospecto_place_id IS NOT NULL AND es_prospecto = TRUE)
  );

-- Agregar foreign key para prospectos
ALTER TABLE public.asignaciones_vendedores_clientes 
  ADD CONSTRAINT fk_prospecto 
  FOREIGN KEY (prospecto_place_id) 
  REFERENCES public.prospectos(place_id) 
  ON DELETE CASCADE;

-- Crear índice para mejorar las consultas de prospectos
CREATE INDEX idx_asignaciones_prospecto_place_id 
  ON public.asignaciones_vendedores_clientes(prospecto_place_id) 
  WHERE prospecto_place_id IS NOT NULL;