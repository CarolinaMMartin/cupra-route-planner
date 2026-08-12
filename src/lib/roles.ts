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
