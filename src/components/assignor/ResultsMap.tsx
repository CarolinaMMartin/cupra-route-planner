import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Sucursal } from '@/types/sales';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface ResultsMapProps {
  sucursales: Sucursal[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

const ResultsMap = ({ sucursales }: ResultsMapProps) => {
  return (
    <div className="h-[600px] w-full rounded-lg overflow-hidden shadow-medium bg-card">
      <p className="p-4 text-foreground text-center">Vista de mapa disponible próximamente</p>
    </div>
  );
};

export default ResultsMap;