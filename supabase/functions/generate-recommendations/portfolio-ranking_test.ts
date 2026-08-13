import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertaNotaCredito,
  dedupeBarrios,
  esProspectoComercialmenteValido,
  evaluarProspectoContraCartera,
  normalizeFantasyName,
  pickBestCluster,
  potencialProspecto,
  prioridadBase,
} from "./portfolio-ranking.ts";

// PALANTI: $10,4M, cadencia 13 días, 33 días sin comprar -> debe pesar mucho más
// que una cuenta chica de $850k vencida.
Deno.test("prioridad: cuenta ancla vencida gana a cuenta chica", () => {
  const palanti = prioridadBase({
    monto_total_historico: 10_400_000,
    dias_desde_ultima_compra: 33,
    cadencia_dias: 13,
  });
  const chica = prioridadBase({
    monto_total_historico: 850_000,
    dias_desde_ultima_compra: 200,
    cadencia_dias: 45,
  });
  assert(palanti > chica, `${palanti} debería superar a ${chica}`);
});

Deno.test("prioridad: cliente al día casi no pesa", () => {
  const alDia = prioridadBase({ monto_total_historico: 5_000_000, dias_desde_ultima_compra: 0 });
  assert(alDia >= 0 && alDia < 1);
});

Deno.test("alerta de nota de crédito sobre 30%", () => {
  assertEquals(alertaNotaCredito({ monto_total_historico: 1_000_000, monto_notas_credito: 100_000 }), null);
  const alerta = alertaNotaCredito({
    monto_total_historico: 1_555_140,
    monto_notas_credito: 940_860,
    fecha_ultima_nc: "2025-11-28",
  });
  assert(alerta && alerta.ratio > 0.5 && alerta.fecha === "2025-11-28");
});

Deno.test("cluster: prefiere zona con mínimo de cartera antes que valor aislado", () => {
  const puntos = [
    // cuenta gigante aislada en Junín
    { lat: -34.58, lng: -60.94, prioridad: 50 },
    // cluster real en CABA
    { lat: -34.58, lng: -58.47, prioridad: 5 },
    { lat: -34.581, lng: -58.472, prioridad: 5 },
    { lat: -34.583, lng: -58.474, prioridad: 5 },
    { lat: -34.585, lng: -58.476, prioridad: 5 },
  ];
  const best = pickBestCluster(puntos, 2.5, 4);
  assert(best);
  assert(best!.cumpleMinimo);
  assert(Math.abs(best!.anchor.lng + 58.47) < 0.1, "debe anclar en CABA");
});

Deno.test("gate prospecto ↔ cartera: Masis a 870 m es posible cliente", () => {
  const gate = evaluarProspectoContraCartera(
    { nombre: "Vinoteca Masis", latitud: -34.5765, longitud: -58.4695, barrio: "Villa Ortúzar" },
    [{ name: "MASIS - KINI LITZ SRL", lat: -34.5735, longitud: 0, lng: -58.4620, vendedor: "Leandro Mutuverría", diasDesdeUltimaCompra: 20 } as any],
    () => "Villa Ortúzar",
  );
  assertEquals(gate.estado, "posible_cliente");
});

Deno.test("gate prospecto ↔ cartera: negocio lejano y distinto queda nuevo", () => {
  const gate = evaluarProspectoContraCartera(
    { nombre: "Berpic Wines", latitud: -34.60, longitud: -58.40, barrio: "Palermo" },
    [{ name: "MASIS - KINI LITZ SRL", lat: -34.5735, lng: -58.4620 }],
  );
  assertEquals(gate.estado, "nuevo");
});

Deno.test("normalización de nombre de fantasía", () => {
  assertEquals(normalizeFantasyName("Vinoteca Masís S.R.L."), "MASIS");
});

Deno.test("calidad de prospectos: 5.0 con 3 reseñas se descarta", () => {
  assertEquals(esProspectoComercialmenteValido({ rating: 5, total_ratings: 3, tipo_principal: "liquor_store" }), false);
  assertEquals(esProspectoComercialmenteValido({ rating: 4.3, total_ratings: 120, tipo_principal: "liquor_store" }), true);
  assertEquals(
    esProspectoComercialmenteValido({ rating: 4.8, total_ratings: 300, tipo_principal: "cultural_center" }),
    false,
  );
});

Deno.test("potencial: manda el volumen de reseñas", () => {
  assert(potencialProspecto({ rating: 4.0, total_ratings: 180 }) > potencialProspecto({ rating: 5, total_ratings: 20 }));
});

Deno.test("barrios: dedupe por mayúsculas y acentos", () => {
  assertEquals(
    dedupeBarrios(["Parque Chas", "VILLA URQUIZA", "Villa Ortúzar", "Villa Urquiza"]),
    ["Parque Chas", "Villa Urquiza", "Villa Ortúzar"],
  );
});
