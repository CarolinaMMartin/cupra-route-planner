-- Add new feedback fields to cliente_feedbacks table
ALTER TABLE cliente_feedbacks
ADD COLUMN motivo_no_visita TEXT,
ADD COLUMN tipo_interaccion TEXT,
ADD COLUMN actualizar_etiqueta_wa TEXT;