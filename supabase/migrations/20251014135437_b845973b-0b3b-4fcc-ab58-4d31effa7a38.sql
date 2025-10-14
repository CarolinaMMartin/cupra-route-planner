-- Eliminar todas las columnas que no están en el Excel
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS operador;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS envio_observacion;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS condicion_pago;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS recibo;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS medio_pago_tienda;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS cupon_descuento;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS proveedor;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS codigo_proveedor;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS categorias_proveedor;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS categorias_productos;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS categorias_cliente;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS sucursal;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS origen;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS numero_externo;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS codigo_variante;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS codigo_oem;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS etiqueta;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS variante;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS financiacion;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS financiacion_aplicacion;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS forma_envio;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS envio;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS calle;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS numero;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS entrecalles;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS piso;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS departamento;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS codigo_postal;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS iva;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS impuesto_interno;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS kilogramos;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS ancho;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS alto;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS largo;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS cantidad;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS bonificacion;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS costo_unit_neto;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS costo_unit_bruto;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS precio_unit_neto;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS precio_total_neto;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS costo_financiero_unit_bruto;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS precio_unit_final;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS precio_total_final;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS envio_gratis_me;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS latitud;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS longitud;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS cliente_id;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS created_at;

-- Agregar las columnas faltantes del Excel
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS cajas INTEGER;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS nombre TEXT;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS facturacion_ars NUMERIC;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS celular TEXT;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS correo TEXT;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS categorias TEXT;

-- Renombrar columnas que no coinciden con el Excel
ALTER TABLE public.ventas_cupra RENAME COLUMN pais TO pais_temp;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS pais TEXT;
UPDATE public.ventas_cupra SET pais = pais_temp WHERE pais_temp IS NOT NULL;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS pais_temp;

ALTER TABLE public.ventas_cupra RENAME COLUMN fantasia TO fantasia_temp;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS fantasia TEXT;
UPDATE public.ventas_cupra SET fantasia = fantasia_temp WHERE fantasia_temp IS NOT NULL;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS fantasia_temp;

ALTER TABLE public.ventas_cupra RENAME COLUMN marca TO marca_temp;
ALTER TABLE public.ventas_cupra ADD COLUMN IF NOT EXISTS marca TEXT;
UPDATE public.ventas_cupra SET marca = marca_temp WHERE marca_temp IS NOT NULL;
ALTER TABLE public.ventas_cupra DROP COLUMN IF EXISTS marca_temp;

-- Crear índices útiles
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_client_id ON public.ventas_cupra(client_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_fecha_emision ON public.ventas_cupra(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_ventas_cupra_cuit_dni ON public.ventas_cupra(cuit_dni);