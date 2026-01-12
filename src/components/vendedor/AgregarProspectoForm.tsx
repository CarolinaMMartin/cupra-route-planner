import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MapPin, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  geocodeAddress,
  isValidArgentinaCoordinate,
  generateManualPlaceId,
  PROVINCIAS_ARGENTINA,
  GeocodingResponse,
} from "@/services/geocodingService";

interface AgregarProspectoFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

type FormStep = "form" | "validating" | "confirm" | "saving" | "error";

interface FormData {
  nombre: string;
  direccion: string;
  barrio: string;
  ciudad: string;
  provincia: string;
  telefono: string;
}

const AgregarProspectoForm = ({ onSuccess, onCancel }: AgregarProspectoFormProps) => {
  const [step, setStep] = useState<FormStep>("form");
  const [formData, setFormData] = useState<FormData>({
    nombre: "",
    direccion: "",
    barrio: "",
    ciudad: "",
    provincia: "",
    telefono: "",
  });
  const [geocodeResult, setGeocodeResult] = useState<GeocodingResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const { toast } = useToast();

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const validateForm = (): boolean => {
    if (!formData.nombre.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Ingresa el nombre del establecimiento" });
      return false;
    }
    if (!formData.direccion.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Ingresa la dirección" });
      return false;
    }
    if (!formData.ciudad.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Ingresa la ciudad" });
      return false;
    }
    if (!formData.provincia) {
      toast({ variant: "destructive", title: "Error", description: "Selecciona la provincia" });
      return false;
    }
    return true;
  };

  const handleValidateAndSave = async () => {
    if (!validateForm()) return;

    setStep("validating");
    setErrorMessage("");

    try {
      const result = await geocodeAddress({
        direccion: formData.direccion,
        barrio: formData.barrio || undefined,
        ciudad: formData.ciudad,
        provincia: formData.provincia,
        pais: "Argentina",
      });

      if (result.status !== "OK" || !result.lat || !result.lng) {
        setErrorMessage(result.message || "No se pudo validar la dirección. Revisá calle, altura o localidad.");
        setStep("error");
        return;
      }

      if (!isValidArgentinaCoordinate(result.lat, result.lng)) {
        setErrorMessage("Las coordenadas obtenidas están fuera de Argentina. Verificá la dirección.");
        setStep("error");
        return;
      }

      setGeocodeResult(result);
      setStep("confirm");

    } catch (error) {
      console.error("Error en geocodificación:", error);
      setErrorMessage("Error inesperado al validar la dirección. Intentá nuevamente.");
      setStep("error");
    }
  };

  const handleConfirmSave = async () => {
    if (!geocodeResult || !geocodeResult.lat || !geocodeResult.lng) return;

    setStep("saving");

    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        toast({ variant: "destructive", title: "Error", description: "Sesión expirada. Iniciá sesión nuevamente." });
        return;
      }

      const placeId = generateManualPlaceId();

      // Insertar prospecto
      const { error: prospectoError } = await supabase
        .from("prospectos")
        .insert({
          place_id: placeId,
          nombre: formData.nombre.trim(),
          direccion: geocodeResult.formatted_address || formData.direccion.trim(),
          barrio: formData.barrio.trim() || null,
          ciudad: formData.ciudad.trim(),
          provincia: formData.provincia,
          latitud: geocodeResult.lat,
          longitud: geocodeResult.lng,
          telefono: formData.telefono.trim() || null,
          tipo_principal: "Manual",
          es_cliente_cupra: false,
        });

      if (prospectoError) {
        console.error("Error al insertar prospecto:", prospectoError);
        throw new Error("Error al guardar el prospecto");
      }

      toast({
        title: "Prospecto creado",
        description: `"${formData.nombre}" fue agregado correctamente.`,
      });

      onSuccess();

    } catch (error: any) {
      console.error("Error al guardar:", error);
      setErrorMessage(error.message || "Error al guardar el prospecto. Intentá nuevamente.");
      setStep("error");
    }
  };

  const handleRetry = () => {
    setStep("form");
    setErrorMessage("");
    setGeocodeResult(null);
  };

  // === RENDER SEGÚN STEP ===

  if (step === "validating") {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-accent" />
        <p className="text-lg font-medium text-foreground">Validando ubicación...</p>
        <p className="text-sm text-muted-foreground">Verificando la dirección con el servicio de geocodificación</p>
      </div>
    );
  }

  if (step === "saving") {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-accent" />
        <p className="text-lg font-medium text-foreground">Guardando prospecto...</p>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-destructive/20">
          <AlertCircle className="w-10 h-10 text-destructive" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-foreground">No se pudo validar la dirección</p>
          <p className="text-sm text-muted-foreground max-w-sm">{errorMessage}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={handleRetry} className="wine-button">
            Corregir datos
          </Button>
        </div>
      </div>
    );
  }

  if (step === "confirm" && geocodeResult) {
    return (
      <div className="flex flex-col space-y-6 py-4">
        <div className="flex items-center justify-center">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-accent/20">
            <CheckCircle className="w-10 h-10 text-accent" />
          </div>
        </div>
        
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-foreground">Dirección validada</p>
          <p className="text-sm text-muted-foreground">Confirmá que la dirección interpretada es correcta</p>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 border border-border">
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">{formData.nombre}</p>
              <p className="text-sm text-muted-foreground">{geocodeResult.formatted_address}</p>
              <p className="text-xs text-muted-foreground">
                Coordenadas: {geocodeResult.lat?.toFixed(6)}, {geocodeResult.lng?.toFixed(6)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={handleRetry} className="flex-1">
            Corregir datos
          </Button>
          <Button onClick={handleConfirmSave} className="flex-1 wine-button">
            Confirmar y Guardar
          </Button>
        </div>
      </div>
    );
  }

  // === FORMULARIO PRINCIPAL ===
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="nombre">Nombre del establecimiento *</Label>
        <Input
          id="nombre"
          placeholder="Ej: Restaurante Don Carlos"
          value={formData.nombre}
          onChange={(e) => handleInputChange("nombre", e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="direccion">Dirección (calle y altura) *</Label>
        <Input
          id="direccion"
          placeholder="Ej: Av. Santa Fe 1234"
          value={formData.direccion}
          onChange={(e) => handleInputChange("direccion", e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="barrio">Barrio / Localidad</Label>
        <Input
          id="barrio"
          placeholder="Ej: Recoleta"
          value={formData.barrio}
          onChange={(e) => handleInputChange("barrio", e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ciudad">Ciudad *</Label>
        <Input
          id="ciudad"
          placeholder="Ej: Buenos Aires"
          value={formData.ciudad}
          onChange={(e) => handleInputChange("ciudad", e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="provincia">Provincia *</Label>
        <Select
          value={formData.provincia}
          onValueChange={(value) => handleInputChange("provincia", value)}
        >
          <SelectTrigger className="bg-input border-border">
            <SelectValue placeholder="Seleccionar provincia" />
          </SelectTrigger>
          <SelectContent>
            {PROVINCIAS_ARGENTINA.map((prov) => (
              <SelectItem key={prov} value={prov}>
                {prov}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="telefono">Teléfono</Label>
        <Input
          id="telefono"
          placeholder="Ej: 11 1234-5678"
          value={formData.telefono}
          onChange={(e) => handleInputChange("telefono", e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={handleValidateAndSave} className="flex-1 wine-button">
          <MapPin className="w-4 h-4 mr-2" />
          Validar y Guardar
        </Button>
      </div>
    </div>
  );
};

export default AgregarProspectoForm;
