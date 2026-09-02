import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import AgregarProspectoForm from "./AgregarProspectoForm";

interface ProspectoFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onCancel: () => void;
}

const ProspectoFormModal = ({
  open,
  onOpenChange,
  onSuccess,
  onCancel,
}: ProspectoFormModalProps) => {
  const isMobile = useIsMobile();

  // Solo se cierra con los botones del formulario: evita perder la carga
  // al tocar fuera, al presionar Escape o al volver desde otra app.
  const handleOpenChange = (next: boolean) => {
    if (next) onOpenChange(true);
  };

  // Mobile: Drawer desde abajo con mejor UX táctil
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} dismissible={false}>
        <DrawerContent className="max-h-[92vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-lg">Agregar Prospecto</DrawerTitle>
            <DrawerDescription className="text-sm">
              Nuevo prospecto para tu lista de visitas
            </DrawerDescription>
          </DrawerHeader>
          <ScrollArea className="flex-1 px-4 pb-6 overflow-y-auto max-h-[calc(92vh-100px)]">
            <AgregarProspectoForm onSuccess={onSuccess} onCancel={onCancel} />
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: Dialog tradicional
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Agregar Prospecto Manualmente</DialogTitle>
          <DialogDescription>
            Crea un nuevo prospecto y agrégalo a tu lista de visitas
          </DialogDescription>
        </DialogHeader>
        <AgregarProspectoForm onSuccess={onSuccess} onCancel={onCancel} />
      </DialogContent>
    </Dialog>
  );
};

export default ProspectoFormModal;
