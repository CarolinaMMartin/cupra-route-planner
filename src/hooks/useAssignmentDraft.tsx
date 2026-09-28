import { createContext, useCallback, useContext, useRef, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { AssignmentDraftStore } from "@/lib/assignmentDrafts";
import { Button } from "@/components/ui/button";

const Context = createContext<AssignmentDraftStore | null>(null);
// También conserva el avance al cambiar de página si el navegador bloquea el almacenamiento.
const stores = new Map<string, AssignmentDraftStore>();
// Estos controles siguen activos cuando el operador navega a otra página.
if (typeof window !== "undefined") {
  window.addEventListener("storage", event => stores.forEach(store => store.acceptExternal(event.key)));
  window.addEventListener("beforeunload", event => {
    let pendiente = false;
    stores.forEach(store => { if (store.hasUnsaved() && !store.flush()) pendiente = true; });
    if (pendiente) { event.preventDefault(); event.returnValue = ""; }
  });
  const save = () => stores.forEach(store => { if (store.hasUnsaved()) store.retry(); });
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", save);
}

export function AssignmentDraftProvider({ userId, children }: { userId: string; children: ReactNode }) {
  if (!stores.has(userId)) stores.set(userId, new AssignmentDraftStore(userId, {
    getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value),
  }));
  const store = stores.get(userId)!;
  const mounted = useRef(false);
  if (!mounted.current) { store.refresh(); mounted.current = true; }
  const error = useSyncExternalStore(store.subscribe, store.status, () => null);
  return <Context.Provider value={store}>
    {error ? <div role="alert" className="mb-4 rounded-md border border-destructive/40 p-3 text-sm">{error}<Button size="sm" variant="outline" onClick={store.retry} className="ml-2">Reintentar guardado</Button></div>
      : <p role="status" className="mb-4 text-xs text-muted-foreground">Tu avance se guarda automáticamente en este navegador. Podés cambiar de pantalla y retomarlo al volver.</p>}
    {children}
  </Context.Provider>;
}
export function useAssignmentDraftStore() {
  const store = useContext(Context);
  if (!store) throw new Error("Falta el contexto de borradores de asignación");
  return store;
}
export function useDraftState<T>(scope: string, field: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const store = useAssignmentDraftStore();
  const initialRef = useRef<{ value: T }>();
  if (!initialRef.current) initialRef.current = { value: typeof initial === "function" ? (initial as () => T)() : initial };
  const get = useCallback(() => store.get(scope, field, initialRef.current!.value), [store, scope, field]);
  const value = useSyncExternalStore(store.subscribe, get, get);
  const set = useCallback<Dispatch<SetStateAction<T>>>(action => store.set(scope, field, action, initialRef.current!.value), [store, scope, field]);
  return [value, set];
}
