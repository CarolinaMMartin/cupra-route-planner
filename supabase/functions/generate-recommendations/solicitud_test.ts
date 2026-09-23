import { deepStrictEqual as assertEquals, throws } from "node:assert/strict";
import { validarSolicitud, SolicitudInvalida } from "./solicitud.ts";

Deno.test("validación: acepta filtros opcionales nulos usados por el panel", () => {
  const input = validarSolicitud({ vendedores: ["00000000-0000-0000-0000-000000000001"], barrio: null, comuna: null, estados: ["POTENCIAL"] });
  assertEquals(input.barrio, []);
  assertEquals(input.estados, ["POTENCIAL"]);
});
Deno.test("validación: rechaza tipos incorrectos y filtros manipulados antes de consultar", () => {
  for (const input of [{ vendedores: "todos" }, { vendedores: ["x),activo.eq.true"] }, { estados: ["inexistente"] }, { rubros: [null] }, { area_id: "ninguna" }, { instrucciones_adicionales: "x".repeat(4001) }]) {
    throws(() => validarSolicitud(input), SolicitudInvalida);
  }
});
