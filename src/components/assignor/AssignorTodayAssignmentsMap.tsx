import { useMemo } from "react";
import StoredAssignmentsMap from "@/components/shared/StoredAssignmentsMap";

interface Assignment {
  id: string;
  es_prospecto: boolean;
  client_id?: string;
  prospecto_place_id?: string;
  vendedor: {
    nombre: string;
    email: string;
  };
  cliente?: {
    razon_social: string;
    cuit_dni: string;
    rubro?: string | null;
  };
  prospecto?: {
    nombre: string;
    rubro?: string | null;
    telefono: string;
    direccion: string;
    barrio: string;
    latitud?: number;
    longitud?: number;
  };
  created_at: string;
}

interface AssignorTodayAssignmentsMapProps {
  assignments: Assignment[];
  vendedorFilter?: string;
}

export default function AssignorTodayAssignmentsMap({ assignments, vendedorFilter }: AssignorTodayAssignmentsMapProps) {
  const items = useMemo(() => assignments
    .filter(a => !vendedorFilter || a.vendedor.nombre === vendedorFilter)
    .map(a => ({
      id: a.id, clientId: a.client_id, prospect: a.es_prospecto,
      name: a.es_prospecto ? a.prospecto?.nombre || "Prospecto" : a.cliente?.razon_social || "Cliente",
      lat: a.prospecto?.latitud, lng: a.prospecto?.longitud,
      vendor: a.vendedor.nombre, address: a.prospecto?.direccion,
      rubro: a.es_prospecto ? a.prospecto?.rubro : a.cliente?.rubro,
      details: a.es_prospecto ? [a.prospecto?.barrio || "", a.prospecto?.telefono || ""] : [],
    })), [assignments, vendedorFilter]);
  return <StoredAssignmentsMap items={items} />;
}
