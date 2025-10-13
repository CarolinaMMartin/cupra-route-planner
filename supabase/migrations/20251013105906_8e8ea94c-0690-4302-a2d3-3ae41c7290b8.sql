-- Agregar foreign key para vendedor_id (la de cliente ya existe)
ALTER TABLE public.asignaciones_vendedores_clientes
ADD CONSTRAINT asignaciones_vendedores_clientes_vendedor_id_fkey 
FOREIGN KEY (vendedor_id) 
REFERENCES public.profiles(user_id) 
ON DELETE CASCADE;