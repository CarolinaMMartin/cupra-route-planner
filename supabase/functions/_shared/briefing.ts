export function construirFallback(h: Record<string, unknown>): string {
  const lineas: string[] = [];
  const gap = (h.hueco_portfolio as string[]) || [];
  const regalos = Boolean(h.oportunidad_regalos_empresariales);
  const prospecto = h.tipo === "prospecto";
  lineas.push(h.no_ofrecer_ahora || h.nota_credito_pendiente ? "Atender primero la objeción o devolución pendiente antes de ofrecer productos." : regalos
    ? "Proponer regalos empresariales; consultar ocasión, cantidad y presupuesto."
    : prospecto ? "Presentar el catálogo y consultar necesidades; validar interés antes de preparar una propuesta."
    : gap.length ? `Ofrecer: ${gap.slice(0, 3).join(", ")} (nunca compró).` : "Ofrecer: reponer las líneas que ya compra y sumar una etiqueta nueva.");
  const monto = h.monto_total as string | null;
  const dias = h.dias_desde_ultima_compra as number | null;
  lineas.push(`Por qué: ${monto ? `histórico ${monto}` : prospecto ? "prospecto sin compras confirmadas" : "sin monto registrado"}${dias !== null && dias !== undefined ? `, ${dias} días sin comprar` : ""}.`);
  const riesgos: string[] = [];
  if (h.nota_credito_pendiente) riesgos.push(`NC pendiente ${h.nota_credito_pendiente}`);
  if (h.ultima_objecion) riesgos.push(`objeción: ${h.ultima_objecion}`);
  lineas.push(riesgos.length ? `Cuidado: ${riesgos.join(" | ")}.` : regalos ? "Cómo encarar: consultar por compras, RR. HH. o eventos; confirmar responsable e interés." : prospecto ? "Cómo encarar: identificar al responsable de compras y acordar un próximo paso." : "Cómo encarar: confirmar necesidades y acordar el próximo pedido.");
  return lineas.join("\n");
}
