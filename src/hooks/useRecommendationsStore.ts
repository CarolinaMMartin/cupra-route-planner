import { useEffect, useState } from "react";
import { useDraftState, useAssignmentDraftStore } from "./useAssignmentDraft";
import { Sucursal } from "@/types/sales";

interface RecommendationsState {
  // Estado de la búsqueda
  isLoading: boolean;
  recommendations: Sucursal[];
  aiInsights: any | null;
  vendedoresData: Array<{ id: string; nombre: string }>;
  instruccionesAdicionales: string;
  selectedSucursales: string[];
  flowStep: 'recommendations' | 'preselection' | 'assignment' | 'edit-select' | 'edit-kanban';
  
  // Request tracking
  currentRequestId: string | null;
  lastRequestPayload: any | null;
  
  // Acciones
  setIsLoading: (loading: boolean) => void;
  setRecommendations: (recommendations: Sucursal[]) => void;
  setAiInsights: (insights: any) => void;
  setVendedoresData: (data: Array<{ id: string; nombre: string }>) => void;
  setInstruccionesAdicionales: (instrucciones: string) => void;
  setSelectedSucursales: (ids: string[]) => void;
  toggleSucursal: (id: string) => void;
  toggleAllSucursales: () => void;
  setFlowStep: (step: 'recommendations' | 'preselection' | 'assignment' | 'edit-select' | 'edit-kanban') => void;
  setCurrentRequestId: (id: string | null) => void;
  setLastRequestPayload: (payload: any) => void;
  
  // Reset
  resetToInitial: () => void;
}

const initialState = {
  isLoading: false,
  recommendations: [],
  aiInsights: null,
  vendedoresData: [],
  instruccionesAdicionales: '',
  selectedSucursales: [],
  flowStep: 'recommendations' as const,
  currentRequestId: null,
  lastRequestPayload: null,
};

type RecommendationDraft = Pick<RecommendationsState, "recommendations" | "aiInsights" | "vendedoresData" | "instruccionesAdicionales" | "selectedSucursales" | "flowStep" | "currentRequestId" | "lastRequestPayload">;

/** Keeps the previous browser draft while migrating to storage scoped to the signed-in user. */
function legacyDraft() {
  try {
    const old = JSON.parse(window.localStorage.getItem("recommendations-storage") || "null")?.state;
    if (old && Array.isArray(old.recommendations) && Array.isArray(old.selectedSucursales)) {
      return { ...initialState, ...Object.fromEntries(Object.keys(initialState).filter(k => k in old).map(k => [k, old[k]])), isLoading: false, currentRequestId: null };
    }
  } catch { /* El almacén común informa problemas de guardado. */ }
  return initialState;
}

export function useRecommendationsStore(): RecommendationsState {
  const store = useAssignmentDraftStore();
  const [state, setState] = useDraftState<RecommendationDraft>("recomendaciones", "state", legacyDraft);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (store.get("recomendaciones", "state", null) === null) {
      setState(state);
      if (!store.status()) { try { window.localStorage.removeItem("recommendations-storage"); } catch { /* Se conserva la copia anterior. */ } }
    }
    // La migración se hace una sola vez por sesión identificada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  const patch = (change: Partial<typeof state>) => setState(prev => ({ ...prev, ...change }));
  return {
    ...state, isLoading, setIsLoading,
    setRecommendations: recommendations => patch({ recommendations }),
    setAiInsights: aiInsights => patch({ aiInsights }),
    setVendedoresData: vendedoresData => patch({ vendedoresData }),
    setInstruccionesAdicionales: instruccionesAdicionales => patch({ instruccionesAdicionales }),
    setSelectedSucursales: selectedSucursales => patch({ selectedSucursales }),
    toggleSucursal: id => setState(prev => ({ ...prev, selectedSucursales: prev.selectedSucursales.includes(id)
      ? prev.selectedSucursales.filter(s => s !== id) : [...prev.selectedSucursales, id] })),
    toggleAllSucursales: () => setState(prev => ({ ...prev, selectedSucursales: prev.selectedSucursales.length === prev.recommendations.length
      ? [] : prev.recommendations.map(r => r.id) })),
    setFlowStep: flowStep => patch({ flowStep }),
    setCurrentRequestId: currentRequestId => patch({ currentRequestId }),
    setLastRequestPayload: lastRequestPayload => patch({ lastRequestPayload }),
    resetToInitial: () => { setState(initialState); setIsLoading(false); },
  };
}
