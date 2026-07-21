/**
 * Persistence layer (ARCHITECTURE §6) — durable local state behind a swappable
 * store port. `PlayerRepository` owns the rules (persist identity not media,
 * queue hydration → idle, secret-bearing addons); `MemoryStore` is the headless
 * fake; the Dexie adapter (browser) implements the same {@link PersistenceStore}.
 */
export type { PersistenceStore } from "./store.js";
export { MemoryStore } from "./memory-store.js";
export { DexieStore } from "./dexie-store.js";
export { PlayerRepository, type PlayerRepositoryOptions } from "./repository.js";
export {
  COLLECTIONS,
  redactManifestUrl,
  isConfiguredUrl,
  type LibraryEntry,
  type Playlist,
  type InstalledAddonRecord,
  type SettingEntry,
  type PersistedQueue,
  type PlayEvent,
} from "./schema.js";
