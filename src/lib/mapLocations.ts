import { supabase } from "@/integrations/supabase/client";

export function validMapCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -56 && lat <= -21 && lng >= -74 && lng <= -53;
}

export interface StoredLocation { lat: number; lng: number; address: string | null; days?: number | null; rubro?: string | null }

/** Read stored coordinates only. Opening a map must never move a customer. */
export async function loadClientLocations(ids: string[]): Promise<Map<string, StoredLocation>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const locations = new Map<string, StoredLocation>();
  for (let i = 0; i < uniqueIds.length; i += 200) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("client_places")
        .select("id,client_id,lat,long,direccion_principal,is_primary,direccion_verificada")
        .in("client_id", uniqueIds.slice(i, i + 200))
        .order("is_primary", { ascending: false, nullsFirst: false })
        .order("direccion_verificada", { ascending: false }).order("id")
        .range(offset, offset + 499);
      if (error) throw new Error("No se pudieron cargar las ubicaciones guardadas. Volvé a intentar.");
      for (const place of data || []) {
        if (!locations.has(place.client_id) && validMapCoordinates(place.lat, place.long)) {
          locations.set(place.client_id, { lat: place.lat, lng: place.long, address: place.direccion_principal });
        }
      }
      if (!data || data.length < 500) break;
    }
    const { data: clients, error } = await supabase.from("clientes")
      .select("client_id,dias_desde_ultima_compra,rubro").in("client_id", uniqueIds.slice(i, i + 200));
    if (error) throw new Error("No se pudo cargar el estado comercial de los clientes.");
    for (const client of clients || []) {
      const location = locations.get(client.client_id);
      if (location) { location.days = client.dias_desde_ultima_compra; location.rubro = client.rubro; }
    }
  }
  return locations;
}

/** User-controlled text goes through textContent, never through HTML or onclick. */
export function mapPopup(name: string, details: string[], position: { lat: number; lng: number }): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = "padding:8px;max-width:280px;color:#111827;font:13px system-ui";
  const title = document.createElement("strong");
  title.textContent = name;
  root.append(title);
  for (const text of details.filter(Boolean)) {
    const p = document.createElement("p");
    p.style.margin = "6px 0";
    p.textContent = text;
    root.append(p);
  }
  const link = document.createElement("a");
  link.href = `https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Abrir en Google Maps";
  link.style.color = "#1a73e8";
  root.append(link);
  return root;
}
