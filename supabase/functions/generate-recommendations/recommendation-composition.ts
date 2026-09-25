export interface CompositionCandidate {
  client_id: string;
  es_prospecto: boolean;
  estado_comercial: string;
}

interface CompositionInput<T extends CompositionCandidate> {
  preferredIds: string[];
  clients: T[];
  prospects: T[];
  unavailableIds?: ReadonlySet<string>;
  limit?: number;
  estados?: ReadonlySet<string>;
  /** Solo después de agotar la búsqueda de prospectos cercanos. */
  permitirOtrosEstados?: boolean;
}

export interface CompositionResult { ids: string[]; fueraDeSeleccion: string[] }

/** Sin cupos 5-2-1: cartera elegida por prioridad y prospectos para completar. */
export function composeRoute<T extends CompositionCandidate>({
  preferredIds, clients, prospects, unavailableIds = new Set<string>(), limit = 8,
  estados = new Set<string>(), permitirOtrosEstados = false,
}: CompositionInput<T>): CompositionResult {
  const ids: string[] = [], fueraDeSeleccion: string[] = [];
  const usados = new Set(unavailableIds);
  const elegido = (c: T) => estados.size === 0 || estados.has(c.es_prospecto ? "POTENCIAL" : c.estado_comercial);
  const orden = new Map(preferredIds.map((id, i) => [id, i]));
  const agregar = (lista: T[]) => {
    const ordenados = [...lista].sort((a, b) => (orden.get(a.client_id) ?? Infinity) - (orden.get(b.client_id) ?? Infinity));
    for (const c of ordenados) {
      if (ids.length >= limit) break;
      if (usados.has(c.client_id)) continue;
      usados.add(c.client_id);
      ids.push(c.client_id);
      if (!elegido(c)) fueraDeSeleccion.push(c.client_id);
    }
  };
  agregar(clients.filter(elegido));
  agregar(prospects);
  if (permitirOtrosEstados) agregar(clients.filter(c => !elegido(c)));
  return { ids, fueraDeSeleccion };
}

export function composeRecommendationIds<T extends CompositionCandidate>(input: CompositionInput<T>): string[] {
  return composeRoute(input).ids;
}
