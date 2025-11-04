import { useState } from "react";
import { Button } from "@/components/ui/button";
import { BanIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

  const handleExclude = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('clientes')
        .update({ excluir_recomendaciones: true })
        .eq('client_id', clientId);

      if (error) throw error;

      toast({
        title: "Cliente excluido",
        description: `${clientName} no será recomendado en futuras asignaciones`,
      });

      setShowDialog(false);
      onSuccess?.();
    } catch (error) {
      console.error('Error excluyendo cliente:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo excluir el cliente. Intente nuevamente.",
      });
    } finally {
      setIsLoading(false);
    }
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

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Excluir de recomendaciones?</AlertDialogTitle>
            <AlertDialogDescription>
              El cliente <strong>{clientName}</strong> no será incluido en futuras recomendaciones.
              <br /><br />
              Esto es útil cuando un local está cerrado definitivamente o la relación comercial ha terminado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleExclude}
              disabled={isLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading ? "Excluyendo..." : "Sí, excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ExcludeClientButton;