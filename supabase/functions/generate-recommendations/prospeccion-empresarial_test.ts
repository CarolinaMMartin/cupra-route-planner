import { strictEqual as eq, deepStrictEqual as same, ok, rejects, throws } from "node:assert/strict";
import { candidatoRegalos, rubroDeTipos, tiposGoogleParaRubros } from "../_shared/prospect-categories.ts";
import { promoteInBatches, type PromotionResult } from "../_shared/prospect-promotion.ts";
import { construirFallback } from "../_shared/briefing.ts";
import { validarSolicitud, SolicitudInvalida } from "./solicitud.ts";

Deno.test("empresas: afinidad por rubro conserva la categoría principal y no presupone reseñas", () => {
  eq(rubroDeTipos("corporate_office", ["restaurant"]), "Empresa");
  eq(rubroDeTipos("hotel", ["restaurant", "lodging"]), "Hotel");
  eq(rubroDeTipos("restaurant", ["hotel"]), "Restaurante");
  for (const tipo of ["corporate_office", "hotel", "lawyer", "accounting", "insurance_agency", "real_estate_agency", "event_venue"]) {
    ok(candidatoRegalos({ tipo_principal: tipo }));
  }
  eq(candidatoRegalos({ rubro: "Restaurante", tipos: ["hotel"] }), false);
  eq(candidatoRegalos({ tipo_principal: "liquor_store" }), false);
  eq(candidatoRegalos({ tipo_principal: "museum" }), false);
});
Deno.test("empresas: filtro estricto en base y Google, incluso sin rubros cargados", () => {
  const tipos = tiposGoogleParaRubros(new Set(), true);
  ok(tipos.includes("hotel")); ok(tipos.includes("corporate_office"));
  eq(tipos.includes("restaurant"), false);
  same(tiposGoogleParaRubros(new Set(["Hotel"]), true), ["hotel"]);
  same(tiposGoogleParaRubros(new Set(["Restaurante"]), true), []);
  same(tiposGoogleParaRubros(new Set(["Desconocido"])), []);
  eq(validarSolicitud({ regalos_empresariales: true }).regalos_empresariales, true);
  eq(validarSolicitud({}).regalos_empresariales, false);
  throws(() => validarSolicitud({ regalos_empresariales: "true" }), SolicitudInvalida);
});
Deno.test("promoción: carga los 60 resultados sin perder los 35 posteriores al primer lote", async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `place-${i}`);
  const sizes: number[] = [], saved: string[] = [];
  const result = await promoteInBatches([...ids, ids[0]], async batch => {
    sizes.push(batch.length);
    return { created: batch.length - Number(batch.includes("place-30")), promoted_place_ids: batch.filter(id => id !== "place-30"), skipped: batch.includes("place-30") ? [{ place_id: "place-30", motivo: "Detalle no disponible" }] : [] };
  }, batch => saved.push(...batch.promoted_place_ids));
  same(sizes, [25, 25, 10]); eq(result.created, 59); eq(saved.length, 59);
  eq(saved.includes("place-30"), false); eq(result.skipped[0].place_id, "place-30");
});
Deno.test("promoción: comunica lo ya guardado si falla un lote posterior", async () => {
  const batches: PromotionResult[] = [];
  await rejects(promoteInBatches(Array.from({ length: 40 }, (_, i) => `p-${i}`), async batch => {
    if (batch[0] === "p-25") throw new Error("Conexión interrumpida");
    return { created: batch.length, promoted_place_ids: batch, skipped: [] };
  }, result => batches.push(result)), /Conexión/);
  eq(batches.length, 1); eq(batches[0].created, 25);
});
Deno.test("briefing: propone regalos sin atribuir compras o interés y conserva advertencias", () => {
  const texto = construirFallback({ tipo: "prospecto", oportunidad_regalos_empresariales: true });
  ok(texto.includes("regalos empresariales")); ok(texto.includes("sin compras confirmadas"));
  eq(texto.includes("reponer"), false); eq(texto.includes("cuenta activa"), false);
  const advertencia = construirFallback({ oportunidad_regalos_empresariales: true, nota_credito_pendiente: "$100" });
  ok(advertencia.startsWith("Atender primero")); ok(advertencia.includes("NC pendiente"));
});
