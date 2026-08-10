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

Deno.test("uses eight internal clients and no prospects when the portfolio covers the quota", () => {
  const clients = Array.from(
    { length: 8 },
    (_, index) => candidate(`c${index + 1}`, false),
  );
  const prospects = Array.from(
    { length: 8 },
    (_, index) => candidate(`p${index + 1}`, true),
  );

  const result = composeRecommendationIds({
    preferredIds: prospects.map((item) => item.client_id),
    clients,
    prospects,
  });

  assertEquals(result, clients.map((item) => item.client_id));
});

Deno.test("fills only the exact client deficit with prospects", () => {
  const clients = Array.from(
    { length: 5 },
    (_, index) => candidate(`c${index + 1}`, false),
  );
  const prospects = Array.from(
    { length: 8 },
    (_, index) => candidate(`p${index + 1}`, true),
  );

  const result = composeRecommendationIds({
    preferredIds: [],
    clients,
    prospects,
  });

  assertEquals(result, ["c1", "c2", "c3", "c4", "c5", "p1", "p2", "p3"]);
});

Deno.test("does not cap lost internal clients before using prospects", () => {
  const clients = [
    ...Array.from(
      { length: 3 },
      (_, index) => candidate(`a${index + 1}`, false, "ACTIVO"),
    ),
    ...Array.from(
      { length: 5 },
      (_, index) => candidate(`l${index + 1}`, false, "PERDIDO"),
    ),
  ];
  const prospects = Array.from(
    { length: 8 },
    (_, index) => candidate(`p${index + 1}`, true),
  );

  const result = composeRecommendationIds({
    preferredIds: ["p1", "p2"],
    clients,
    prospects,
  });

  assertEquals(result, ["a1", "a2", "a3", "l1", "l2", "l3", "l4", "l5"]);
});

Deno.test("supports conquest mode with eight prospects", () => {
  const prospects = Array.from(
    { length: 8 },
    (_, index) => candidate(`p${index + 1}`, true),
  );
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [],
    prospects,
  });
  assertEquals(result, prospects.map((item) => item.client_id));
});

Deno.test("returns an incomplete result when inventory is insufficient so persistence can reject it", () => {
  const result = composeRecommendationIds({
    preferredIds: [],
    clients: [candidate("c1", false)],
    prospects: [candidate("p1", true)],
  });
  assertEquals(result, ["c1", "p1"]);
});

Deno.test("respects global unavailability without violating client-first order", () => {
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
