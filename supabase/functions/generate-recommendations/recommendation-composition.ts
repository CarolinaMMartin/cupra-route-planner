export interface CompositionCandidate {
  client_id: string;
  es_prospecto: boolean;
  /** ACTIVO | INACTIVO | PERDIDO | POTENCIAL */
  estado_comercial: string;
}

export interface Cupos {
  cartera: number;
  reactivacion: number;
  prospectos: number;
}

interface CompositionInput<T extends CompositionCandidate> {
  preferredIds: string[];
  clients: T[];
  prospects: T[];
  unavailableIds?: ReadonlySet<string>;
  limit?: number;
  cupos?: Cupos;
  /**
   * Estados elegidos por el asignador (vacío = mezcla por defecto).
   * Si eligió, por ejemplo, PERDIDO + INACTIVO, la ruta sale de esos estados
   * y SOLO si no alcanzan se completa con prospectos (y como último recurso con
   * el resto de la cartera), para que siempre haya `limit` visitas.
   */
  estados?: ReadonlySet<string>;
}

/** Regla dura del día: 5 cartera activa + 2 reactivación + 1 potencial = 8. */
export const DEFAULT_CUPOS: Cupos = { cartera: 5, reactivacion: 2, prospectos: 1 };

export interface CompositionResult {
  ids: string[];
  /** Visitas que entraron para completar y NO pertenecen a los estados elegidos. */
  fueraDeSeleccion: string[];
}

/**
 * Dueño de la composición de la ruta. El modelo de IA solo ordena dentro de cada bloque.
 *
 * Bloques:
 *   cartera      = clientes propios ACTIVOS
 *   reactivación = clientes propios INACTIVOS o PERDIDOS
 *   potencial    = clientes propios que nunca compraron + prospectos (en ese orden)
 *
 * Cadena de sustitución (siempre hasta `limit`):
 *   cupos → cartera → reactivación → potencial → (si hay filtro) prospectos fuera
 *   del filtro → resto de la cartera fuera del filtro.
 */
export function composeRoute<T extends CompositionCandidate>({
  preferredIds,
  clients,
  prospects,
  unavailableIds = new Set<string>(),
  limit = 8,
  cupos = DEFAULT_CUPOS,
  estados = new Set<string>(),
}: CompositionInput<T>): CompositionResult {
  const candidatesById = new Map<string, T>();
  [...clients, ...prospects].forEach((candidate) => {
    if (!candidatesById.has(candidate.client_id)) candidatesById.set(candidate.client_id, candidate);
  });

  const hayFiltro = estados.size > 0;
  const permitido = (c: T): boolean => {
    if (!hayFiltro) return true;
    return estados.has(c.es_prospecto ? "POTENCIAL" : c.estado_comercial);
  };

  const pickedIds = new Set<string>();
  const result: string[] = [];
  const fueraDeSeleccion: string[] = [];
  const append = (candidateId: string, fuera = false): boolean => {
    if (result.length >= limit || pickedIds.has(candidateId) || unavailableIds.has(candidateId)) return false;
    if (!candidatesById.has(candidateId)) return false;
    result.push(candidateId);
    pickedIds.add(candidateId);
    if (fuera) fueraDeSeleccion.push(candidateId);
    return true;
  };

  const preferredCandidates = preferredIds
    .map((candidateId) => candidatesById.get(candidateId))
    .filter((candidate): candidate is T => Boolean(candidate));

  const isCartera = (c: T) => !c.es_prospecto && c.estado_comercial === "ACTIVO";
  const isReactivacion = (c: T) => !c.es_prospecto && (c.estado_comercial === "INACTIVO" || c.estado_comercial === "PERDIDO");
  const isPotencialPropio = (c: T) => !c.es_prospecto && c.estado_comercial === "POTENCIAL";
  const isProspecto = (c: T) => c.es_prospecto;

  // Orden dentro de cada bloque: primero lo que prefirió el modelo, después el pool.
  const orderedBlock = (predicate: (c: T) => boolean): string[] => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (c: T) => {
      if (seen.has(c.client_id)) return;
      seen.add(c.client_id);
      ids.push(c.client_id);
    };
    preferredCandidates.filter(predicate).forEach(push);
    [...clients, ...prospects].filter(predicate).forEach(push);
    return ids;
  };

  const bloqueCartera = orderedBlock((c) => isCartera(c) && permitido(c));
  const bloqueReactivacion = orderedBlock((c) => isReactivacion(c) && permitido(c));
  const bloquePotencial = [
    ...orderedBlock((c) => isPotencialPropio(c) && permitido(c)),
    ...orderedBlock((c) => isProspecto(c) && permitido(c)),
  ];

  const take = (ids: string[], cantidad: number, fuera = false) => {
    let tomados = 0;
    for (const id of ids) {
      if (tomados >= cantidad || result.length >= limit) break;
      if (append(id, fuera)) tomados++;
    }
  };

  // 1) Cupos objetivo (los bloques ya vienen recortados por el filtro de estados).
  take(bloqueCartera, cupos.cartera);
  take(bloqueReactivacion, cupos.reactivacion);
  take(bloquePotencial, cupos.prospectos);

  // 2) Sustitución dentro de lo elegido: cartera propia primero, potencial al final.
  take(bloqueCartera, limit);
  take(bloqueReactivacion, limit);
  take(bloquePotencial, limit);

  // 3) Siempre `limit`: si el filtro no alcanza, prospectos y después el resto de la cartera.
  if (hayFiltro && result.length < limit) {
    take(orderedBlock(isProspecto), limit, true);
    take(orderedBlock((c) => isCartera(c) || isReactivacion(c) || isPotencialPropio(c)), limit, true);
  }

  return { ids: result, fueraDeSeleccion };
}

/** Compatibilidad: devuelve solo los IDs. */
export function composeRecommendationIds<T extends CompositionCandidate>(input: CompositionInput<T>): string[] {
  return composeRoute(input).ids;
}
