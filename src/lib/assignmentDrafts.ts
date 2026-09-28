export interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface RecordDraft { version: 1; values: Record<string, unknown>; updatedAt: number }
const replacer = (_key: string, value: unknown) => value instanceof Set ? { __cupraSet: [...value] } : value;
const reviver = (_key: string, value: unknown) => value && typeof value === "object" && "__cupraSet" in value
  && Array.isArray(value.__cupraSet) ? new Set(value.__cupraSet) : value;

/** Synchronous saves: navigation immediately after a click cannot outrun an effect/debounce. */
export class AssignmentDraftStore {
  readonly prefix: string;
  private records = new Map<string, RecordDraft>();
  private dirty = new Set<string>();
  private listeners = new Set<() => void>();
  private storage: DraftStorage;
  error: string | null = null;
  constructor(userId: string, storage: DraftStorage) {
    if (!userId) throw new Error("El borrador necesita una sesión identificada.");
    this.storage = storage;
    this.prefix = `cupra:assignments:v1:${userId}:`;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach(listener => listener()); }
  private read(scope: string): RecordDraft | null {
    const raw = this.storage.getItem(this.prefix + scope);
    if (!raw) return null;
    const value = JSON.parse(raw, reviver);
    if (value?.version !== 1 || !value.values || typeof value.values !== "object" || Array.isArray(value.values)) throw new Error("Borrador incompatible");
    return value;
  }
  private record(scope: string): RecordDraft {
    if (!this.records.has(scope)) {
      try { this.records.set(scope, this.read(scope) || { version: 1, values: {}, updatedAt: 0 }); }
      catch { this.error = "No se pudo recuperar un borrador del navegador. Revisá la selección antes de continuar."; this.records.set(scope, { version: 1, values: {}, updatedAt: 0 }); }
    }
    return this.records.get(scope)!;
  }
  get<T>(scope: string, field: string, initial: T): T {
    const values = this.record(scope).values;
    return Object.prototype.hasOwnProperty.call(values, field) ? values[field] as T : initial;
  }
  set<T>(scope: string, field: string, action: T | ((prev: T) => T), initial: T): void {
    let record = this.record(scope);
    // Otra pestaña puede haber actualizado un campo distinto desde el último render.
    if (!this.dirty.has(scope)) { try { record = this.read(scope) || record; } catch { /* conservar memoria */ } }
    const prev = Object.prototype.hasOwnProperty.call(record.values, field) ? record.values[field] as T : initial;
    const next = typeof action === "function" ? (action as (prev: T) => T)(prev) : action;
    this.records.set(scope, { version: 1, values: { ...record.values, [field]: next }, updatedAt: Date.now() });
    this.dirty.add(scope); this.flush(); this.emit();
  }
  clear(scope: string): void {
    // Tombstone: otras pestañas reciben que la selección fue confirmada o descartada.
    this.records.set(scope, { version: 1, values: {}, updatedAt: Date.now() });
    this.dirty.add(scope); this.flush(); this.emit();
  }
  flush = (): boolean => {
    try {
      for (const scope of this.dirty) {
        this.storage.setItem(this.prefix + scope, JSON.stringify(this.records.get(scope), replacer));
        this.dirty.delete(scope);
      }
      this.error = null; return true;
    } catch {
      this.error = "No se pudo guardar el borrador en este navegador. Conservamos el avance mientras la aplicación siga abierta. Reintentá antes de cerrarla.";
      return false;
    }
  };
  retry = () => { this.flush(); this.emit(); };
  hasUnsaved = () => this.dirty.size > 0;
  status = () => this.error;
  refresh(): void {
    for (const scope of this.records.keys()) {
      if (this.dirty.has(scope)) continue;
      try { this.records.set(scope, this.read(scope) || { version: 1, values: {}, updatedAt: 0 }); }
      catch { /* Conservar el último borrador legible. */ }
    }
  }
  acceptExternal(key: string | null): void {
    if (!key?.startsWith(this.prefix)) return;
    const scope = key.slice(this.prefix.length);
    if (this.dirty.has(scope)) return;
    // Leer el valor vigente evita aplicar eventos atrasados de otra pestaña.
    try { this.records.set(scope, this.read(scope) || { version: 1, values: {}, updatedAt: 0 }); this.emit(); }
    catch { /* Un evento inválido no pisa el borrador en memoria. */ }
  }
}
