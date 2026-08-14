import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Search, Sparkles, X } from "lucide-react";

interface RecommendationProgressProps {
  progress: number;
  onCancel: () => void;
}

const stages = [
  {
    from: 0,
    label: "Preparando la búsqueda",
    detail: "Validando zona, vendedores y parámetros.",
  },
  {
    from: 14,
    label: "Buscando clientes",
    detail: "Revisando la cartera disponible en la zona seleccionada.",
  },
  {
    from: 34,
    label: "Evaluando la cobertura",
    detail: "Priorizando clientes para completar 8 visitas por vendedor.",
  },
  {
    from: 52,
    label: "Buscando nuevos prospectos si hacen falta",
    detail: "Si faltan clientes internos, consultamos oportunidades cercanas en Google Maps.",
  },
  {
    from: 69,
    label: "Calculando la ruta",
    detail: "Ordenando las opciones por cercanía y valor comercial.",
  },
  {
    from: 84,
    label: "Armando las recomendaciones",
    detail: "Completando y verificando las 8 visitas de cada vendedor.",
  },
  {
    from: 98,
    label: "Recomendaciones listas",
    detail: "Ya podés revisar la preselección.",
  },
];

const RecommendationProgress = ({ progress, onCancel }: RecommendationProgressProps) => {
  const normalizedProgress = Math.min(100, Math.max(0, Math.round(progress)));
  const currentStage = [...stages].reverse().find((stage) => normalizedProgress >= stage.from) ?? stages[0];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recommendation-progress-title"
      aria-describedby="recommendation-progress-description"
    >
      <div className="w-full max-w-md rounded-2xl border border-primary/25 bg-card p-6 shadow-large sm:p-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-2 flex items-center gap-2 text-primary">
            {normalizedProgress >= 98 ? <Sparkles className="h-5 w-5" /> : <Search className="h-5 w-5 animate-pulse" />}
            <span className="text-sm font-semibold uppercase tracking-wider">Generando recomendaciones</span>
          </div>

          <h2 id="recommendation-progress-title" className="text-xl font-semibold text-foreground">
            {currentStage.label}
          </h2>
          <p id="recommendation-progress-description" className="mt-2 min-h-10 text-sm text-muted-foreground">
            {currentStage.detail}
          </p>

          <div className="mt-6 w-full space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progreso estimado</span>
              <span className="font-semibold tabular-nums text-foreground">{normalizedProgress}%</span>
            </div>
            <Progress value={normalizedProgress} className="h-2 bg-secondary" aria-label={`Progreso estimado: ${normalizedProgress}%`} />
          </div>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            La duración puede variar según la cantidad de vendedores y la respuesta de Google Maps.
          </p>

          {normalizedProgress < 98 && (
            <Button type="button" variant="ghost" size="sm" className="mt-5 gap-2 text-muted-foreground" onClick={onCancel}>
              <X className="h-4 w-4" />
              Detener búsqueda
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default RecommendationProgress;
