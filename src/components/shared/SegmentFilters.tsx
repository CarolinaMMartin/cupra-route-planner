import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { useRubros } from "@/hooks/useRubros";
import {
  CANALES,
  ESTADOS,
  FILTROS_VACIOS,
  type FiltrosSegmento,
  hayFiltros,
  VOLUMENES,
} from "@/lib/segmentos";

type Campo = keyof FiltrosSegmento;

interface Opcion { value: string; label: string }

interface SegmentFiltersProps {
  value: FiltrosSegmento;
  onChange: (f: FiltrosSegmento) => void;
  /** Qué filtros mostrar (por defecto todos los que tengan opciones). */
  campos?: Campo[];
  /** Opciones que dependen de la pantalla. */
  vendedores?: Opcion[];
  comunas?: Opcion[];
  barrios?: Opcion[];
  /** Estados a ofrecer (ej. sin "Potencial" en ventas). */
  estados?: typeof ESTADOS;
  titulo?: string;
  className?: string;
}

const TODOS: Campo[] = ["estados", "rubros", "canales", "volumenes", "vendedores", "comunas", "barrios"];

/**
 * Filtros por segmento comunes a todos los dashboards y a las asignaciones:
 * estado, rubro, canal, volumen, vendedor, comuna y barrio. Selección múltiple.
 */
export function SegmentFilters({
  value,
  onChange,
  campos = TODOS,
  vendedores = [],
  comunas = [],
  barrios = [],
  estados = ESTADOS,
  titulo = "Segmentos",
  className,
}: SegmentFiltersProps) {
  const { rubros, loading, error } = useRubros();
  const set = (campo: Campo) => (vals: string[]) => onChange({ ...value, [campo]: vals });

  const config: Record<Campo, { label: string; options: Opcion[]; placeholder: string }> = {
    estados: { label: "Estado", options: estados.map((e) => ({ value: e.value, label: e.plural })), placeholder: "Todos" },
    rubros: { label: "Rubro", options: rubros, placeholder: loading ? "Cargando..." : "Todos" },
    canales: { label: "Canal", options: CANALES, placeholder: "Todos" },
    volumenes: { label: "Volumen", options: VOLUMENES, placeholder: "Todos" },
    vendedores: { label: "Vendedor", options: vendedores, placeholder: "Todos" },
    comunas: { label: "Comuna", options: comunas, placeholder: "Todas" },
    barrios: { label: "Barrio", options: barrios, placeholder: "Todos" },
  };
  const visibles = campos.filter((c) => config[c].options.length > 0 || c === "rubros");

  return (
    <div className={className}>
      {error && campos.includes("rubros") && <p role="alert" className="mb-2 text-xs text-destructive">No se pudieron cargar los rubros. Reintentá al volver a esta pantalla.</p>}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{titulo}</span>
        </div>
        {hayFiltros(value) && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(FILTROS_VACIOS)} className="h-7 px-2 text-xs text-muted-foreground">
            <X className="w-3 h-3 mr-1" />Limpiar
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {visibles.map((campo) => (
          <div key={campo} className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{config[campo].label}</Label>
            <MultiSelect
              ariaLabel={config[campo].label}
              options={config[campo].options}
              selected={value[campo]}
              onChange={set(campo)}
              placeholder={config[campo].placeholder}
              className="w-full"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
