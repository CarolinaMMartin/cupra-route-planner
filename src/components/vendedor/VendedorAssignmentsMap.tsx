import { useMemo, useState } from "react";
import { ClienteAsignado } from "./VendedorKanban";
import StoredAssignmentsMap from "@/components/shared/StoredAssignmentsMap";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export default function VendedorAssignmentsMap({ assignments }: { assignments: Record<string, ClienteAsignado[]> }) {
  const [showPending, setShowPending] = useState(true);
  const [showVisited, setShowVisited] = useState(true);
  const items = useMemo(() => [
    ...(showPending ? assignments["Por visitar"] || [] : []),
    ...(showVisited ? assignments.Visitado || [] : []),
  ].map(c => ({
    id: c.id, clientId: c.client_id, prospect: Boolean(c.prospecto_place_id), name: c.razon_social,
    lat: c.prospecto_latitud, lng: c.prospecto_longitud, days: c.dias_desde_ultima_compra,
    address: c.direccion_principal, rubro: c.rubro, details: [c.barrio_principal || "", c.telefonos?.[0] || ""],
  })), [assignments, showPending, showVisited]);
  return <StoredAssignmentsMap items={items} filters={<div className="flex gap-4 mb-3">
    <Label className="flex items-center gap-2"><Checkbox checked={showPending} onCheckedChange={v => setShowPending(v === true)} />Por visitar</Label>
    <Label className="flex items-center gap-2"><Checkbox checked={showVisited} onCheckedChange={v => setShowVisited(v === true)} />Visitados</Label>
  </div>} />;
}
