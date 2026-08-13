import {
  composeRecommendationIds,
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

Deno.test("respeta la mezcla 4 cartera + 2 reactivación + 2 prospectos", () => {
  const clients = [
    ...Array.from({ length: 6 }, (_, i) => candidate(`a${i + 1}`, false, "ACTIVO")),
    ...Array.from({ length: 3 }, (_, i) => candidate(`r${i + 1}`, false, "PERDIDO")),
  ];
  const prospects = Array.from({ length: 5 }, (_, i) => candidate(`p${i + 1}`, true));

  const result = composeRecommendationIds({ preferredIds: [], clients, prospects });

  assertEquals(result, ["a1", "a2", "a3", "a4", "r1", "r2", "p1", "p2"]);
});

Deno.test("si falta reactivación completa con cartera activa", () => {
  const clients = Array.from({ length: 8 }, (_, i) => candidate(`a${i + 1}`, false, "ACTIVO"));
  const prospects = Array.from({ length: 8 }, (_, i) => candidate(`p${i + 1}`, true));

  const result = composeRecommendationIds({
    preferredIds: prospects.map((item) => item.client_id),
    clients,
    prospects,
  });

  assertEquals(result, ["a1", "a2", "a3", "a4", "p1", "p2", "a5", "a6"]);
});

Deno.test("si falta cartera activa completa con reactivación", () => {
  const clients = [
    candidate("a1", false, "ACTIVO"),
    ...Array.from({ length: 6 }, (_, i) => candidate(`r${i + 1}`, false, "INACTIVO")),
  ];
  const prospects = Array.from({ length: 4 }, (_, i) => candidate(`p${i + 1}`, true));

  const result = composeRecommendationIds({ preferredIds: [], clients, prospects });

  assertEquals(result, ["a1", "r1", "r2", "p1", "p2", "r3", "r4", "r5"]);
});

Deno.test("modo conquista: ocho prospectos cuando no hay cartera", () => {
  const prospects = Array.from({ length: 8 }, (_, i) => candidate(`p${i + 1}`, true));
  const result = composeRecommendationIds({ preferredIds: [], clients: [], prospects });
  assertEquals(result, prospects.map((item) => item.client_id));
});

Deno.test("devuelve un resultado incompleto cuando el inventario no alcanza", () => {
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [candidate("c1", false)],
    prospects: [candidate("p1", true)],
  });
  assertEquals(result, ["c1", "p1"]);
});

Deno.test("respeta candidatos ya tomados por otro vendedor", () => {
  const clients = [
    candidate("c1", false),
    candidate("c2", false),
    candidate("c3", false),
  ];
  const prospects = [candidate("p1", true), candidate("p2", true)];
  const result = composeRecommendationIds({
    preferredIds: ["p2", "c3"],
    clients,
    prospects,
    unavailableIds: new Set(["c1", "p1"]),
    limit: 3,
  });
  assertEquals(result, ["c3", "c2", "p2"]);
});
