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
  vendedores?: string[];
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