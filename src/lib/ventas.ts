/** Identidad de comprobante consistente con resumen_ventas en PostgreSQL. */
export const claveComprobante = (v: {tipo_comprobante?: string; fecha_emision?: string; letra?: string; ticket?: string; client_id?: string}) =>
  JSON.stringify([v.tipo_comprobante ?? null,v.fecha_emision ?? null,v.letra ?? null,v.ticket ?? null,v.client_id ?? null]);

