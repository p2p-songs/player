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
  /**
   * **Atomically** read-modify-write one key: `fn` receives the current value
   * (or `undefined`) and returns the next one; returning `undefined` writes
   * nothing. No other mutation of the same key may interleave between the read
   * and the write.
   *
   * This is a port-level primitive on purpose (audit A-009). Composing `get`
   * then `put` in a caller is *not* equivalent — two overlapping edits each read
   * the same prior value and the second `put` silently discards the first, which
   * is how a user's playlist addition can vanish. Only the adapter can make the
   * pair atomic (a Dexie `rw` transaction; a synchronous section in memory).
   */
  update<T>(collection: string, key: string, fn: (current: T | undefined) => T | undefined): Promise<void>;
}
