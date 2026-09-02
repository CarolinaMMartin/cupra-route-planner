import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY") || "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "nan" ? null : s;
};

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-záéíóúñ])/g, (m) => m.toUpperCase());

function pick(row: Record<string, unknown>, candidates: string[]): string | null {
  const wanted = candidates.map(norm);
  for (const key of Object.keys(row)) {
    if (wanted.includes(norm(key))) {
      const v = clean(row[key]);
      if (v) return v;
    }
  }
  return null;
}

function normalizarCuit(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (/e\+/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = n.toFixed(0);
  }
  const digits = s.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

function normalizarTelefono(raw: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

// Extrae CP y localidad de textos tipo "Av. Yrigoyen 9287, CP1832 L. de Zamora"
function partirDireccion(dir: string) {
  const cpMatch = dir.match(/CP\s*([0-9]{4})/i) || dir.match(/\b([0-9]{4})\b(?=\s+[A-Za-zÁ-ú])/);
  const cp = cpMatch ? cpMatch[1] : null;
  return { cp };
}

async function geocode(direccion: string, ciudad: string, cp: string | null) {
  if (!GOOGLE_API_KEY || !LOVABLE_API_KEY) return null;
  const address = [direccion, cp, ciudad, "Buenos Aires", "Argentina"].filter(Boolean).join(", ");
  const params = new URLSearchParams({ address, language: "es", region: "ar" });
  try {
    const resp = await fetch(`${GATEWAY_URL}/maps/api/geocode/json?${params.toString()}`, {
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": GOOGLE_API_KEY },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const r = data?.results?.[0];
    if (!r) return null;
    const comp = (t: string) =>
      (r.address_components || []).find((c: any) => c.types?.includes(t))?.long_name || null;
    return {
      lat: r.geometry?.location?.lat as number,
      lng: r.geometry?.location?.lng as number,
      formatted: r.formatted_address as string,
      barrio: comp("sublocality") || comp("neighborhood"),
      ciudad: comp("locality") || comp("administrative_area_level_2"),
      provincia: comp("administrative_area_level_1"),
      place_id: r.place_id as string | undefined,
    };
  } catch (_e) {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await anon.auth.getUser();
    if (!userData?.user) return json({ success: false, error: "No autorizado" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { rows, geocodificar = true } = await req.json();
    if (!Array.isArray(rows) || rows.length === 0) return json({ success: false, error: "Sin filas" }, 400);
    if (rows.length > 5000) return json({ success: false, error: "Máximo 5.000 filas por carga" }, 400);

    // CUITs de clientes existentes para marcar es_cliente_cupra
    const { data: clientesExistentes } = await admin.from("clientes").select("client_id, cuit_dni").limit(5000);
    const cuitToClient = new Map<string, string>();
    for (const c of clientesExistentes || []) {
      const k = normalizarCuit(c.cuit_dni as string | null);
      if (k) cuitToClient.set(k, c.client_id as string);
    }

    const registros: any[] = [];
    const errores: string[] = [];
    let zonaActual: string | null = null;
    let geocodificados = 0;
    let sinCoordenadas = 0;
    let yaClientes = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as Record<string, unknown>;
      const zona = pick(row, ["ZONA", "Zona", "Localidad", "Área", "Area"]);
      if (zona) zonaActual = zona;

      const nombre = pick(row, ["CLIENTE", "Nombre", "Nombre Fantasía", "FANTASIA", "Fantasía", "Comercio"]);
      const direccionRaw = pick(row, ["DIR. ENTREGA", "Dirección", "DIRECCION", "Domicilio", "Dir Entrega", "Dirección de entrega"]);

      if (!nombre || !direccionRaw) {
        errores.push(`Fila ${i + 2}: falta nombre o dirección`);
        continue;
      }

      const cuit = normalizarCuit(pick(row, ["CUIT", "CUIT / DNI", "Cuit"]));
      const razonSocial = pick(row, ["RAZON SOCIAL", "Razón Social"]);
      const canal = pick(row, ["CANAL", "Canal", "Tipo", "Rubro"]);
      const contacto = pick(row, ["CONTACTO", "Contacto", "Referente"]);
      const horarios = pick(row, ["DIAS/HORARIOS", "Días/Horarios", "Horarios"]);
      const mail = pick(row, ["MAIL", "Mail", "Email", "Correo"]);

      // Teléfono: columna explícita o cualquier columna sin nombre con formato telefónico
      let telefono = normalizarTelefono(pick(row, ["TELEFONO", "Teléfono", "Celular", "Tel", "Cel", "Movil", "Móvil", "Whatsapp", "WhatsApp"]));
      if (!telefono) {
        // SheetJS nombra las columnas sin encabezado "__EMPTY", "__EMPTY_1"…; pandas usa "Unnamed: 8"
        for (const [k, v] of Object.entries(row)) {
          if (/^(unnamed|__empty)/i.test(k) || norm(k) === "") {
            const t = normalizarTelefono(clean(v));
            if (t) { telefono = t; break; }
          }
        }
      }
      if (!telefono) {
        // Último recurso: cualquier celda que parezca un teléfono argentino
        for (const [k, v] of Object.entries(row)) {
          if (["cuit", "cuitdni", "razonsocial", "mail", "email", "correo"].includes(norm(k))) continue;
          const raw = clean(v);
          if (!raw) continue;
          const digits = String(raw).replace(/\D/g, "");
          if (/^[\d\s()+-]+$/.test(String(raw)) && digits.length >= 8 && digits.length <= 13) {
            telefono = digits;
            break;
          }
        }
      }

      const { cp } = partirDireccion(direccionRaw);
      const ciudadBase = zonaActual ? titleCase(zonaActual) : "Buenos Aires";

      let lat = 0, lng = 0;
      let barrio: string | null = null;
      let ciudad = ciudadBase;
      let provincia = "Provincia de Buenos Aires";
      let placeIdGoogle: string | undefined;

      if (geocodificar) {
        const geo = await geocode(direccionRaw, ciudadBase, cp);
        if (geo && Number.isFinite(geo.lat)) {
          lat = geo.lat; lng = geo.lng;
          barrio = geo.barrio;
          ciudad = geo.ciudad || ciudadBase;
          provincia = geo.provincia || provincia;
          placeIdGoogle = geo.place_id;
          geocodificados++;
        } else {
          sinCoordenadas++;
        }
      } else {
        sinCoordenadas++;
      }

      const clientIdMatch = cuit ? cuitToClient.get(cuit) || null : null;
      if (clientIdMatch) yaClientes++;

      const placeId = placeIdGoogle || `excel-${cuit || norm(nombre + direccionRaw)}`;

      const resumen = [
        razonSocial ? `Razón social: ${razonSocial}` : null,
        cuit ? `CUIT: ${cuit}` : null,
        contacto ? `Contacto: ${contacto}` : null,
        horarios ? `Horarios: ${horarios}` : null,
      ].filter(Boolean).join(" · ") || null;

      registros.push({
        place_id: placeId,
        nombre: titleCase(nombre),
        direccion: direccionRaw,
        barrio,
        ciudad,
        provincia,
        latitud: lat,
        longitud: lng,
        telefono,
        email: mail,
        tipo_principal: canal ? canal.toLowerCase() : null,
        tipos: canal ? [canal.toLowerCase()] : [],
        sirve_vinos: true,
        estado_negocio: "OPERATIONAL",
        resumen_google: resumen,
        es_cliente_cupra: !!clientIdMatch,
        client_id: clientIdMatch,
        updated_at: new Date().toISOString(),
      });
    }

    // Deduplicar por place_id dentro del mismo archivo
    const porPlace = new Map<string, any>();
    for (const r of registros) porPlace.set(r.place_id, r);
    const finales = [...porPlace.values()];

    let insertados = 0;
    for (let i = 0; i < finales.length; i += 100) {
      const batch = finales.slice(i, i + 100);
      const { error } = await admin.from("prospectos").upsert(batch, { onConflict: "place_id" });
      if (error) errores.push(`Lote ${i / 100 + 1}: ${error.message}`);
      else insertados += batch.length;
    }

    return json({
      success: true,
      results: {
        filas_recibidas: rows.length,
        prospectos_cargados: insertados,
        duplicados_en_archivo: registros.length - finales.length,
        geocodificados,
        sin_coordenadas: sinCoordenadas,
        ya_son_clientes: yaClientes,
        errores: errores.slice(0, 50),
      },
    });
  } catch (e) {
    console.error("[process-prospectos-excel]", e);
    return json({ success: false, error: e instanceof Error ? e.message : "Error desconocido" }, 500);
  }
});
