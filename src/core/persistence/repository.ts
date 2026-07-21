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
  type PlayEvent,
  type Playlist,
  type SettingEntry,
} from "./schema.js";
import type { TrackRef } from "../queue/types.js";

export interface PlayerRepositoryOptions {
  now?: () => number;
  newId?: () => string;
  /** Max play-history entries to retain; oldest are pruned past this (default 500). */
  historyLimit?: number;
}

const QUEUE_KEY = "current";

export class PlayerRepository {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly historyLimit: number;

  constructor(private readonly store: PersistenceStore, options: PlayerRepositoryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.historyLimit = options.historyLimit ?? 500;
  }

  // --- library ---

  async saveToLibrary(entry: Omit<LibraryEntry, "savedAt" | "updatedAt">): Promise<void> {
    const now = this.now();
    // Atomic: preserving `savedAt` is a read-modify-write, so it must not race
    // another save of the same entry (audit A-009).
    await this.store.update<LibraryEntry>(COLLECTIONS.library, entry.id, (existing) => ({
      ...entry,
      savedAt: existing?.savedAt ?? now,
      updatedAt: now,
    }));
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

  /**
   * All playlist edits funnel through one **atomic** read-modify-write. Composing
   * `get` + `put` here would let two overlapping edits each read the same prior
   * list and the second write silently discard the first — a user's addition
   * vanishing with no error (audit A-009).
   */
  private async mutatePlaylist(id: string, fn: (pl: Playlist) => Playlist): Promise<void> {
    await this.store.update<Playlist>(COLLECTIONS.playlists, id, (pl) =>
      pl === undefined ? undefined : { ...fn(pl), updatedAt: this.now() },
    );
  }

  // --- installed addons (secret-bearing, §6a) ---

  async saveAddon(addon: { id: string; manifestUrl: string; name: string }): Promise<void> {
    const now = this.now();
    await this.store.update<InstalledAddonRecord>(COLLECTIONS.addons, addon.id, (existing) => ({
      id: addon.id,
      manifestUrl: addon.manifestUrl,
      name: addon.name,
      configured: isConfiguredUrl(addon.manifestUrl),
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
    }));
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

  // --- play history (§6) ---

  /**
   * Record that `track` was played. Stores **identity only** — never the
   * resolved stream it played from — and prunes past the retention limit so the
   * history can't grow unbounded.
   */
  async recordPlay(track: TrackRef): Promise<void> {
    const event: PlayEvent = { id: this.newId(), track, playedAt: this.now() };
    await this.store.put(COLLECTIONS.history, event.id, event);
    await this.pruneHistory();
  }

  /** Most-recently-played first. */
  async listRecentPlays(limit = 50): Promise<PlayEvent[]> {
    const all = await this.store.getAll<PlayEvent>(COLLECTIONS.history);
    return all.sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
  }

  clearHistory(): Promise<void> {
    return this.store.clear(COLLECTIONS.history);
  }

  /** Drop the oldest entries beyond `historyLimit`. */
  private async pruneHistory(): Promise<void> {
    const all = await this.store.getAll<PlayEvent>(COLLECTIONS.history);
    if (all.length <= this.historyLimit) return;
    const excess = all.sort((a, b) => b.playedAt - a.playedAt).slice(this.historyLimit);
    for (const e of excess) await this.store.delete(COLLECTIONS.history, e.id);
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
