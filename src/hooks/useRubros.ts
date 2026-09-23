import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RubroOpcion {
  value: string;
  label: string;
  clientes: number;
  prospectos: number;
}

/** Caché acotada: los rubros se refrescan después de importar o volver al panel. */
export function useRubros() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["rubros-disponibles"],
    staleTime: 30_000,
    queryFn: async (): Promise<RubroOpcion[]> => {
      const { data, error } = await supabase.rpc("rubros_disponibles");
      if (error) throw error;
      return (data || []).filter((r) => r.rubro).map((r) => ({
        value: r.rubro,
        label: `${r.rubro} (${Number(r.clientes) + Number(r.prospectos)})`,
        clientes: Number(r.clientes),
        prospectos: Number(r.prospectos),
      }));
    },
  });
  return { rubros: data || [], loading: isLoading, error };
}
