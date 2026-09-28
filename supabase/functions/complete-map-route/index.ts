import { authorize, corsHeaders, json, RequestError, failure } from "../_shared/location-service.ts";
import { hayGoogleMaps } from "../_shared/google-maps.ts";
import { allClients } from "../_shared/import-batch.ts";
import { carteraDelVendedor, puntosDeCartera, validarSeleccionMapa, ubicacionesPreferidas, type UbicacionMapa } from "../_shared/map-selection.ts";
import { distanciaKm, RADIO_RUTA_KM, VISITAS_POR_DIA } from "../_shared/ruta.ts";
import { hoyArgentina, excluidoPorFeedback, type FeedbackLike } from "../_shared/reglas.ts";
import { evaluarProspectoContraCartera, type ClienteRef } from "../_shared/portfolio-ranking.ts";
import { buscarComplementoMapa, cubrirZonaMapa, descubrirProspectosMapa, mismoProspecto, ordenarProspectos, prospectoDisponible, puntoProspecto, type ProspectoMapa } from "./search.ts";
import { rubroKey } from "../_shared/reglas.ts";

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += 500) {
    const { data, error } = await build(offset, offset + 499);
    if (error) throw new Error("No se pudieron leer los datos para completar la ruta. Reintentá.");
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
  throw new Error("La consulta supera el límite de registros.");
}
function ids(value: unknown, max: number, required = false): string[] {
  if (!Array.isArray(value) || value.length > max || required && !value.length
    || value.some(v => typeof v !== "string" || !v.trim() || v.length > 250) || new Set(value).size !== value.length) {
    throw new RequestError("La selección no es válida. Volvé a elegir los clientes.", 400, "INVALID_SELECTION");
  }
  return value;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { db } = await authorize(req, true);
    const body = await req.json().catch(() => { throw new RequestError("Solicitud inválida", 400, "INVALID_REQUEST"); });
    const clientesIds = ids(body.client_ids, 7, true);
    const conservarIds = ids(body.prospect_ids ?? [], 6);
    const omitirIds = new Set(ids(body.omitir_ids ?? [], 100));
    const rubros = ids(body.rubros ?? [], 20);
    if (typeof body.vendedor_id !== "string" || clientesIds.length + conservarIds.length >= VISITAS_POR_DIA) {
      throw new RequestError("La ruta debe tener entre una y siete visitas antes de completar.", 400, "INVALID_SELECTION");
    }
    const [perfiles, clientes, places] = await Promise.all([
      all((from, to) => db.from("profiles").select("user_id,nombre,activo,rol,perfil_ventas").or("rol.eq.vendedor,perfil_ventas.eq.true").order("user_id").range(from, to)),
      allClients(db),
      all<UbicacionMapa>((from, to) => db.from("client_places")
        .select("id,client_id,lat,long,is_primary,direccion_verificada,direccion_principal,barrio_principal,comuna,google_maps_link")
        .order("id").range(from, to)),
    ]);
    if (!perfiles.some(p => p.user_id === body.vendedor_id && p.activo)) throw new RequestError("El vendedor no está activo.", 422, "INVALID_VENDOR");
    const cartera = carteraDelVendedor(clientes, perfiles, body.vendedor_id);
    const elegidos = cartera.filter(c => clientesIds.includes(c.client_id));
    const { puntos: clientesPuntos } = puntosDeCartera(elegidos, places);
    if (clientesPuntos.length !== clientesIds.length) throw new RequestError("La cartera o las ubicaciones cambiaron. Volvé a cargar el vendedor.", 409, "STALE_SELECTION");
    const selectionError = validarSeleccionMapa(clientesPuntos);
    if (selectionError) throw new RequestError(selectionError, 422, "INVALID_ROUTE");
    // El centro se recalcula desde la base, nunca se acepta una coordenada arbitraria del navegador.
    const centro = { lat: clientesPuntos.reduce((sum, p) => sum + p.lat, 0) / clientesPuntos.length,
      lng: clientesPuntos.reduce((sum, p) => sum + p.lng, 0) / clientesPuntos.length };
    const dLat = RADIO_RUTA_KM / 110.5;
    const dLng = RADIO_RUTA_KM / (110.5 * Math.cos(centro.lat * Math.PI / 180));
    const hoy = hoyArgentina();
    const inicio = `${hoy}T03:00:00Z`, fin = new Date(Date.parse(inicio) + 86400000).toISOString();
    const [base, asignaciones, feedbacks, descartados] = await Promise.all([
      all<ProspectoMapa>((from, to) => db.from("prospectos").select("*")
        .gte("latitud", centro.lat - dLat).lte("latitud", centro.lat + dLat)
        .gte("longitud", centro.lng - dLng).lte("longitud", centro.lng + dLng).order("place_id").range(from, to)),
      all((from, to) => db.from("asignaciones_vendedores_clientes").select("prospecto_place_id")
        .not("prospecto_place_id", "is", null)
        .or(`fecha_programada.eq.${hoy},and(fecha_programada.is.null,created_at.gte.${inicio},created_at.lt.${fin}),and(visited_at.gte.${inicio},visited_at.lt.${fin})`)
        .order("id").range(from, to)),
      all((from, to) => db.from("cliente_feedbacks").select("prospecto_place_id,feedback,motivo_no_visita,created_at")
        .not("prospecto_place_id", "is", null).order("id").range(from, to)),
      all((from, to) => db.from("prospect_discovery_queue").select("place_id").eq("estado", "DESCARTADO").order("id").range(from, to)),
    ]);
    const bloqueados = new Set([...asignaciones.map(a => a.prospecto_place_id), ...descartados.map(d => d.place_id)]);
    const comentarios = new Map<string, FeedbackLike[]>();
    for (const f of feedbacks) if (f.prospecto_place_id) comentarios.set(f.prospecto_place_id, [...(comentarios.get(f.prospecto_place_id) || []), f]);
    for (const [id, list] of comentarios) if (excluidoPorFeedback(list)) bloqueados.add(id);
    const clientesGoogle = new Set<string>();
    for (const p of places) {
      const id = p.google_maps_link?.match(/(?:[?&]query_place_id=|place_id:)([^&]+)/)?.[1];
      if (id) { try { clientesGoogle.add(decodeURIComponent(id)); } catch { /* enlace viejo no utilizable */ } }
    }
    const ubicaciones = ubicacionesPreferidas(places);
    const refs: ClienteRef[] = clientes.flatMap(c => {
      const p = ubicaciones.get(c.client_id);
      return p ? [...new Set([c.fantasia, c.razon_social].filter(Boolean))].map(name => ({ name, lat: p.lat!, lng: p.long! })) : [];
    });
    const disponible = (p: ProspectoMapa) => prospectoDisponible(p) && !bloqueados.has(p.place_id)
      && !bloqueados.has(p.google_place_id || "") && !clientesGoogle.has(p.google_place_id || p.place_id)
      && evaluarProspectoContraCartera(p, refs).estado === "nuevo";
    const conservar = base.filter(p => conservarIds.includes(p.place_id));
    if (conservar.length !== conservarIds.length || conservar.some(p => !disponible(p))) {
      throw new RequestError("Uno de los prospectos ya no está disponible. Quitalo de la ruta y reintentá.", 409, "STALE_PROSPECTS");
    }
    const routeError = validarSeleccionMapa([...clientesPuntos, ...conservar.map(p => puntoProspecto(p, clientesPuntos))]);
    if (routeError) throw new RequestError(routeError, 422, "INVALID_ROUTE");
    const deadline = Date.now() + 45_000;
    let consultas = 0;
    const consumir = () => { if (++consultas > 60 || Date.now() >= deadline) throw new Error("Se agotó el tiempo de búsqueda"); };
    const objetivo = VISITAS_POR_DIA - clientesPuntos.length - conservar.length;
    const result = await buscarComplementoMapa({
      clientes: clientesPuntos, objetivo, base, rubros,
      pasaGate: p => disponible(p) && !omitirIds.has(p.place_id) && !omitirIds.has(p.google_place_id || "")
        && !conservar.some(prev => mismoProspecto(prev, p)),
      descubrir: hayGoogleMaps() ? (center, radius, types) => descubrirProspectosMapa(center, radius, types, deadline, consumir) : undefined,
      cubrirZona: hayGoogleMaps() ? (center, types) => cubrirZonaMapa(center, types, deadline, consumir) : undefined,
    });
    const conocidos = new Set(base.map(p => p.place_id));
    const nuevos = result.candidatos.filter(p => !conocidos.has(p.place_id));
    if (nuevos.length) {
      const { error } = await db.from("prospectos").upsert(nuevos, { onConflict: "place_id", ignoreDuplicates: true });
      if (error) throw new Error("No se pudieron guardar los prospectos encontrados. Reintentá antes de asignar.");
    }
    // Releer mantiene las ediciones/conversiones concurrentes y los rubros calculados por la base.
    const candidateIds = result.candidatos.map(p => p.place_id);
    let final: ProspectoMapa[] = [];
    if (candidateIds.length) {
      const { data, error } = await db.from("prospectos").select("*").in("place_id", candidateIds);
      if (error) throw new Error("No se pudo verificar la disponibilidad final de los prospectos.");
      const byId = new Map<string, ProspectoMapa>((data || []).map(p => [p.place_id, p]));
      final = ordenarProspectos(candidateIds.map(id => byId.get(id)).filter((p): p is ProspectoMapa => Boolean(p) && disponible(p!)
        && (!rubros.length || rubros.some(r => rubroKey(r) === rubroKey(p!.rubro)))
        && distanciaKm(centro, { lat: p!.latitud!, lng: p!.longitud! }) <= RADIO_RUTA_KM), centro);
    }
    const seleccionados = final.slice(0, objetivo);
    return json({ success: true, centro, radio_busqueda_m: result.radio_m,
      clientes: clientesPuntos, prospectos: final.map(p => puntoProspecto(p, clientesPuntos)),
      elegidos: seleccionados.map(p => p.place_id), faltantes: objetivo - seleccionados.length,
      avisos: result.avisos });
  } catch (error) { return failure(error); }
}

if (import.meta.main) Deno.serve(handler);
