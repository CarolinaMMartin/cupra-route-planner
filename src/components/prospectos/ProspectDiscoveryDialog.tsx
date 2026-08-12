import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, MapPin, Search, Star, Store, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface ProspectSearchResult {
  place_id: string;
  nombre: string;
  direccion: string | null;
  tipo_principal: string | null;
  google_maps_uri: string;
  rating: number | null;
  total_ratings: number | null;
  nivel_precio: string | null;
  premium_score: number;
  queued: boolean;
  existing_prospect: boolean;
  existing_client: { client_id: string; nombre: string } | null;
  attributions: Array<{ provider?: string; providerUri?: string }>;
}

interface QueueItem {
  id: string;
  place_id: string;
  estado: "NUEVO" | "EN_REVISION";
  consulta: string;
  zona: string | null;
  notas: string | null;
  discovered_at: string;
}

interface ProspectDiscoveryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: () => void;
}

const formatType = (type: string | null) => type
  ? type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  : "Comercio";

const priceLabel = (level: string | null) => {
  const labels: Record<string, string> = {
    PRICE_LEVEL_INEXPENSIVE: "$",
    PRICE_LEVEL_MODERATE: "$$",
    PRICE_LEVEL_EXPENSIVE: "$$$",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  };
  return level ? labels[level] || level : null;
};

const queueMapsUrl = (placeId: string) => (
  `https://www.google.com/maps/search/?api=1&query=place&query_place_id=${encodeURIComponent(placeId)}`
);

export function ProspectDiscoveryDialog({ open, onOpenChange, onConverted }: ProspectDiscoveryDialogProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState("vinoteca premium");
  const [zone, setZone] = useState("");
  const [includedType, setIncludedType] = useState("liquor_store");
  const [results, setResults] = useState<ProspectSearchResult[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [queueingId, setQueueingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkQueueing, setIsBulkQueueing] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);

  const selectableResults = results.filter(
    (result) => !result.queued && !result.existing_prospect && !result.existing_client,
  );
  const allSelected = selectableResults.length > 0 && selectableResults.every((r) => selectedIds.includes(r.place_id));

  const toggleSelection = (placeId: string) => {
    setSelectedIds((current) => current.includes(placeId)
      ? current.filter((id) => id !== placeId)
      : [...current, placeId]);
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : selectableResults.map((r) => r.place_id));
  };

  const loadQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const { data, error } = await supabase.functions.invoke("prospect-discovery", {
        body: { action: "list" },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "No se pudo leer la cola");
      setQueue(data.queue || []);
    } catch (error) {
      toast({
        title: "No se pudo cargar la cola",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setIsLoadingQueue(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) loadQueue();
  }, [open, loadQueue]);

  const handleSearch = async () => {
    if (query.trim().length < 3) {
      toast({ title: "Escribí qué negocio querés buscar", variant: "destructive" });
      return;
    }

    setIsSearching(true);
    setResults([]);
    setSelectedIds([]);
    try {
      const { data, error } = await supabase.functions.invoke("prospect-discovery", {
        body: {
          action: "search",
          query: query.trim(),
          zone: zone.trim() || undefined,
          includedType: includedType === "all" ? null : includedType,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "La búsqueda no pudo completarse");
      setResults(data.results || []);
      if (!data.results?.length) {
        toast({ title: "Sin resultados", description: "Probá otra zona o quitá el filtro de tipo." });
      }
    } catch (error) {
      toast({
        title: "Error en la búsqueda",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const promoteQueue = async (placeIds: string[]) => {
    if (placeIds.length === 0) return;
    setIsPromoting(true);
    try {
      const { data, error } = await supabase.functions.invoke("prospect-discovery", {
        body: { action: "promote", placeIds },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "No se pudo convertir");
      setQueue((current) => current.filter((item) => !placeIds.includes(item.place_id)));
      toast({
        title: `${data.created} agregados a Prospectos`,
        description: data.skipped?.length
          ? `${data.skipped.length} no se pudieron convertir.`
          : "Ya aparecen en la tabla de la pantalla de Prospectos.",
      });
      onConverted?.();
    } catch (error) {
      toast({
        title: "No se pudo convertir",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setIsPromoting(false);
    }
  };

  // Un solo paso: guarda el lugar en la cola y lo convierte en prospecto operativo.
  const addAsProspects = async (
    items: Array<{ place_id: string; nombre: string }>,
  ): Promise<boolean> => {
    if (items.length === 0) return false;
    const placeIds = items.map((item) => item.place_id);
    const names: Record<string, string> = {};
    for (const item of items) names[item.place_id] = item.nombre;

    const { data, error } = await supabase.functions.invoke("prospect-discovery", {
      body: {
        action: "queue",
        placeIds,
        names,
        query: query.trim(),
        zone: zone.trim() || undefined,
      },
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || "No se pudo guardar el prospecto");

    const { data: promoted, error: promoteError } = await supabase.functions.invoke("prospect-discovery", {
      body: { action: "promote", placeIds },
    });
    if (promoteError) throw new Error(promoteError.message);
    if (!promoted?.success) throw new Error(promoted?.error || "No se pudo convertir a prospecto");

    setResults((current) => current.map((item) => (
      placeIds.includes(item.place_id) ? { ...item, queued: true, existing_prospect: true } : item
    )));
    await loadQueue();
    onConverted?.();

    const created = promoted.created ?? placeIds.length;
    toast({
      title: created === 1
        ? "Prospecto agregado"
        : `${created} prospectos agregados`,
      description: promoted.skipped?.length
        ? `${promoted.skipped.length} no se pudieron agregar (datos incompletos en Google).`
        : "Ya aparecen en la tabla de Prospectos.",
    });
    return true;
  };

  const handleAddOne = async (result: ProspectSearchResult) => {
    setQueueingId(result.place_id);
    try {
      await addAsProspects([{ place_id: result.place_id, nombre: result.nombre }]);
    } catch (error) {
      toast({
        title: "No se pudo agregar",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setQueueingId(null);
    }
  };

  const handleBulkAdd = async () => {
    if (selectedIds.length === 0) return;
    setIsBulkQueueing(true);
    try {
      const items = results
        .filter((result) => selectedIds.includes(result.place_id))
        .map((result) => ({ place_id: result.place_id, nombre: result.nombre }));
      await addAsProspects(items);
      setSelectedIds([]);
    } catch (error) {
      toast({
        title: "No se pudieron agregar",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setIsBulkQueueing(false);
    }
  };


  const discardQueueItem = async (item: QueueItem) => {
    try {
      const { data, error } = await supabase.functions.invoke("prospect-discovery", {
        body: { action: "update_status", placeId: item.place_id, status: "DESCARTADO" },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "No se pudo descartar");
      setQueue((current) => current.filter((queued) => queued.place_id !== item.place_id));
      setResults((current) => current.map((result) => (
        result.place_id === item.place_id ? { ...result, queued: false } : result
      )));
    } catch (error) {
      toast({
        title: "No se pudo actualizar",
        description: error instanceof Error ? error.message : "Error inesperado",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Buscar nuevos prospectos</DialogTitle>
          <DialogDescription>
            Explorá comercios de CABA y guardá lugares para investigar. Los datos del resultado no se copian a la base.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="prospect-query">Qué buscar</Label>
            <Input
              id="prospect-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ej. vinoteca premium"
              onKeyDown={(event) => { if (event.key === "Enter") handleSearch(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prospect-zone">Barrio o zona</Label>
            <Input
              id="prospect-zone"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              placeholder="Ej. Palermo"
              onKeyDown={(event) => { if (event.key === "Enter") handleSearch(); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={includedType} onValueChange={setIncludedType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="liquor_store">Vinotecas</SelectItem>
                <SelectItem value="wine_bar">Wine bars</SelectItem>
                <SelectItem value="restaurant">Restaurantes</SelectItem>
                <SelectItem value="bar">Bares</SelectItem>
                <SelectItem value="all">Sin filtro estricto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSearch} disabled={isSearching} className="gap-2">
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>

        {results.length > 0 && (
          <section className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-medium text-sm">Resultados transitorios ({results.length})</h3>
                {selectableResults.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                    Seleccionar todos ({selectableResults.length})
                  </label>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" disabled={selectedIds.length === 0 || isBulkQueueing} onClick={handleBulkQueue} className="gap-2">
                  {isBulkQueueing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Agregar {selectedIds.length > 0 ? `${selectedIds.length} ` : ""}a pendientes
                </Button>
                <span translate="no" className="text-xs font-normal text-[#5e5e5e] whitespace-nowrap">Google Maps</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {results.map((result) => {
                const blocked = result.queued || result.existing_prospect || Boolean(result.existing_client);
                return (
                  <article key={result.place_id} className="rounded-lg border bg-background p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex items-start gap-2">
                        {!blocked && (
                          <Checkbox
                            className="mt-1"
                            checked={selectedIds.includes(result.place_id)}
                            onCheckedChange={() => toggleSelection(result.place_id)}
                          />
                        )}
                        <div className="min-w-0">
                        <p className="font-medium truncate">{result.nombre}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{result.direccion || "Sin dirección informada"}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0">Score {result.premium_score}</Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline"><Store className="h-3 w-3 mr-1" />{formatType(result.tipo_principal)}</Badge>
                      {result.rating !== null && (
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                          {result.rating.toFixed(1)} ({result.total_ratings || 0})
                        </span>
                      )}
                      {priceLabel(result.nivel_precio) && <span>{priceLabel(result.nivel_precio)}</span>}
                    </div>

                    {result.existing_client && (
                      <p className="text-xs text-amber-600">Posible cliente existente: {result.existing_client.nombre}</p>
                    )}
                    {result.existing_prospect && <p className="text-xs text-amber-600">Ya existe como prospecto operativo.</p>}
                    {result.queued && <p className="text-xs text-muted-foreground">Ya está en pendientes.</p>}

                    {result.attributions?.length > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        {result.attributions.map((attribution, index) => attribution.providerUri ? (
                          <a key={`${attribution.provider}-${index}`} href={attribution.providerUri} target="_blank" rel="noreferrer" className="underline mr-2">
                            {attribution.provider || "Fuente"}
                          </a>
                        ) : <span key={index} className="mr-2">{attribution.provider}</span>)}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" asChild className="flex-1 gap-1.5">
                        <a href={result.google_maps_uri} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> Ver en Maps
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={blocked || queueingId === result.place_id}
                        onClick={() => handleQueue(result)}
                      >
                        {queueingId === result.place_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Agregar a pendientes"}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Se conserva únicamente el identificador del lugar y datos internos de seguimiento. Verificá el comercio antes de cargarlo como prospecto operativo.
            </p>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">Pendientes de investigación</h3>
              <Badge variant="outline">{queue.length}</Badge>
            </div>
            {queue.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                className="gap-2"
                disabled={isPromoting}
                onClick={() => promoteQueue(queue.map((item) => item.place_id))}
              >
                {isPromoting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Convertir todos a prospectos
              </Button>
            )}
          </div>

          {isLoadingQueue ? (
            <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : queue.length === 0 ? (
            <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
              Todavía no hay lugares pendientes.
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {queue.map((item) => (
                <div key={item.id} className="p-3 flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.notas || item.consulta}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.consulta} · {item.zona || "Toda CABA"} · {new Date(item.discovered_at).toLocaleDateString("es-AR")}
                    </p>
                  </div>
                  <Badge variant="secondary" className="hidden sm:inline-flex">{item.estado === "NUEVO" ? "Nuevo" : "En revisión"}</Badge>
                  <Button variant="ghost" size="icon" asChild title="Abrir en Google Maps">
                    <a href={queueMapsUrl(item.place_id)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPromoting}
                    onClick={() => promoteQueue([item.place_id])}
                    title="Crear prospecto operativo"
                  >
                    Convertir
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => discardQueueItem(item)} title="Descartar">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
