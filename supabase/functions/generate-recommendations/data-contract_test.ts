// Contrato de datos del motor: identidad geográfica (OT1) y reglas del importador (OT3/R4).
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  alertaNotaCredito,
  areaKey,
  belongsToArea,
  buildAreaFilter,
  cadenciaCliente,
  prioridadBase,
} from "./portfolio-ranking.ts";

const casco = buildAreaFilter(
  ["Monserrat", "San Telmo", "San Nicolás", "Constitución", "Barracas", "Puerto Madero", "San Cristóbal", "Balvanera"],
  ["Comuna 1", "Comuna 3", "Comuna 4"],
);

Deno.test("identidad: el acento no expulsa cuentas legítimas", () => {
  assertEquals(areaKey(" San  Nicolás "), "SAN NICOLAS");
  assert(belongsToArea({ barrio: "San Nicolas" }, casco));
  assert(belongsToArea({ barrio: "SAN NICOLÁS" }, casco));
});

Deno.test("identidad: el barrio manda y la comuna es solo respaldo", () => {
  // Palermo es Comuna 14: no entra ni aunque la comuna venga cargada mal.
  assertFalse(belongsToArea({ barrio: "Palermo", comuna: "Comuna 1" }, casco));
  // Sin barrio, se cae a la comuna.
  assert(belongsToArea({ barrio: null, comuna: "Comuna 4" }, casco));
  assertFalse(belongsToArea({ barrio: null, comuna: "Comuna 14" }, casco));
});

Deno.test("identidad: Comuna 1 no matchea Comuna 10-15", () => {
  assertFalse(belongsToArea({ barrio: null, comuna: "Comuna 11" }, casco));
});

Deno.test("contrato ETL: el monto histórico es bruto, nunca neteado por NC", () => {
  // Un cliente que devolvió todo sigue con monto bruto positivo y ticket positivo.
  const cliente = {
    monto_total_historico: 1_700_000,
    monto_notas_credito: 1_700_000,
    fecha_ultima_nc: "2026-07-20",
    cantidad_ordenes: 2,
    dias_desde_ultima_compra: 127,
    cadencia_dias: 40,
  };
  assert(cliente.monto_total_historico > 0);
  const alerta = alertaNotaCredito(cliente);
  assert(alerta, "una devolución del 100% tiene que disparar la alerta de servicio");
  assertEquals(alerta!.fecha, "2026-07-20");
});

Deno.test("contrato ETL: sin cadencia propia se usa la del canal", () => {
  assertEquals(cadenciaCliente({ cadencia_dias: null }), 45);
  assertEquals(cadenciaCliente({ cadencia_dias: 26 }), 26);
});

Deno.test("prioridad: ESTILO CAMPO (26/26) le gana a una cuenta chica al día", () => {
  const estiloCampo = {
    monto_total_historico: 13_000_000,
    cadencia_dias: 26,
    dias_desde_ultima_compra: 26,
  };
  const chicaAlDia = {
    monto_total_historico: 1_790_000,
    cadencia_dias: 60,
    dias_desde_ultima_compra: 5,
  };
  assert(prioridadBase(estiloCampo) > prioridadBase(chicaAlDia) * 5);
});
