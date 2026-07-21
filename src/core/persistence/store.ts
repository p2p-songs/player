/**
 * The persistence **port** (ARCHITECTURE §6, §9 decision 2). A narrow
 * keyed-collection store the `PlayerRepository` builds on, so the durable-state
 * logic (what persists, queue hydration, secret handling) is testable headlessly
 * against an in-memory fake and the concrete engine (Dexie/IndexedDB) stays a
 * thin, swappable adapter behind this interface — exactly the "swappable behind
 * `core/persistence`" decision.
 */
export interface PersistenceStore {
  get<T>(collection: string, key: string): Promise<T | undefined>;
  getAll<T>(collection: string): Promise<T[]>;
  put<T>(collection: string, key: string, value: T): Promise<void>;
  delete(collection: string, key: string): Promise<void>;
  clear(collection: string): Promise<void>;
}
