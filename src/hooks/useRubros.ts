import { CATEGORIAS_PROSPECTOS } from "../../supabase/functions/_shared/prospect-categories";
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
      const disponibles = (data || []).filter((r) => r.rubro).map((r) => ({
        value: r.rubro,
        label: `${r.rubro} (${Number(r.clientes) + Number(r.prospectos)})`,
        clientes: Number(r.clientes),
        prospectos: Number(r.prospectos),
      }));
      for (const c of CATEGORIAS_PROSPECTOS) {
        if (!disponibles.some(r => r.value === c.rubro)) disponibles.push({ value: c.rubro, label: `${c.rubro} (para buscar)`, clientes: 0, prospectos: 0 });
      }
      return disponibles.sort((a, b) => a.value.localeCompare(b.value, "es"));
    },
  });
  return { rubros: data || [], loading: isLoading, error };
}
