import {
  composeRecommendationIds,
  composeRoute,
  type CompositionCandidate,
} from "./recommendation-composition.ts";

const candidate = (
  client_id: string,
  es_prospecto: boolean,
  estado_comercial = es_prospecto ? "POTENCIAL" : "ACTIVO",
): CompositionCandidate => ({ client_id, es_prospecto, estado_comercial });

const assertEquals = (actual: unknown, expected: unknown) => {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
};

const activos = (n: number) => Array.from({ length: n }, (_, i) => candidate(`a${i + 1}`, false, "ACTIVO"));
const inactivos = (n: number) => Array.from({ length: n }, (_, i) => candidate(`i${i + 1}`, false, "INACTIVO"));
const perdidos = (n: number) => Array.from({ length: n }, (_, i) => candidate(`r${i + 1}`, false, "PERDIDO"));
const prospectos = (n: number) => Array.from({ length: n }, (_, i) => candidate(`p${i + 1}`, true));

Deno.test("sin cupos: prioriza la cartera ordenada y llega a ocho", () => {
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [...activos(7), ...perdidos(3)],
    prospects: prospectos(5),
  });
  assertEquals(result, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "r1"]);
});

Deno.test("cliente propio sin compras se prioriza antes que un prospecto frío", () => {
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [...activos(5), ...perdidos(2), candidate("s1", false, "POTENCIAL")],
    prospects: prospectos(3),
  });
  assertEquals(result, ["a1", "a2", "a3", "a4", "a5", "r1", "r2", "s1"]);
});

Deno.test("si falta reactivación completa con cartera activa", () => {
  const result = composeRecommendationIds({
    preferredIds: prospectos(8).map((p) => p.client_id),
    clients: activos(8),
    prospects: prospectos(8),
  });
  assertEquals(result, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
});

Deno.test("si falta cartera activa completa con reactivación y después potencial", () => {
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [candidate("a1", false, "ACTIVO"), ...inactivos(4)],
    prospects: prospectos(6),
  });
  assertEquals(result, ["a1", "i1", "i2", "i3", "i4", "p1", "p2", "p3"]);
});

Deno.test("sin cartera: ocho prospectos", () => {
  const result = composeRecommendationIds({ preferredIds: [], clients: [], prospects: prospectos(8) });
  assertEquals(result, prospectos(8).map((p) => p.client_id));
});

Deno.test("un solo cliente se completa con siete prospectos", () => {
  const result = composeRecommendationIds({
    preferredIds: ["i1"],
    clients: inactivos(1),
    prospects: prospectos(7),
  });
  assertEquals(result.length, 8);
  assertEquals(result.filter((id) => id.startsWith("p")).length, 7);
});

Deno.test("filtro PERDIDOS: las 8 salen de perdidos si alcanzan", () => {
  const r = composeRoute({
    preferredIds: [],
    clients: [...activos(6), ...inactivos(3), ...perdidos(10)],
    prospects: prospectos(5),
    estados: new Set(["PERDIDO"]),
  });
  assertEquals(r.ids, ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
  assertEquals(r.fueraDeSeleccion, []);
});

Deno.test("filtro PERDIDOS + INACTIVOS mezcla ambos", () => {
  const r = composeRoute({
    preferredIds: [],
    clients: [...activos(6), ...inactivos(3), ...perdidos(3)],
    prospects: prospectos(5),
    estados: new Set(["PERDIDO", "INACTIVO"]),
  });
  assertEquals(r.ids.length, 8);
  assertEquals(r.ids.filter((id) => id.startsWith("a")).length, 0);
  assertEquals(r.ids.filter((id) => id.startsWith("p")).length, 2);
  assertEquals(r.fueraDeSeleccion, ["p1", "p2"]);
});

Deno.test("filtro que no alcanza: completa con prospectos y luego con el resto de la cartera", () => {
  const r = composeRoute({
    preferredIds: [],
    clients: [...activos(6), ...perdidos(2)],
    prospects: prospectos(3),
    permitirOtrosEstados: true,
    estados: new Set(["PERDIDO"]),
  });
  assertEquals(r.ids, ["r1", "r2", "p1", "p2", "p3", "a1", "a2", "a3"]);
  assertEquals(r.fueraDeSeleccion, ["p1", "p2", "p3", "a1", "a2", "a3"]);
});

Deno.test("filtro ACTIVOS + POTENCIALES respeta la selección sin imponer cupos", () => {
  const r = composeRoute({
    preferredIds: [],
    clients: [...activos(9), ...perdidos(5)],
    prospects: prospectos(5),
    estados: new Set(["ACTIVO", "POTENCIAL"]),
  });
  assertEquals(r.ids, ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]);
  assertEquals(r.fueraDeSeleccion, []);
});

Deno.test("devuelve un resultado incompleto solo cuando no hay inventario", () => {
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [candidate("c1", false)],
    prospects: [candidate("p1", true)],
  });
  assertEquals(result, ["c1", "p1"]);
});

Deno.test("respeta candidatos ya tomados por otro vendedor", () => {
  const result = composeRecommendationIds({
    preferredIds: ["p2", "c3"],
    clients: [candidate("c1", false), candidate("c2", false), candidate("c3", false)],
    prospects: [candidate("p1", true), candidate("p2", true)],
    unavailableIds: new Set(["c1", "p1"]),
    limit: 3,
  });
  assertEquals(result, ["c3", "c2", "p2"]);
});
