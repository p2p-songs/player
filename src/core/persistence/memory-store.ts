/**
 * In-memory {@link PersistenceStore} — the fake the repository logic is tested
 * against (no IndexedDB), and a usable store for ephemeral/SSR contexts. Values
 * are structure-cloned on the way in and out so a caller can't mutate stored
 * state by reference (mirroring the real IndexedDB adapter's serialize boundary).
 */
import type { PersistenceStore } from "./store.js";

export class MemoryStore implements PersistenceStore {
  private readonly data = new Map<string, Map<string, unknown>>();

  private table(collection: string): Map<string, unknown> {
    let t = this.data.get(collection);
    if (!t) this.data.set(collection, (t = new Map()));
    return t;
  }

  async get<T>(collection: string, key: string): Promise<T | undefined> {
    const v = this.table(collection).get(key);
    return v === undefined ? undefined : (clone(v) as T);
  }

  async getAll<T>(collection: string): Promise<T[]> {
    return [...this.table(collection).values()].map((v) => clone(v) as T);
  }

  async put<T>(collection: string, key: string, value: T): Promise<void> {
    this.table(collection).set(key, clone(value));
  }

  async delete(collection: string, key: string): Promise<void> {
    this.table(collection).delete(key);
  }

  async clear(collection: string): Promise<void> {
    this.table(collection).delete("");
    this.data.get(collection)?.clear();
  }
}

function clone<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}
