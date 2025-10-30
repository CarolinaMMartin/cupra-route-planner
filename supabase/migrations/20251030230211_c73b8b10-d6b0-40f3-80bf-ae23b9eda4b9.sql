-- Agregar campo visita_realizada a cliente_feedbacks
ALTER TABLE cliente_feedbacks
ADD COLUMN visita_realizada boolean NOT NULL DEFAULT false;

-- Agregar campo ultima_visita a clientes para tracking de recomendaciones
ALTER TABLE clientes
ADD COLUMN ultima_visita timestamp with time zone;

-- Crear índice para optimizar queries de recomendaciones
CREATE INDEX idx_clientes_ultima_visita ON clientes(ultima_visita);