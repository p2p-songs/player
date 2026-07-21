/**
 * `PlayerRepository` — durable state over a {@link PersistenceStore}
 * (ARCHITECTURE §6). This is the "thin adapter" that owns the persistence
 * *rules*, independent of whether the backing store is Dexie or in-memory:
 *
 * - **Persist identity, not resolved media.** `saveQueue` strips every
 *   `QueueItem.resolution`; `loadQueue` rebuilds each item with `resolution:
 *   idle`, so the JIT scheduler re-resolves fresh and a reload never plays a
 *   stale/secret bearer URL (§6/§11).
 * - **Installed addons are secret-bearing (§6a).** They live in their own table;
 *   the record marks whether the URL is `configured` (credential-bearing) and
 *   the URL is only ever surfaced through `redactManifestUrl`.
 *
 * `now`/`newId` are injected so tests are deterministic.
 */
import type { Queue, QueueItem } from "../queue/types.js";
import type { PersistenceStore } from "./store.js";
import {
  COLLECTIONS,
  isConfiguredUrl,
  type InstalledAddonRecord,
  type LibraryEntry,
  type PersistedQueue,
  type Playlist,
  type SettingEntry,
} from "./schema.js";
import type { TrackRef } from "../queue/types.js";

export interface PlayerRepositoryOptions {
  now?: () => number;
  newId?: () => string;
}

const QUEUE_KEY = "current";

export class PlayerRepository {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly store: PersistenceStore, options: PlayerRepositoryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  // --- library ---

  async saveToLibrary(entry: Omit<LibraryEntry, "savedAt" | "updatedAt">): Promise<void> {
    const now = this.now();
    const existing = await this.store.get<LibraryEntry>(COLLECTIONS.library, entry.id);
    await this.store.put<LibraryEntry>(COLLECTIONS.library, entry.id, {
      ...entry,
      savedAt: existing?.savedAt ?? now,
      updatedAt: now,
    });
  }

  removeFromLibrary(id: string): Promise<void> {
    return this.store.delete(COLLECTIONS.library, id);
  }

  async isInLibrary(id: string): Promise<boolean> {
    return (await this.store.get<LibraryEntry>(COLLECTIONS.library, id)) !== undefined;
  }

  async listLibrary(): Promise<LibraryEntry[]> {
    const all = await this.store.getAll<LibraryEntry>(COLLECTIONS.library);
    return all.sort((a, b) => b.savedAt - a.savedAt); // most-recently-saved first
  }

  // --- playlists ---

  async createPlaylist(name: string): Promise<Playlist> {
    const now = this.now();
    const playlist: Playlist = { id: this.newId(), name, tracks: [], createdAt: now, updatedAt: now };
    await this.store.put(COLLECTIONS.playlists, playlist.id, playlist);
    return playlist;
  }

  deletePlaylist(id: string): Promise<void> {
    return this.store.delete(COLLECTIONS.playlists, id);
  }

  getPlaylist(id: string): Promise<Playlist | undefined> {
    return this.store.get<Playlist>(COLLECTIONS.playlists, id);
  }

  async listPlaylists(): Promise<Playlist[]> {
    const all = await this.store.getAll<Playlist>(COLLECTIONS.playlists);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    await this.mutatePlaylist(id, (pl) => ({ ...pl, name }));
  }

  async addToPlaylist(id: string, track: TrackRef): Promise<void> {
    await this.mutatePlaylist(id, (pl) => ({ ...pl, tracks: [...pl.tracks, track] }));
  }

  /** Remove the track at `index` (index-based, since a playlist may hold the same track twice). */
  async removeFromPlaylist(id: string, index: number): Promise<void> {
    await this.mutatePlaylist(id, (pl) => ({ ...pl, tracks: pl.tracks.filter((_, i) => i !== index) }));
  }

  /** Replace the whole track list (reorder / bulk edit). */
  async setPlaylistTracks(id: string, tracks: TrackRef[]): Promise<void> {
    await this.mutatePlaylist(id, (pl) => ({ ...pl, tracks }));
  }

  private async mutatePlaylist(id: string, fn: (pl: Playlist) => Playlist): Promise<void> {
    const pl = await this.store.get<Playlist>(COLLECTIONS.playlists, id);
    if (!pl) return;
    await this.store.put(COLLECTIONS.playlists, id, { ...fn(pl), updatedAt: this.now() });
  }

  // --- installed addons (secret-bearing, §6a) ---

  async saveAddon(addon: { id: string; manifestUrl: string; name: string }): Promise<void> {
    const now = this.now();
    const existing = await this.store.get<InstalledAddonRecord>(COLLECTIONS.addons, addon.id);
    await this.store.put<InstalledAddonRecord>(COLLECTIONS.addons, addon.id, {
      id: addon.id,
      manifestUrl: addon.manifestUrl,
      name: addon.name,
      configured: isConfiguredUrl(addon.manifestUrl),
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
    });
  }

  removeAddon(id: string): Promise<void> {
    return this.store.delete(COLLECTIONS.addons, id);
  }

  getAddon(id: string): Promise<InstalledAddonRecord | undefined> {
    return this.store.get<InstalledAddonRecord>(COLLECTIONS.addons, id);
  }

  async listAddons(): Promise<InstalledAddonRecord[]> {
    const all = await this.store.getAll<InstalledAddonRecord>(COLLECTIONS.addons);
    return all.sort((a, b) => a.addedAt - b.addedAt); // install order
  }

  // --- settings ---

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const entry = await this.store.get<SettingEntry>(COLLECTIONS.settings, key);
    return entry === undefined ? fallback : (entry.value as T);
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.store.put<SettingEntry>(COLLECTIONS.settings, key, { key, value, updatedAt: this.now() });
  }

  // --- queue identity (§4a/§6): persist identity, never resolution ---

  async saveQueue(queue: Queue): Promise<void> {
    const itemsById: PersistedQueue["itemsById"] = {};
    for (const [id, item] of Object.entries(queue.itemsById)) {
      itemsById[id] = { id: item.id, track: item.track }; // resolution deliberately dropped
    }
    const persisted: PersistedQueue = {
      itemsById,
      canonicalOrder: queue.canonicalOrder,
      playOrder: queue.playOrder,
      currentItemId: queue.currentItemId,
      repeat: queue.repeat,
      shuffle: queue.shuffle,
      ...(queue.autoplaySeed ? { autoplaySeed: queue.autoplaySeed } : {}),
      updatedAt: this.now(),
    };
    await this.store.put(COLLECTIONS.queue, QUEUE_KEY, persisted);
  }

  /** Rehydrate the queue with every item forced to `resolution: idle` (§6). */
  async loadQueue(): Promise<Queue | undefined> {
    const p = await this.store.get<PersistedQueue>(COLLECTIONS.queue, QUEUE_KEY);
    if (!p) return undefined;
    const itemsById: Record<string, QueueItem> = {};
    for (const [id, item] of Object.entries(p.itemsById)) {
      itemsById[id] = { id: item.id, track: item.track, resolution: { status: "idle" } };
    }
    return {
      itemsById,
      canonicalOrder: p.canonicalOrder,
      playOrder: p.playOrder,
      currentItemId: p.currentItemId,
      repeat: p.repeat,
      shuffle: p.shuffle,
      ...(p.autoplaySeed ? { autoplaySeed: p.autoplaySeed } : {}),
    };
  }

  clearQueue(): Promise<void> {
    return this.store.delete(COLLECTIONS.queue, QUEUE_KEY);
  }
}
