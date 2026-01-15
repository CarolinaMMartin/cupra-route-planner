import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export const useRecommendationsStore = create<RecommendationsState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      setIsLoading: (loading) => set({ isLoading: loading }),
      setRecommendations: (recommendations) => set({ recommendations }),
      setAiInsights: (insights) => set({ aiInsights: insights }),
      setVendedoresData: (data) => set({ vendedoresData: data }),
      setInstruccionesAdicionales: (instrucciones) => set({ instruccionesAdicionales: instrucciones }),
      setSelectedSucursales: (ids) => set({ selectedSucursales: ids }),
      
      toggleSucursal: (id) => set((state) => ({
        selectedSucursales: state.selectedSucursales.includes(id)
          ? state.selectedSucursales.filter(s => s !== id)
          : [...state.selectedSucursales, id]
      })),
      
      toggleAllSucursales: () => set((state) => ({
        selectedSucursales: state.selectedSucursales.length === state.recommendations.length
          ? []
          : state.recommendations.map(r => r.id)
      })),
      
      setFlowStep: (step) => set({ flowStep: step }),
      setCurrentRequestId: (id) => set({ currentRequestId: id }),
      setLastRequestPayload: (payload) => set({ lastRequestPayload: payload }),
      
      resetToInitial: () => set(initialState),
    }),
    {
      name: 'recommendations-storage',
      partialize: (state) => ({
        recommendations: state.recommendations,
        aiInsights: state.aiInsights,
        vendedoresData: state.vendedoresData,
        instruccionesAdicionales: state.instruccionesAdicionales,
        selectedSucursales: state.selectedSucursales,
        flowStep: state.flowStep,
        isLoading: state.isLoading,
        currentRequestId: state.currentRequestId,
        lastRequestPayload: state.lastRequestPayload,
      }),
    }
  )
);
