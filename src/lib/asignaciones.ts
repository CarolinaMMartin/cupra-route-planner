import { supabase } from "@/integrations/supabase/client";
import { hoyArgentina } from "@/lib/segmentos";

export interface VisitaParaAsignar {
  vendedor_id: string;
  client_id?: string | null;
  prospecto_place_id?: string | null;
  asignacion_id?: string;
  fecha_programada?: string | null;
  estado?: "Asignado" | "Por visitar";
}

/** Guardado transaccional: visitas, rotación y transferencia de cartera opcional. */
export async function guardarAsignaciones(visitas: VisitaParaAsignar[], actualizarCartera = false): Promise<number> {
  if (!visitas.length) throw new Error("Seleccioná al menos una visita.");
  for (const visita of visitas) {
    if (!visita.vendedor_id || Boolean(visita.client_id) === Boolean(visita.prospecto_place_id)) {
      throw new Error("Cada visita necesita un vendedor y un identificador de cliente o prospecto.");
    }
  }
  const { data, error } = await supabase.rpc("guardar_asignaciones", {
    p_asignaciones: visitas.map((visita) => ({ ...visita })),
    p_actualizar_cartera: actualizarCartera,
  });
  if (error) throw error;
  return data;
}

/** Autoasignación bajo RLS: inserta una visita nueva sin reabrir el historial. */
export async function guardarVisitaPropia(visita: Omit<VisitaParaAsignar, "asignacion_id">): Promise<boolean> {
  if (!visita.vendedor_id || Boolean(visita.client_id) === Boolean(visita.prospecto_place_id)) {
    throw new Error("La visita necesita un vendedor y un cliente o prospecto.");
  }
  const { error } = await supabase.from("asignaciones_vendedores_clientes").insert({
    ...visita,
    es_prospecto: Boolean(visita.prospecto_place_id),
    estado: visita.estado ?? "Por visitar",
    origen_asignacion: "auto",
    fecha_programada: visita.fecha_programada ?? hoyArgentina(),
  });
  // El índice de pendientes por cuenta, vendedor y día resuelve también los reintentos concurrentes.
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}
