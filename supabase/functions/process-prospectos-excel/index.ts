import { authorize, corsHeaders, failure, json, RequestError } from "../_shared/location-service.ts";
import { allClients, beginImport } from "../_shared/import-batch.ts";
import { argentinaCoordinates, coordinateNumber } from "../_shared/import-values.ts";

const norm = (s: unknown) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const pick = (row: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const key = Object.keys(row).find(k => norm(k) === norm(name));
    const value = key ? row[key] : null;
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return null;
};
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  let batchId: string | undefined;
  let db: Awaited<ReturnType<typeof authorize>>["db"] | undefined;
  try {
    const auth = await authorize(req, true); db = auth.db;
    const body = await req.json();
    const { rows, fileMetadata = {} } = body;
    if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new RequestError("Cargá entre 1 y 5.000 filas de prospectos", 400, "BAD_REQUEST");
    const started = await beginImport(db, body.requestId, {
      tipo: "prospectos", version_etl: "prospectos-v2.0", archivo_nombre: fileMetadata.name || "prospectos.xlsx",
      archivo_sha256: fileMetadata.sha256 || null, hoja: fileMetadata.sheetName || null, filas_origen: rows.length,
      usuario_id: auth.user.id, usuario_email: auth.user.email || null,
    });
    if (started.response) return json(started.response);
    batchId = started.id;
    const clients = await allClients(db);
    const cuits = new Map<string, string[]>();
    for (const c of clients) {
      const key = String(c.cuit_dni || "").replace(/\D/g, "");
      if (key) cuits.set(key, [...(cuits.get(key) || []), c.client_id]);
    }
    const records = new Map<string, Record<string, unknown>>();
    const errors: string[] = [];
    let zone: string | null = null;
    let duplicate = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = row.__fila_excel || (fileMetadata.headerRow || 1) + i + 1;
      const rowZone = pick(row, "Zona", "Área", "Localidad");
      if (rowZone) zone = rowZone;
      const nombre = pick(row, "CLIENTE", "Nombre", "Nombre Fantasía", "Fantasía", "Comercio");
      const direccion = pick(row, "DIR. ENTREGA", "Dirección", "Domicilio", "Dir Entrega", "Dirección de entrega");
      if (!nombre && !direccion && rowZone) continue;
      if (!nombre || !direccion) { errors.push(`Fila ${rowNumber}: falta comercio o dirección`); continue; }
      const lat = coordinateNumber(pick(row, "Latitud", "Lat"));
      const lng = coordinateNumber(pick(row, "Longitud", "Lng", "Long"));
      if ((lat !== null || lng !== null) && !(lat === 0 && lng === 0) && !argentinaCoordinates(lat, lng)) { errors.push(`Fila ${rowNumber}: coordenadas inválidas`); continue; }
      const ciudad = pick(row, "Ciudad", "Localidad") || zone || "";
      const provincia = pick(row, "Provincia") || "";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode([nombre, direccion, ciudad, provincia].map(norm).join("|")));
      const key = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
      if (records.has(key)) { duplicate++; continue; }
      const cuitRaw = pick(row, "CUIT", "CUIT / DNI", "CUIT/DNI");
      const cuit = cuitRaw && /e[+-]/i.test(cuitRaw) && Number.isSafeInteger(Number(cuitRaw)) ? String(Number(cuitRaw)) : cuitRaw?.replace(/\D/g, "");
      const matches = cuit ? cuits.get(cuit) || [] : [];
      records.set(key, {
        place_id: `excel-${key}`, import_key: key, nombre, direccion, ciudad, provincia,
        barrio: pick(row, "Barrio"), latitud: lat ?? 0, longitud: lng ?? 0,
        client_id: matches.length === 1 ? matches[0] : null,
        telefono: pick(row, "Teléfono", "Teléfono 1", "Celular", "Whatsapp", "TEL", "Contacto"),
        email: pick(row, "Email", "E-mail", "Correo", "Mail"), instagram: pick(row, "Instagram", "IG"),
        rubro: pick(row, "Rubro", "Canal", "Tipo", "Categoría"), tipo_principal: pick(row, "Rubro", "Canal", "Tipo", "Categoría"),
      });
    }
    if (errors.length) throw new RequestError(`${errors.length} filas inválidas. No se importó ninguna. ${errors.slice(0, 8).join("; ")}`, 422, "INVALID_ROWS");
    if (!records.size) throw new RequestError("No se encontraron comercios para importar", 422, "EMPTY_IMPORT");
    const payload = [...records.values()];
    const { data, error } = await db.rpc("guardar_prospectos_import", {
      p_batch_id: batchId, p_rows: payload,
      p_resultados: { filas_recibidas: rows.length, duplicados_en_archivo: duplicate,
        sin_coordenadas: payload.filter(p => !p.latitud || !p.longitud).length,
        ya_son_clientes: payload.filter(p => p.client_id).length, errores: [] },
    });
    if (error) throw new Error(error.message);
    return json(data);
  } catch (error) {
    if (db && batchId) await db.from("import_batches").update({ estado: "fallido", error_message: error instanceof Error ? error.message : "Error de importación", completed_at: new Date().toISOString() }).eq("id", batchId).is("aplicado_at", null);
    return failure(error);
  }
});
