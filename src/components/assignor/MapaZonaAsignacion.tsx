import { guardarAsignaciones } from "@/lib/asignaciones";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, Search, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SegmentFilters } from "@/components/shared/SegmentFilters";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { geoBarrios, geoComunas } from "@/data/geoBuenosAires";
import { GOOGLE_MAPS_BROWSER_KEY, loadGoogleMaps } from "@/lib/googleMaps";
import { createStateMarkerIcon } from "@/lib/vendorColors";
import {
  claveTexto,
  colorEstado,
  diasSinComprar,
  ESTADOS,
  estadoDe,
  FILTROS_VACIOS,
  filtrarPorSegmentos,
  type FiltrosSegmento,
  labelEstado,
} from "@/lib/segmentos";
import { fetchAllRows, fetchInChunks } from "@/lib/supabaseQuery";
import { toTitleCase } from "@/lib/format";

interface VendedorOpcion { id: string; nombre: string }

interface Punto {
  key: string;
  tipo: "cliente" | "prospecto";
  id: string; // client_id o place_id
  nombre: string;
  lat: number;
  lng: number;
  direccion: string;
  barrio: string | null;
  comuna: string | null;
  rubro: string | null;
  estado: string;
  vendedor: string | null;
  dias: number | null;
  ventas: number | null;
  telefono: string | null;
}

const MAX_PUNTOS = 3000;
const coordenadasValidas = (lat: unknown, lng: unknown) =>
  lat !== null && lat !== undefined && lat !== "" && lng !== null && lng !== undefined && lng !== "" &&
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
  Number(lat) >= -60 && Number(lat) <= -20 && Number(lng) >= -80 && Number(lng) <= -40;

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));

const pesos = (n: number | null) => (n ? `$${Math.round(n).toLocaleString("es-AR")}` : "—");

const enAreaTexto = (valor: string | null | undefined, elegidos: string[]) => {
  if (elegidos.length === 0) return true;
  const k = claveTexto(valor);
  return elegidos.some((e) => {
    const ke = claveTexto(e);
    return k === ke || k.startsWith(`${ke} `);
  });
};

/**
 * Mapa de la zona: muestra TODOS los clientes y prospectos de las comunas/barrios
 * elegidos, con color por estado (activo, inactivo, perdido, potencial), rubro en
 * la ficha, y permite armar la ruta de un vendedor tocando los puntos.
 * Asigna VISITAS (no cambia el vendedor dueño de la cartera).
 */
export default function MapaZonaAsignacion({ vendedores }: { vendedores: VendedorOpcion[] }) {
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoRef = useRef<google.maps.InfoWindow | null>(null);

  const [comunas, setComunas] = useState<string[]>([]);
  const [barrios, setBarrios] = useState<string[]>([]);
  const [segmentos, setSegmentos] = useState<FiltrosSegmento>(FILTROS_VACIOS);
  const [puntos, setPuntos] = useState<Punto[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorMapa, setErrorMapa] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [vendedorId, setVendedorId] = useState<string>("");
  const [asignando, setAsignando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const comunasOpciones = useMemo(() => geoComunas([]).map((c) => ({ value: c, label: c })), []);
  const barriosOpciones = useMemo(() => geoBarrios([], comunas).map((b) => ({ value: b, label: b })), [comunas]);

  // Al salir de la pantalla se sacan los marcadores del mapa.
  useEffect(() => () => {
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();
  }, []);

  // ---- Mapa ----
  useEffect(() => {
    loadGoogleMaps(GOOGLE_MAPS_BROWSER_KEY)
      .then(() => {
        if (!mapRef.current) return;
        setMap(new google.maps.Map(mapRef.current, {
          zoom: 12,
          center: { lat: -34.6037, lng: -58.3816 },
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        }));
        infoRef.current = new google.maps.InfoWindow();
      })
      .catch((e) => setErrorMapa(`No se pudo cargar Google Maps: ${e.message}`));
  }, []);

  // ---- Datos de la zona ----
  const cargarZona = async () => {
    if (comunas.length === 0 && barrios.length === 0) {
      toast({ variant: "destructive", title: "Elegí una zona", description: "Seleccioná al menos una comuna o un barrio." });
      return;
    }
    setCargando(true);
    setAviso(null);
    setSeleccion([]);
    setPuntos([]);
    // Los marcadores guardan los datos del punto en su click: se recrean con cada carga.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();
    infoRef.current?.close();
    try {
      // Con solo comunas elegidas, también se buscan sus barrios: muchos registros
      // tienen barrio pero no comuna cargada.
      const barriosZona = barrios.length > 0 ? barrios : geoBarrios([], comunas);
      const comunasZona = barrios.length > 0 ? [] : comunas;
      const enZona = (barrio: string | null | undefined, comuna: string | null | undefined) =>
        (barriosZona.length > 0 && enAreaTexto(barrio, barriosZona) && Boolean(barrio)) ||
        (comunasZona.length > 0 && Boolean(comuna) && enAreaTexto(comuna, comunasZona));
      // Sin comodines ni comas; letras con acento → "_" para que "Núñez" encuentre "Nunez".
      const limpio = (v: string) => v.replace(/[%,()]/g, " ").trim().replace(/[^\x20-\x7E]/g, "_");
      const orLugares = [
        ...comunasZona.map((c) => `comuna.ilike.${limpio(c)}`),
        ...barriosZona.map((b) => `barrio_principal.ilike.%${limpio(b)}%`),
      ].join(",");
      const places = await fetchAllRows((from, to) =>
        supabase.from("client_places")
          .select("client_id, lat, long, barrio_principal, comuna, direccion_principal")
          .eq("is_primary", true)
          .or(orLugares)
          .order("client_id")
          .range(from, to));
      const placesZona = places.filter((p) =>
        coordenadasValidas(p.lat, p.long) &&
        enZona(p.barrio_principal, p.comuna));
      const clientes = await fetchInChunks(placesZona.map((p) => p.client_id), (chunk) =>
        supabase.from("clientes")
          .select("client_id, razon_social, fantasia, rubro, canal, categoria_volumen, ultima_compra, dias_desde_ultima_compra, vendedor_actual, vendedor_principal, monto_total_historico, telefonos, excluir_recomendaciones")
          .in("client_id", chunk));
      const clientePorId = new Map(clientes.map((c) => [c.client_id, c]));

      const orProspectos = [
        ...comunasZona.map((c) => `comuna.ilike.${limpio(c)}`),
        ...barriosZona.flatMap((b) => [`barrio.ilike.%${limpio(b)}%`, `ciudad.ilike.%${limpio(b)}%`]),
      ].join(",");
      const prospectos = await fetchAllRows((from, to) =>
        supabase.from("prospectos")
          .select("place_id, nombre, direccion, barrio, comuna, ciudad, latitud, longitud, rubro, telefono, es_cliente_cupra, client_id, estado_negocio")
          .eq("es_cliente_cupra", false)
          .or(orProspectos)
          .order("place_id")
          .range(from, to));

      const lista: Punto[] = [];
      for (const p of placesZona) {
        const c = clientePorId.get(p.client_id);
        if (!c || c.excluir_recomendaciones) continue;
        lista.push({
          key: `C:${c.client_id}`, tipo: "cliente", id: c.client_id,
          nombre: c.fantasia || c.razon_social || "Sin nombre",
          lat: Number(p.lat), lng: Number(p.long),
          direccion: p.direccion_principal || "", barrio: p.barrio_principal, comuna: p.comuna,
          rubro: c.rubro ?? null, estado: estadoDe(c),
          vendedor: c.vendedor_actual || c.vendedor_principal || null,
          dias: diasSinComprar(c), ventas: Number(c.monto_total_historico) || null,
          telefono: c.telefonos?.[0] ?? null,
        });
      }
      for (const p of prospectos) {
        if (p.client_id || p.estado_negocio === "CLOSED_PERMANENTLY" || p.estado_negocio === "CLOSED_TEMPORARILY") continue;
        const lat = Number(p.latitud), lng = Number(p.longitud);
        if (!coordenadasValidas(p.latitud, p.longitud)) continue;
        if (!enZona(p.barrio || p.ciudad, p.comuna)) continue;
        lista.push({
          key: `P:${p.place_id}`, tipo: "prospecto", id: p.place_id, nombre: p.nombre,
          lat, lng, direccion: p.direccion || "", barrio: p.barrio, comuna: p.comuna,
          rubro: p.rubro ?? null, estado: "POTENCIAL", vendedor: null, dias: null, ventas: null,
          telefono: p.telefono ?? null,
        });
      }
      setPuntos(lista);
      if (lista.length === 0) setAviso("No hay clientes ni prospectos con ubicación en esa zona.");
    } catch (e: unknown) {
      console.error(e);
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "No se pudo cargar la zona" });
    } finally {
      setCargando(false);
    }
  };

  const filtrados = useMemo(() => filtrarPorSegmentos(puntos, segmentos, (p) => ({
    estado: p.estado, rubro: p.rubro, vendedor: p.vendedor,
  })), [puntos, segmentos]);
  const visibles = useMemo(() => filtrados.slice(0, MAX_PUNTOS), [filtrados]);

  const conteo = useMemo(() => {
    const m = new Map<string, number>();
    visibles.forEach((p) => m.set(p.estado, (m.get(p.estado) || 0) + 1));
    return m;
  }, [visibles]);

  const vendedoresCartera = useMemo(() => {
    const set = new Map<string, string>();
    puntos.forEach((p) => p.vendedor && set.set(claveTexto(p.vendedor), p.vendedor));
    return [...set.values()].sort().map((v) => ({ value: v, label: toTitleCase(v) }));
  }, [puntos]);

  const toggle = (key: string) =>
    setSeleccion((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  // ---- Marcadores ----
  useEffect(() => {
    if (!map) return;
    const markers = markersRef.current;
    const visiblesKeys = new Set(visibles.map((p) => p.key));
    markers.forEach((m, key) => {
      if (!visiblesKeys.has(key)) { m.setMap(null); markers.delete(key); }
    });
    const bounds = new google.maps.LatLngBounds();
    for (const p of visibles) {
      const elegido = seleccion.includes(p.key);
      let marker = markers.get(p.key);
      if (!marker) {
        marker = new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map, title: p.nombre });
        marker.addListener("click", () => abrirFicha(p, marker!));
        markers.set(p.key, marker);
      }
      marker.setIcon(createStateMarkerIcon(p.estado, elegido ? "#111827" : undefined, elegido ? 1.25 : 0.85));
      marker.setZIndex(elegido ? 3 : 1);
      bounds.extend({ lat: p.lat, lng: p.lng });
    }
    if (visibles.length > 0 && seleccion.length === 0) map.fitBounds(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visibles, seleccion]);

  const abrirFicha = (p: Punto, marker: google.maps.Marker) => {
    const div = document.createElement("div");
    div.style.cssText = "padding:6px;max-width:260px;color:#111827;font-family:system-ui,sans-serif";
    div.innerHTML = `
      <h3 style="margin:0 0 6px;font-weight:600;font-size:14px">${esc(p.nombre)}</h3>
      <span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:#fff;background:${colorEstado(p.estado)}">${esc(labelEstado(p.estado))}${p.tipo === "prospecto" ? " · prospecto" : ""}</span>
      ${p.rubro ? `<p style="margin:6px 0 0;font-size:12px"><strong>Rubro:</strong> ${esc(p.rubro)}</p>` : ""}
      <p style="margin:6px 0 0;font-size:12px;color:#4B5563">${esc(p.direccion)}${p.barrio ? ` · ${esc(p.barrio)}` : ""}</p>
      ${p.vendedor ? `<p style="margin:4px 0 0;font-size:12px">Cartera de: ${esc(toTitleCase(p.vendedor))}</p>` : ""}
      ${p.tipo === "cliente" ? `<p style="margin:4px 0 0;font-size:12px">${p.dias != null ? `${p.dias} días sin comprar` : "Sin compras registradas"} · Ventas: ${esc(pesos(p.ventas))}</p>` : ""}
      ${p.telefono ? `<p style="margin:4px 0 0;font-size:12px">Tel: ${esc(p.telefono)}</p>` : ""}
    `;
    const boton = document.createElement("button");
    const actualizar = () => {
      const elegido = seleccionRef.current.includes(p.key);
      boton.textContent = elegido ? "Quitar de la ruta" : "Agregar a la ruta";
      boton.style.cssText = `margin-top:8px;padding:6px 10px;border-radius:6px;border:0;cursor:pointer;font-size:12px;font-weight:600;color:#fff;background:${elegido ? "#6b7280" : "#111827"}`;
    };
    boton.addEventListener("click", () => {
      toggle(p.key);
      window.setTimeout(actualizar, 0);
    });
    actualizar();
    div.appendChild(boton);
    infoRef.current?.setContent(div);
    infoRef.current?.open({ map: map!, anchor: marker });
  };

  // Referencia viva de la selección para el botón dentro de la ficha.
  const seleccionRef = useRef<string[]>([]);
  useEffect(() => { seleccionRef.current = seleccion; }, [seleccion]);

  const elegidos = useMemo(() => {
    const porKey = new Map(puntos.map((p) => [p.key, p]));
    return seleccion.map((k) => porKey.get(k)).filter(Boolean) as Punto[];
  }, [seleccion, puntos]);

  // ---- Asignar visitas ----
  const asignar = async () => {
    const vendedor = vendedores.find((v) => v.id === vendedorId);
    if (!vendedor || elegidos.length === 0) return;
    setAsignando(true);
    try {
      const clientIds = elegidos.filter((p) => p.tipo === "cliente").map((p) => p.id);
      const placeIds = elegidos.filter((p) => p.tipo === "prospecto").map((p) => p.id);

      const filas = [
        ...clientIds.map((client_id) => ({ vendedor_id: vendedor.id, client_id, es_prospecto: false, origen_asignacion: "asignador" })),
        ...placeIds.map((prospecto_place_id) => ({ vendedor_id: vendedor.id, prospecto_place_id, es_prospecto: true, origen_asignacion: "asignador" })),
      ];
      await guardarAsignaciones(filas);

      toast({ title: "Visitas asignadas", description: `${filas.length} visita${filas.length === 1 ? "" : "s"} para ${vendedor.nombre}.` });
      setSeleccion([]);
    } catch (e: unknown) {
      console.error(e);
      toast({ variant: "destructive", title: "No se pudo asignar", description: e instanceof Error ? e.message : "Error al guardar las asignaciones" });
    } finally {
      setAsignando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Comuna</Label>
          <MultiSelect options={comunasOpciones} selected={comunas} onChange={(v) => { setComunas(v); setBarrios([]); }} placeholder="Elegí comunas" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Barrio</Label>
          <MultiSelect options={barriosOpciones} selected={barrios} onChange={setBarrios} placeholder="Todos los de la comuna" />
        </div>
        <Button onClick={cargarZona} disabled={cargando} className="gap-2">
          {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Mostrar la zona en el mapa
        </Button>
      </div>

      <SegmentFilters
        value={segmentos}
        onChange={setSegmentos}
        campos={["estados", "rubros", "vendedores"]}
        vendedores={vendedoresCartera}
        titulo="Qué mostrar"
      />

      {aviso && <p className="text-xs text-amber-600">{aviso}</p>}
      {filtrados.length > MAX_PUNTOS && <p className="text-xs text-amber-600">Se muestran {MAX_PUNTOS} de {filtrados.length} puntos. Filtrá por estado o rubro para acotar el mapa.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="relative rounded-lg border overflow-hidden h-[560px]">
          {errorMapa ? (
            <div className="p-6 text-sm text-destructive">{errorMapa}</div>
          ) : (
            <div ref={mapRef} className="w-full h-full" />
          )}
          <div className="absolute bottom-3 left-3 bg-background/95 p-3 rounded-lg shadow border text-xs space-y-1">
            {ESTADOS.map((e) => (
              <div key={e.value} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: e.color }} />
                <span>{e.plural}</span>
                <span className="text-muted-foreground ml-auto pl-3">{conteo.get(e.value) || 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-3 h-fit">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Ruta en armado</span>
            <Badge variant="secondary" className="ml-auto">{elegidos.length}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">Tocá un punto del mapa y elegí “Agregar a la ruta”.</p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {elegidos.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorEstado(p.estado) }} />
                <span className="truncate flex-1">{p.nombre}</span>
                {p.rubro && <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{p.rubro}</span>}
                <button type="button" onClick={() => toggle(p.key)} aria-label="Quitar">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Vendedor</Label>
            <SearchableSelect
              options={vendedores.map((v) => ({ value: v.id, label: v.nombre }))}
              value={vendedorId}
              onValueChange={setVendedorId}
              placeholder="Elegí el vendedor"
              searchPlaceholder="Buscar vendedor..."
            />
          </div>
          {elegidos.length > 0 && elegidos.length !== 8 && (
            <p className="text-xs text-muted-foreground">La ruta estándar es de 8 visitas ({elegidos.length} elegidas).</p>
          )}
          <Button className="w-full gap-2" disabled={!vendedorId || elegidos.length === 0 || asignando} onClick={asignar}>
            {asignando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
            Asignar {elegidos.length || ""} visita{elegidos.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </div>
  );
}
