import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, MapPin, Check, AlertCircle, Search } from "lucide-react";
import { 
  geocodeAddress, 
  isValidArgentinaCoordinate, 
  generateManualPlaceId,
  PROVINCIAS_ARGENTINA,
  GeocodingResponse 
} from "@/services/geocodingService";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface GeocodificarClienteFormProps {
  clientId: string;
  razonSocial: string | null;
  direccionActual: string | null;
  ciudadActual: string | null;
  provinciaActual: string | null;
  onSuccess: () => void;
  onCancel: () => void;
}

type FormStep = "input" | "validating" | "confirming" | "saving";

export const GeocodificarClienteForm = ({
  clientId,
  razonSocial,
  direccionActual,
  ciudadActual,
  provinciaActual,
  onSuccess,
  onCancel,
}: GeocodificarClienteFormProps) => {
  const { toast } = useToast();
  
  // Form state
  const [direccion, setDireccion] = useState(direccionActual || "");
  const [ciudad, setCiudad] = useState(ciudadActual || "");
  const [provincia, setProvincia] = useState(provinciaActual || "");
  
  // Process state
  const [step, setStep] = useState<FormStep>("input");
  const [geocodeResult, setGeocodeResult] = useState<GeocodingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleValidar = async () => {
    if (!direccion.trim() || !ciudad.trim() || !provincia) {
      setError("Completa todos los campos requeridos");
      return;
    }

    setError(null);
    setStep("validating");

    try {
      const result = await geocodeAddress({
        direccion: direccion.trim(),
        ciudad: ciudad.trim(),
        provincia,
        pais: "Argentina",
      });

      if (result.status === "ERROR") {
        setError(result.message || "No se pudo geocodificar la dirección");
        setStep("input");
        return;
      }

      if (!result.lat || !result.lng || !isValidArgentinaCoordinate(result.lat, result.lng)) {
        setError("La ubicación obtenida no está dentro de Argentina. Verifica la dirección.");
        setStep("input");
        return;
      }

      setGeocodeResult(result);
      setStep("confirming");
    } catch (err) {
      console.error("Error geocoding:", err);
      setError("Error al procesar la dirección. Intenta nuevamente.");
      setStep("input");
    }
  };

  const handleConfirmar = async () => {
    if (!geocodeResult?.lat || !geocodeResult?.lng) return;

    setStep("saving");
    setError(null);

    try {
      // 1. Preparar datos para client_places
      const placeData = {
        client_id: clientId,
        lat: geocodeResult.lat,
        lng: geocodeResult.lng,
        direccion: geocodeResult.formatted_address || direccion,
        barrio: geocodeResult.barrio || geocodeResult.barrio_fallback_admin2 || null,
        comuna_distrito: geocodeResult.comuna || null,
        provincia: geocodeResult.provincia || provincia,
        place_id: geocodeResult.place_id || generateManualPlaceId(),
        is_primary: true,
      };

      // 2. Llamar al Edge Function para insertar en client_places
      const { data: edgeResponse, error: edgeError } = await supabase.functions.invoke(
        'upsert-client-places',
        {
          body: { places: [placeData] }
        }
      );

      if (edgeError) throw new Error(edgeError.message);
      if (!edgeResponse?.success) throw new Error(edgeResponse?.error || "Error al guardar ubicación");

      // 3. Sincronizar datos geográficos a tabla clientes
      const { error: updateError } = await supabase
        .from('clientes')
        .update({
          provincia_principal: geocodeResult.provincia || provincia,
          barrio_principal: geocodeResult.barrio || geocodeResult.barrio_fallback_admin2 || null,
          direccion_principal: geocodeResult.formatted_address || direccion,
          ciudad_principal: geocodeResult.ciudad || ciudad,
        })
        .eq('client_id', clientId);

      if (updateError) {
        console.error("Error syncing to clientes:", updateError);
        // No es crítico, continuamos
      }

      toast({
        title: "Ubicación agregada",
        description: "Los datos geográficos se guardaron correctamente",
      });

      onSuccess();
    } catch (err: any) {
      console.error("Error saving location:", err);
      setError(err.message || "Error al guardar la ubicación");
      setStep("confirming");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="h-4 w-4" />
        <span>Agregar ubicación para: <strong>{razonSocial || clientId}</strong></span>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Step: Input */}
      {(step === "input" || step === "validating") && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="direccion">Dirección *</Label>
            <Input
              id="direccion"
              placeholder="Ej: Av. Corrientes 1234"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              disabled={step === "validating"}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ciudad">Ciudad *</Label>
              <Input
                id="ciudad"
                placeholder="Ej: Buenos Aires"
                value={ciudad}
                onChange={(e) => setCiudad(e.target.value)}
                disabled={step === "validating"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="provincia">Provincia *</Label>
              <Select 
                value={provincia} 
                onValueChange={setProvincia}
                disabled={step === "validating"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCIAS_ARGENTINA.map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={step === "validating"}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleValidar}
              disabled={step === "validating" || !direccion.trim() || !ciudad.trim() || !provincia}
              className="flex-1"
            >
              {step === "validating" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Validar ubicación
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step: Confirming */}
      {(step === "confirming" || step === "saving") && geocodeResult && (
        <div className="space-y-4">
          <Alert className="bg-primary/10 border-primary/30">
            <Check className="h-4 w-4 text-primary" />
            <AlertDescription>
              Ubicación encontrada correctamente
            </AlertDescription>
          </Alert>

          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Dirección verificada</Label>
              <p className="text-sm font-medium">{geocodeResult.formatted_address}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Barrio</Label>
                <p className="text-sm">
                  {geocodeResult.barrio || geocodeResult.barrio_fallback_admin2 || "—"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Comuna</Label>
                <p className="text-sm">{geocodeResult.comuna || "—"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Ciudad</Label>
                <p className="text-sm">{geocodeResult.ciudad || ciudad}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Provincia</Label>
                <p className="text-sm">{geocodeResult.provincia || provincia}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Badge variant="outline" className="text-xs">
                📍 {geocodeResult.lat?.toFixed(6)}, {geocodeResult.lng?.toFixed(6)}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {geocodeResult.location_type || "ROOFTOP"}
              </Badge>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setStep("input");
                setGeocodeResult(null);
              }}
              disabled={step === "saving"}
              className="flex-1"
            >
              Corregir
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={step === "saving"}
              className="flex-1"
            >
              {step === "saving" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Confirmar y guardar
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
