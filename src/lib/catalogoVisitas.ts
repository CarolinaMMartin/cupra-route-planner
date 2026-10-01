import { supabase } from "@/integrations/supabase/client";

export interface ComercioCatalogo {
  id: string; tipo: "cliente" | "prospecto"; nombre: string; direccion: string | null;
  barrio: string | null; telefono: string | null; telefonos: string[] | null;
  lat: number | null; lng: number | null; rubro: string | null; vendedor: string | null;
}
export async function buscarCatalogo(busqueda: string, tipo = "ambos", offset = 0, limite = 100): Promise<ComercioCatalogo[]> {
  const { data, error } = await supabase.rpc("catalogo_visitas", {
    p_busqueda: busqueda, p_tipo: tipo, p_offset: offset, p_limite: limite,
  });
  if (error) throw error;
  return data as unknown as ComercioCatalogo[];
}
export async function catalogoClientes(): Promise<ComercioCatalogo[]> {
  const rows: ComercioCatalogo[] = [];
  for (let offset = 0; offset < 100_000; offset += 200) {
    const page = await buscarCatalogo("", "clientes", offset, 200);
    rows.push(...page);
    if (page.length < 200) return rows;
  }
  throw new Error("El catálogo es demasiado grande para comprobar duplicados.");
}
