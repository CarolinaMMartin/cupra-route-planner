export type AppRole = "administrador" | "asignador" | "vendedor";

/** Perfiles con capacidades de asignación (administrador y asignador). */
export function isAssignorLike(rol?: string | null): boolean {
  return rol === "administrador" || rol === "asignador";
}

export function isAdmin(rol?: string | null): boolean {
  return rol === "administrador";
}

/** Solo el administrador ve el dashboard de ventas / histórico. */
export function canViewSalesDashboard(rol?: string | null): boolean {
  return isAdmin(rol);
}

/** Solo el administrador puede crear o promover asignadores y administradores. */
export function canManageAssignors(rol?: string | null): boolean {
  return isAdmin(rol);
}

export const ROLE_LABELS: Record<string, string> = {
  administrador: "Administrador",
  asignador: "Asignador",
  vendedor: "Vendedor",
};

/**
 * Filtro PostgREST para listar perfiles que pueden recibir visitas/asignaciones:
 * vendedores puros + cualquier perfil (asignador/administrador) con doble perfil de ventas.
 * Usar como: .or(SALES_PROFILE_OR_FILTER).eq("activo", true)
 */
export const SALES_PROFILE_OR_FILTER = "rol.eq.vendedor,perfil_ventas.eq.true";
