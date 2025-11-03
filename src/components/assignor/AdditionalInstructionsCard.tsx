import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AdditionalInstructionsCardProps {
  value: string;
  onChange: (value: string) => void;
}

const AdditionalInstructionsCard = ({ value, onChange }: AdditionalInstructionsCardProps) => {
  return (
    <Card className="bg-gradient-to-br from-accent/5 to-primary/5 border-accent/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          <CardTitle className="text-lg">Criterios Complementarios para la IA</CardTitle>
        </div>
        <CardDescription>
          Instrucciones adicionales que la IA considerará al generar las recomendaciones
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Ejemplos de criterios:</strong>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>Priorizar clientes que compran productos específicos (ej: "clientes que compran Malbec")</li>
              <li>Enfocarse en ciertos canales (ej: "solo restaurantes ON_TRADE")</li>
              <li>Considerar etiquetas específicas (ej: "clientes VIP o Premium")</li>
              <li>Evitar clientes con ciertos criterios (ej: "evitar clientes con pagos pendientes")</li>
            </ul>
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="additional-instructions">
            Instrucciones libres para la IA
          </Label>
          <Textarea
            id="additional-instructions"
            placeholder="Ej: Priorizar clientes que compran Malbec Gran Reserva, enfocarse en restaurantes de alta gama del canal ON_TRADE..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-[120px] resize-none bg-background"
          />
          <p className="text-xs text-muted-foreground">
            La IA buscará en la base de datos (productos, etiquetas, canales) para cumplir con tus instrucciones
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default AdditionalInstructionsCard;
