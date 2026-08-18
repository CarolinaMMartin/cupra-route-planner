import { useCallback, useEffect, useState } from "react";
import { isAssignorLike } from "@/lib/roles";

export type ViewMode = "gestion" | "ventas";

const STORAGE_KEY = "cupra:view-mode";
const EVENT = "cupra:view-mode-change";

function read(): ViewMode {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
  return raw === "ventas" ? "ventas" : "gestion";
}

/**
 * Modo de vista para perfiles con rol de gestión (administrador / asignador)
 * que además trabajan como vendedores: permite alternar entre el panel de
 * asignación y su propio espacio de ventas con la misma cuenta.
 */
export function useViewMode(rol?: string | null) {
  const puedeAlternar = isAssignorLike(rol);
  const [mode, setModeState] = useState<ViewMode>(read);

  useEffect(() => {
    const onChange = () => setModeState(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setMode = useCallback((next: ViewMode) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent(EVENT));
  }, []);

  // Un vendedor puro siempre está en su espacio de ventas.
  const effectiveMode: ViewMode = puedeAlternar ? mode : "ventas";

  return { mode: effectiveMode, setMode, puedeAlternar };
}
