export const CATEGORIAS_PROSPECTOS = [
  { tipo: "liquor_store", rubro: "Vinoteca", label: "Vinotecas", consulta: "vinotecas", regalos: false },
  { tipo: "wine_bar", rubro: "Wine bar", label: "Wine bars", consulta: "wine bars", regalos: false },
  { tipo: "restaurant", rubro: "Restaurante", label: "Restaurantes", consulta: "restaurantes", regalos: false },
  { tipo: "bar", rubro: "Bar", label: "Bares", consulta: "bares", regalos: false },
  { tipo: "hotel", rubro: "Hotel", label: "Hoteles", consulta: "hoteles", regalos: true },
  { tipo: "corporate_office", rubro: "Empresa", label: "Empresas y oficinas", consulta: "empresas y oficinas corporativas", regalos: true },
  { tipo: "lawyer", rubro: "Estudio jurídico", label: "Estudios jurídicos", consulta: "estudios jurídicos", regalos: true },
  { tipo: "accounting", rubro: "Estudio contable", label: "Estudios contables", consulta: "estudios contables", regalos: true },
  { tipo: "real_estate_agency", rubro: "Inmobiliaria", label: "Inmobiliarias", consulta: "inmobiliarias", regalos: true },
  { tipo: "insurance_agency", rubro: "Agencia de seguros", label: "Agencias de seguros", consulta: "agencias de seguros", regalos: true },
  { tipo: "event_venue", rubro: "Catering / Eventos", label: "Espacios de eventos", consulta: "espacios de eventos", regalos: true },
] as const;

export const rubroKey = (value: string | null | undefined): string => (value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

export const TIPOS_GOOGLE_POR_RUBRO: Record<string, string[]> = {
  ...Object.fromEntries(CATEGORIAS_PROSPECTOS.map(c => [rubroKey(c.rubro), [c.tipo]])),
  "EMPRESA": ["corporate_office", "business_center", "coworking_space", "manufacturer"],
  "BAR": ["bar", "pub"],
  "ALMACEN / SUPERMERCADO": ["grocery_store", "supermarket", "convenience_store"],
  "TIENDA GOURMET": ["food_store", "deli"],
};

export const RUBROS_REGALOS = new Set(CATEGORIAS_PROSPECTOS.filter(c => c.regalos).map(c => rubroKey(c.rubro)));
export const TIPOS_GOOGLE_DEFAULT = ["liquor_store", "wine_bar", "restaurant", "bar", "hotel"];
export const TIPOS_GOOGLE_REGALOS = CATEGORIAS_PROSPECTOS.filter(c => c.regalos).map(c => c.tipo);

export function rubroDeTipos(tipo?: string | null, tipos?: string[] | null): string | null {
  for (const t of [tipo || "", ...(tipos || [])]) {
    const key = t.toLowerCase();
    const rubro = Object.entries(TIPOS_GOOGLE_POR_RUBRO).find(([, ts]) => ts.includes(key))?.[0];
    if (rubro) return CATEGORIAS_PROSPECTOS.find(c => rubroKey(c.rubro) === rubro)?.rubro
      || (rubro === "ALMACEN / SUPERMERCADO" ? "Almacén / Supermercado" : "Tienda gourmet");
    if (key.endsWith("_hotel") || ["lodging", "hostel"].includes(key)) return "Hotel";
    if (key.includes("restaurant") || ["steak_house", "meal_takeaway", "meal_delivery"].includes(key)) return "Restaurante";
  }
  return null;
}

/** Afinidad del rubro con la propuesta; no acredita interés ni intención de compra. */
export function candidatoRegalos(p: { rubro?: string | null; tipo_principal?: string | null; tipos?: string[] | null }): boolean {
  return RUBROS_REGALOS.has(rubroKey(p.rubro || rubroDeTipos(p.tipo_principal, p.tipos)));
}

export function tiposGoogleParaRubros(rubros: Set<string>, regalos = false): string[] {
  if (!rubros.size) return regalos ? [...TIPOS_GOOGLE_REGALOS] : [...TIPOS_GOOGLE_DEFAULT];
  return [...new Set([...rubros].map(rubroKey)
    .filter(r => !regalos || RUBROS_REGALOS.has(r))
    .flatMap(r => TIPOS_GOOGLE_POR_RUBRO[r] || []))];
}

export function etiquetaTipo(tipo: string | null | undefined): string {
  return CATEGORIAS_PROSPECTOS.find(c => c.tipo === tipo)?.rubro
    || rubroDeTipos(tipo) || (tipo || "Sin rubro").replace(/_/g, " ");
}
