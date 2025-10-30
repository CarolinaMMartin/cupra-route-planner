export interface Sucursal {
  id: string;
  nombre: string;
  direccion: string;
  zona: string;
  tipo_cliente: string;
  score: number;
  dias_sin_visita: number;
  latitud?: number;
  longitud?: number;
  justificacion?: string;
  cuit_dni?: string;
  client_id?: string;
  vendedores?: string[];
  // Datos completos de clientes
  fantasia?: string;
  primera_compra?: string;
  ultima_compra?: string;
  dias_desde_ultima_compra?: number;
  cantidad_ordenes?: number;
  monto_total_historico?: number;
  ticket_promedio?: number;
  categoria_recencia?: string;
  categoria_volumen?: string;
  score_recencia?: number;
  score_volumen?: number;
  score_comercial?: number;
  participacion_mercado?: number;
  ciudad_principa?: string;
  barrio_principal?: string;
  direccion_principal?: string;
  provincia_principal?: string;
  vendedor_principal?: string;
  productos_comprados?: string[];
  todas_ciudades?: string[];
  todos_barrios?: string[];
  todas_direcciones?: string[];
  todos_vendedores?: string[];
  requiere_visita?: string;
  canal?: string;
  etiquetas?: string[];
  // Campos de IA
  ai_reasoning?: string;
  score_geografico?: number;
  factores_ia?: {
    score_comercial: number;
    proximidad_geografica: number;
    dias_sin_visita: number;
    potencial_venta: number;
  };
  telefonos?: string[];
}

export interface Vendedor {
  id: string;
  nombre: string;
  zona: string;
  email: string;
  activo: boolean;
}

export interface Visita {
  id: string;
  vendedor_id: string;
  sucursal_id: string;
  fecha: string;
  estado: 'pendiente' | 'en_curso' | 'completada';
  notas?: string;
  hora_checkin?: string;
  hora_checkout?: string;
  geolocalizacion?: any;
}
