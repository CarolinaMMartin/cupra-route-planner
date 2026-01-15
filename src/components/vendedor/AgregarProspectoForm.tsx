import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MapPin, CheckCircle, AlertCircle, AlertTriangle } from "lucide-react";
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

type FormStep = "form" | "validating" | "checking_duplicates" | "duplicates_found" | "confirm" | "saving" | "error";

type RiskLevel = "critico" | "alto" | "medio" | "bajo";

interface DuplicateMatch {
  tipo: "prospecto" | "cliente";
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  distancia_metros?: number;
  riesgo: RiskLevel;
  razon_match: string;
}

interface FormData {
  nombre: string;
  direccion: string;
  barrio: string;
  ciudad: string;
  provincia: string;
  telefono: string;
  email: string;
  instagram: string;
}

// === FUNCIONES DE NORMALIZACIÓN ===

const STOP_WORDS = [
  "bar", "cafe", "café", "restaurant", "restaurante", "pizzeria", "pizzería",
  "parrilla", "bodegon", "bodegón", "vinoteca", "wine", "cerveceria", "cervecería",
  "el", "la", "los", "las", "de", "del", "y", "e", "en", "con", "para"
];

const normalizeName = (name: string): string => {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .replace(/[^a-z0-9\s]/g, "") // quitar caracteres especiales
    .split(/\s+/)
    .filter(word => !STOP_WORDS.includes(word) && word.length > 2)
    .join(" ");
};

const normalizePhone = (phone: string | null): string => {
  if (!phone) return "";
  return phone.replace(/\D/g, "").slice(-8); // últimos 8 dígitos
};

const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000; // Radio de la Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // distancia en metros
};

const tokenOverlap = (name1: string, name2: string): number => {
  const tokens1 = new Set(normalizeName(name1).split(" ").filter(t => t.length > 0));
  const tokens2 = new Set(normalizeName(name2).split(" ").filter(t => t.length > 0));
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  const intersection = [...tokens1].filter(t => tokens2.has(t));
  return intersection.length / Math.min(tokens1.size, tokens2.size);
};

// === COLORES Y LABELS POR RIESGO ===

const riskConfig: Record<RiskLevel, { bg: string; border: string; text: string; label: string }> = {
  critico: { bg: "bg-red-500/20", border: "border-red-500", text: "text-red-500", label: "Duplicado Exacto" },
  alto: { bg: "bg-orange-500/20", border: "border-orange-500", text: "text-orange-500", label: "Riesgo Alto" },
  medio: { bg: "bg-yellow-500/20", border: "border-yellow-500", text: "text-yellow-500", label: "Riesgo Medio" },
  bajo: { bg: "bg-blue-500/20", border: "border-blue-500", text: "text-blue-500", label: "Riesgo Bajo" }
};

const AgregarProspectoForm = ({ onSuccess, onCancel }: AgregarProspectoFormProps) => {
  const [step, setStep] = useState<FormStep>("form");
  const [formData, setFormData] = useState<FormData>({
    nombre: "",
    direccion: "",
    barrio: "",
    ciudad: "",
    provincia: "",
    telefono: "",
    email: "",
    instagram: "",
  });
  const [geocodeResult, setGeocodeResult] = useState<GeocodingResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [duplicatesFound, setDuplicatesFound] = useState<DuplicateMatch[]>([]);
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

  // === FUNCIÓN DE DETECCIÓN DE DUPLICADOS ===

  const checkDuplicates = async (
    nombre: string,
    telefono: string,
    lat: number,
    lng: number,
    placeId: string | null
  ): Promise<DuplicateMatch[]> => {
    const duplicates: DuplicateMatch[] = [];
    const seenIds = new Set<string>(); // Para evitar duplicados en la lista

    try {
      // 1. CRÍTICO: Verificar place_id exacto en prospectos
      if (placeId) {
        const { data: exactMatch } = await supabase
          .from("prospectos")
          .select("nombre, direccion, telefono, place_id")
          .eq("place_id", placeId)
          .maybeSingle();

        if (exactMatch) {
          duplicates.push({
            tipo: "prospecto",
            nombre: exactMatch.nombre,
            direccion: exactMatch.direccion,
            telefono: exactMatch.telefono,
            riesgo: "critico",
            razon_match: "Mismo lugar (place_id exacto)"
          });
          seenIds.add(`prospecto-${exactMatch.place_id}`);
        }
      }

      // 2. Buscar prospectos por proximidad geográfica (bounding box)
      const { data: prospectosCercanos } = await supabase
        .from("prospectos")
        .select("nombre, direccion, telefono, latitud, longitud, place_id")
        .gte("latitud", lat - 0.002)
        .lte("latitud", lat + 0.002)
        .gte("longitud", lng - 0.002)
        .lte("longitud", lng + 0.002);

      if (prospectosCercanos) {
        for (const p of prospectosCercanos) {
          const key = `prospecto-${p.place_id}`;
          if (seenIds.has(key)) continue;
          
          const dist = haversineDistance(lat, lng, Number(p.latitud), Number(p.longitud));
          const nameMatch = tokenOverlap(nombre, p.nombre);

          if (dist < 50) {
            duplicates.push({
              tipo: "prospecto",
              nombre: p.nombre,
              direccion: p.direccion,
              telefono: p.telefono,
              distancia_metros: Math.round(dist),
              riesgo: "alto",
              razon_match: `A ${Math.round(dist)}m de distancia`
            });
            seenIds.add(key);
          } else if (dist < 150 && nameMatch > 0.5) {
            duplicates.push({
              tipo: "prospecto",
              nombre: p.nombre,
              direccion: p.direccion,
              telefono: p.telefono,
              distancia_metros: Math.round(dist),
              riesgo: "medio",
              razon_match: `A ${Math.round(dist)}m + nombre similar`
            });
            seenIds.add(key);
          }
        }
      }

      // 3. Buscar client_places por proximidad geográfica
      const { data: clientesCercanos } = await supabase
        .from("client_places")
        .select("client_id, direccion_principal, lat, long")
        .gte("lat", lat - 0.002)
        .lte("lat", lat + 0.002)
        .gte("long", lng - 0.002)
        .lte("long", lng + 0.002);

      if (clientesCercanos && clientesCercanos.length > 0) {
        const clientIds = clientesCercanos.map(c => c.client_id);
        const { data: clientes } = await supabase
          .from("clientes")
          .select("client_id, razon_social, fantasia, telefonos, direccion_principal")
          .in("client_id", clientIds);

        if (clientes) {
          for (const cliente of clientes) {
            const key = `cliente-${cliente.client_id}`;
            if (seenIds.has(key)) continue;

            const clientPlace = clientesCercanos.find(cp => cp.client_id === cliente.client_id);
            if (!clientPlace) continue;

            const dist = haversineDistance(lat, lng, Number(clientPlace.lat), Number(clientPlace.long));
            const clientName = cliente.fantasia || cliente.razon_social || "";
            const nameMatch = tokenOverlap(nombre, clientName);

            if (dist < 50) {
              duplicates.push({
                tipo: "cliente",
                nombre: clientName,
                direccion: cliente.direccion_principal,
                telefono: cliente.telefonos?.[0] || null,
                distancia_metros: Math.round(dist),
                riesgo: "alto",
                razon_match: `Cliente Cupra a ${Math.round(dist)}m`
              });
              seenIds.add(key);
            } else if (dist < 150 && nameMatch > 0.5) {
              duplicates.push({
                tipo: "cliente",
                nombre: clientName,
                direccion: cliente.direccion_principal,
                telefono: cliente.telefonos?.[0] || null,
                distancia_metros: Math.round(dist),
                riesgo: "medio",
                razon_match: `Cliente Cupra a ${Math.round(dist)}m + nombre similar`
              });
              seenIds.add(key);
            }
          }
        }
      }

      // 4. Buscar por teléfono exacto (si se proporcionó)
      if (telefono.trim()) {
        const telefonoNormalizado = normalizePhone(telefono);
        
        if (telefonoNormalizado.length >= 6) {
          // Buscar en prospectos
          const { data: prospectosConTel } = await supabase
            .from("prospectos")
            .select("nombre, direccion, telefono, place_id")
            .not("telefono", "is", null);

          if (prospectosConTel) {
            for (const p of prospectosConTel) {
              const key = `prospecto-${p.place_id}`;
              if (seenIds.has(key)) continue;
              
              if (normalizePhone(p.telefono) === telefonoNormalizado) {
                duplicates.push({
                  tipo: "prospecto",
                  nombre: p.nombre,
                  direccion: p.direccion,
                  telefono: p.telefono,
                  riesgo: "alto",
                  razon_match: "Mismo teléfono"
                });
                seenIds.add(key);
              }
            }
          }

          // Buscar en clientes
          const { data: clientesConTel } = await supabase
            .from("clientes")
            .select("client_id, razon_social, fantasia, telefonos, direccion_principal")
            .not("telefonos", "is", null);

          if (clientesConTel) {
            for (const c of clientesConTel) {
              const key = `cliente-${c.client_id}`;
              if (seenIds.has(key)) continue;

              const matchTel = c.telefonos?.some(t => normalizePhone(t) === telefonoNormalizado);
              if (matchTel) {
                duplicates.push({
                  tipo: "cliente",
                  nombre: c.fantasia || c.razon_social || "",
                  direccion: c.direccion_principal,
                  telefono: c.telefonos?.[0] || null,
                  riesgo: "alto",
                  razon_match: "Mismo teléfono (Cliente Cupra)"
                });
                seenIds.add(key);
              }
            }
          }
        }
      }

      // 5. Buscar por nombre similar (BAJO riesgo)
      const nombreNormalizado = normalizeName(nombre);
      const tokens = nombreNormalizado.split(" ").filter(t => t.length > 2).slice(0, 2);

      if (tokens.length > 0) {
        // Buscar prospectos con nombre similar
        const { data: prospectosNombre } = await supabase
          .from("prospectos")
          .select("nombre, direccion, telefono, place_id")
          .ilike("nombre", `%${tokens[0]}%`)
          .limit(20);

        if (prospectosNombre) {
          for (const p of prospectosNombre) {
            const key = `prospecto-${p.place_id}`;
            if (seenIds.has(key)) continue;

            const overlap = tokenOverlap(nombre, p.nombre);
            if (overlap >= 0.6) {
              duplicates.push({
                tipo: "prospecto",
                nombre: p.nombre,
                direccion: p.direccion,
                telefono: p.telefono,
                riesgo: "bajo",
                razon_match: "Nombre similar"
              });
              seenIds.add(key);
            }
          }
        }

        // Buscar clientes con nombre similar
        const { data: clientesNombre } = await supabase
          .from("clientes")
          .select("client_id, razon_social, fantasia, direccion_principal, telefonos")
          .or(`razon_social.ilike.%${tokens[0]}%,fantasia.ilike.%${tokens[0]}%`)
          .limit(20);

        if (clientesNombre) {
          for (const c of clientesNombre) {
            const key = `cliente-${c.client_id}`;
            if (seenIds.has(key)) continue;

            const clientName = c.fantasia || c.razon_social || "";
            const overlap = tokenOverlap(nombre, clientName);
            if (overlap >= 0.6) {
              duplicates.push({
                tipo: "cliente",
                nombre: clientName,
                direccion: c.direccion_principal,
                telefono: c.telefonos?.[0] || null,
                riesgo: "bajo",
                razon_match: "Nombre similar (Cliente Cupra)"
              });
              seenIds.add(key);
            }
          }
        }
      }

    } catch (error) {
      console.error("Error checking duplicates:", error);
    }

    // Ordenar por nivel de riesgo (crítico primero)
    const riskOrder: Record<RiskLevel, number> = { critico: 0, alto: 1, medio: 2, bajo: 3 };
    return duplicates.sort((a, b) => riskOrder[a.riesgo] - riskOrder[b.riesgo]);
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

      // === NUEVO: Verificar duplicados ===
      setStep("checking_duplicates");

      const duplicates = await checkDuplicates(
        formData.nombre,
        formData.telefono,
        result.lat,
        result.lng,
        result.place_id || null
      );

      if (duplicates.length > 0) {
        setDuplicatesFound(duplicates);
        setStep("duplicates_found");
      } else {
        setStep("confirm");
      }

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

      // Lógica de fallback inteligente para datos geográficos
      const barrioFinal = geocodeResult.barrio 
        || geocodeResult.barrio_fallback_admin2 
        || formData.barrio.trim() 
        || null;

      const comunaFinal = geocodeResult.comuna || null;
      const ciudadFinal = geocodeResult.ciudad || formData.ciudad.trim();
      const provinciaFinal = geocodeResult.provincia || formData.provincia;

      // Insertar prospecto con datos enriquecidos
      const { error: prospectoError } = await supabase
        .from("prospectos")
        .insert({
          place_id: placeId,
          nombre: formData.nombre.trim(),
          direccion: geocodeResult.formatted_address || formData.direccion.trim(),
          barrio: barrioFinal,
          comuna: comunaFinal,
          ciudad: ciudadFinal,
          provincia: provinciaFinal,
          latitud: geocodeResult.lat,
          longitud: geocodeResult.lng,
          telefono: formData.telefono.trim() || null,
          email: formData.email.trim() || null,
          instagram: formData.instagram.trim() || null,
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
    setDuplicatesFound([]);
  };

  const handleContinueAnyway = () => {
    setStep("confirm");
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

  if (step === "checking_duplicates") {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-accent" />
        <p className="text-lg font-medium text-foreground">Verificando duplicados...</p>
        <p className="text-sm text-muted-foreground">Buscando prospectos o clientes similares</p>
      </div>
    );
  }

  if (step === "duplicates_found") {
    const hasCritical = duplicatesFound.some(d => d.riesgo === "critico");
    
    return (
      <div className="space-y-6 py-4">
        <div className="flex items-center justify-center">
          <div className={`flex items-center justify-center w-16 h-16 rounded-full ${hasCritical ? "bg-red-500/20" : "bg-yellow-500/20"}`}>
            <AlertTriangle className={`w-10 h-10 ${hasCritical ? "text-red-500" : "text-yellow-500"}`} />
          </div>
        </div>
        
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-foreground">
            {hasCritical ? "¡Posible duplicado exacto!" : "Posibles duplicados encontrados"}
          </p>
          <p className="text-sm text-muted-foreground">
            Encontramos {duplicatesFound.length} registro(s) similar(es). 
            {hasCritical 
              ? " Se detectó un lugar con el mismo identificador de Google." 
              : " ¿Querés continuar de todas formas?"}
          </p>
        </div>

        {/* Lista de duplicados */}
        <div className="space-y-3 max-h-60 overflow-y-auto">
          {duplicatesFound.map((dup, idx) => {
            const config = riskConfig[dup.riesgo];
            return (
              <div key={idx} className={`rounded-lg p-3 border ${config.bg} ${config.border}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge variant={dup.tipo === "cliente" ? "default" : "secondary"}>
                    {dup.tipo === "cliente" ? "Cliente Cupra" : "Prospecto"}
                  </Badge>
                  <Badge className={`${config.bg} ${config.text} border ${config.border}`}>
                    {config.label}
                  </Badge>
                </div>
                <p className="font-medium text-foreground">{dup.nombre}</p>
                {dup.direccion && (
                  <p className="text-sm text-muted-foreground">{dup.direccion}</p>
                )}
                <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                  {dup.telefono && <span>Tel: {dup.telefono}</span>}
                  <span className={config.text}>{dup.razon_match}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
          <Button onClick={handleContinueAnyway} className="flex-1 wine-button">
            Continuar de todas formas
          </Button>
        </div>
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
    // Calcular valores finales para mostrar al usuario
    const barrioMostrar = geocodeResult.barrio 
      || geocodeResult.barrio_fallback_admin2 
      || formData.barrio.trim() 
      || null;
    const comunaMostrar = geocodeResult.comuna || null;
    const ciudadMostrar = geocodeResult.ciudad || formData.ciudad;
    const provinciaMostrar = geocodeResult.provincia || formData.provincia;

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
              {/* Datos geográficos detallados */}
              <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t border-border mt-2">
                {barrioMostrar && (
                  <p><span className="font-medium">Barrio:</span> {barrioMostrar}</p>
                )}
                {comunaMostrar && (
                  <p><span className="font-medium">Comuna:</span> {comunaMostrar}</p>
                )}
                <p><span className="font-medium">Ciudad:</span> {ciudadMostrar}</p>
                <p><span className="font-medium">Provincia:</span> {provinciaMostrar}</p>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
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

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="Ej: contacto@restaurante.com"
          value={formData.email}
          onChange={(e) => handleInputChange("email", e.target.value)}
          className="bg-input border-border"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="instagram">Instagram</Label>
        <Input
          id="instagram"
          placeholder="Ej: @restaurante_doncarlos"
          value={formData.instagram}
          onChange={(e) => handleInputChange("instagram", e.target.value)}
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
