import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, MapPin, Users } from "lucide-react";

interface AIInsightsProps {
  resumen: {
    total_recomendaciones: number;
    descripcion: string;
    distribucion_por_vendedor: Record<string, number>;
    zonas_priorizadas: string[];
  };
  vendedores: Array<{ id: string; nombre: string }>;
}

const AIInsightsCard = ({ resumen, vendedores }: AIInsightsProps) => {
  const getVendedorNombre = (id: string) => {
    return vendedores.find(v => v.id === id)?.nombre || 'Desconocido';
  };

  return (
    <Card className="bg-gradient-to-br from-primary/5 to-secondary/5 border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          <CardTitle className="text-lg">Análisis de IA - Lovable</CardTitle>
        </div>
        <CardDescription>Recomendaciones generadas con inteligencia artificial</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Descripción del análisis */}
        <div className="p-3 bg-card rounded-lg border">
          <p className="text-sm text-muted-foreground italic">
            "{resumen.descripcion}"
          </p>
        </div>

        {/* Métricas clave */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Total recomendaciones */}
          <div className="flex items-center gap-3 p-3 bg-card rounded-lg border">
            <TrendingUp className="w-8 h-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{resumen.total_recomendaciones}</p>
              <p className="text-xs text-muted-foreground">Recomendaciones</p>
            </div>
          </div>

          {/* Zonas priorizadas */}
          <div className="flex items-center gap-3 p-3 bg-card rounded-lg border">
            <MapPin className="w-8 h-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{resumen.zonas_priorizadas.length}</p>
              <p className="text-xs text-muted-foreground">Zonas priorizadas</p>
            </div>
          </div>

          {/* Vendedores involucrados */}
          <div className="flex items-center gap-3 p-3 bg-card rounded-lg border">
            <Users className="w-8 h-8 text-primary" />
            <div>
              <p className="text-2xl font-bold">{Object.keys(resumen.distribucion_por_vendedor).length}</p>
              <p className="text-xs text-muted-foreground">Vendedores</p>
            </div>
          </div>
        </div>

        {/* Distribución por vendedor */}
        {Object.keys(resumen.distribucion_por_vendedor).length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Distribución por Vendedor
            </h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(resumen.distribucion_por_vendedor).map(([vendedorId, cantidad]) => (
                <Badge key={vendedorId} variant="secondary" className="flex items-center gap-2">
                  <span className="font-medium">{getVendedorNombre(vendedorId)}</span>
                  <span className="text-primary font-bold">{cantidad}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Zonas priorizadas */}
        {resumen.zonas_priorizadas.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Zonas Priorizadas
            </h4>
            <div className="flex flex-wrap gap-2">
              {resumen.zonas_priorizadas.map((zona) => (
                <Badge key={zona} variant="outline">
                  {zona}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AIInsightsCard;