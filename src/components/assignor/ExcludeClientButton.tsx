import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BanIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface ExcludeClientButtonProps {
  clientId: string;
  clientName: string;
  onSuccess?: () => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const ExcludeClientButton = ({ 
  clientId, 
  clientName, 
  onSuccess,
  variant = "destructive",
  size = "sm"
}: ExcludeClientButtonProps) => {
  const [showDialog, setShowDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");

  const MAX_CHARS = 200;
  const MIN_CHARS = 10;

  const handleMotivoChange = (value: string) => {
    // Limitar a MAX_CHARS caracteres
    if (value.length <= MAX_CHARS) {
      setMotivo(value);
      setError("");
    }
  };

  const validateMotivo = (): boolean => {
    const trimmed = motivo.trim();
    if (trimmed.length < MIN_CHARS) {
      setError(`La justificación debe tener al menos ${MIN_CHARS} caracteres`);
      return false;
    }
    return true;
  };

  const handleExclude = async () => {
    if (!validateMotivo()) return;

    setIsLoading(true);
    try {
      const { error: dbError } = await supabase
        .from('clientes')
        .update({ 
          excluir_recomendaciones: true,
          motivo_exclusion: motivo.trim()
        })
        .eq('client_id', clientId);

      if (dbError) throw dbError;

      toast({
        title: "Cliente excluido",
        description: `${clientName} no será recomendado en futuras asignaciones`,
      });

      setShowDialog(false);
      setMotivo("");
      onSuccess?.();
    } catch (err) {
      console.error('Error excluyendo cliente:', err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo excluir el cliente. Intente nuevamente.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setShowDialog(false);
    setMotivo("");
    setError("");
  };

  return (
    <>
      <Button 
        variant={variant} 
        size={size}
        onClick={(e) => {
          e.stopPropagation();
          setShowDialog(true);
        }}
        className="gap-2"
      >
        <BanIcon className="w-4 h-4" />
        No volver a recomendar
      </Button>

      <Dialog open={showDialog} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Excluir de recomendaciones?</DialogTitle>
            <DialogDescription>
              El cliente <strong>{clientName}</strong> no será incluido en futuras recomendaciones.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="space-y-2">
              <Label htmlFor="motivo" className="text-sm font-medium">
                Justificación <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="motivo"
                placeholder="Ej: Local cerrado permanentemente, cambió de rubro, no trabaja más con vinos..."
                value={motivo}
                onChange={(e) => handleMotivoChange(e.target.value)}
                className={error ? "border-destructive" : ""}
                rows={3}
              />
              <div className="flex justify-between items-center">
                {error ? (
                  <p className="text-xs text-destructive">{error}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Mínimo {MIN_CHARS} caracteres
                  </p>
                )}
                <p className={`text-xs ${motivo.length >= MAX_CHARS ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {motivo.length}/{MAX_CHARS}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleExclude}
              disabled={isLoading || motivo.trim().length < MIN_CHARS}
            >
              {isLoading ? "Excluyendo..." : "Sí, excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ExcludeClientButton;
