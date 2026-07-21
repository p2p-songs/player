/**
 * `DexieStore` — the browser {@link PersistenceStore}, backed by IndexedDB via
 * [Dexie](https://dexie.org) (ARCHITECTURE §6, §9 decision 2). It is a **thin
 * adapter**: all the persistence *rules* live in `PlayerRepository` above this;
 * here we only map the keyed-collection port onto one Dexie table per collection
 * (`{ key, value }` rows — IndexedDB structure-clones the value). Swapping Dexie
 * for another engine (PocketBase-style, idb, …) is this file only.
 *
 * The `addons` table is the secret-bearing one (§6a); note that IndexedDB is
 * same-origin readable — it is organization, not a security boundary. The
 * credential-handling guarantees (no logging/export, redaction, no SW cache) are
 * upheld by the code around this store, not by the store itself.
 */
import Dexie, { type Table } from "dexie";
import { COLLECTIONS } from "./schema.js";
import type { PersistenceStore } from "./store.js";

interface Row {
  key: string;
  value: unknown;
}

export class DexieStore implements PersistenceStore {
  private readonly db: Dexie;

  constructor(name = "p2p-songs") {
    this.db = new Dexie(name);
    // One table per collection, primary-keyed by the string `key`.
    const schema: Record<string, string> = {};
    for (const collection of Object.values(COLLECTIONS)) schema[collection] = "key";
    this.db.version(1).stores(schema);
  }

  private table(collection: string): Table<Row, string> {
    return this.db.table<Row, string>(collection);
  }

  async get<T>(collection: string, key: string): Promise<T | undefined> {
    const row = await this.table(collection).get(key);
    return row ? (row.value as T) : undefined;
  }

  async getAll<T>(collection: string): Promise<T[]> {
    const rows = await this.table(collection).toArray();
    return rows.map((r) => r.value as T);
  }

  async put<T>(collection: string, key: string, value: T): Promise<void> {
    await this.table(collection).put({ key, value });
  }

  async delete(collection: string, key: string): Promise<void> {
    await this.table(collection).delete(key);
  }

  async clear(collection: string): Promise<void> {
    await this.table(collection).clear();
  }

  /** Close the underlying connection (e.g. on teardown). */
  close(): void {
    this.db.close();
  }
}
