-- Allow asignadores to update client contact/commercial data
CREATE POLICY "Asignadores pueden editar contacto de clientes"
ON clientes
FOR UPDATE
TO authenticated
USING (get_user_role(auth.uid()) = 'asignador')
WITH CHECK (get_user_role(auth.uid()) = 'asignador');