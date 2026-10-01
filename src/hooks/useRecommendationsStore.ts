import { useState } from "react";
import { useDraftState } from "./useAssignmentDraft";
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

export function useRecommendationsStore(): RecommendationsState {
  const [state, setState] = useDraftState<RecommendationDraft>("recomendaciones", "state", initialState);
  const [isLoading, setIsLoading] = useState(false);
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
