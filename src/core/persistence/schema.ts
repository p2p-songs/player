/**
 * Persistence record shapes (ARCHITECTURE §6). The rule the whole layer enforces
 * is **persist identity, not resolved media**: library, playlists, installed
 * addons, settings, and the queue's *identity* are durable; resolved stream URLs
 * / `QueueItem.resolution` and any `/stream` result are memory-only and never
 * written here (§6/§11). Every record carries `updatedAt` so a later sync
 * adapter (§6b, P-7) can do last-writer-wins without reshaping the store.
 */
import type { TrackRef, RepeatMode, QueueItemId, RadioSeed } from "../queue/types.js";

/** The store's tables. `addons` is the **secret-bearing** one (§6a). */
export const COLLECTIONS = {
  library: "library",
  playlists: "playlists",
  addons: "addons",
  settings: "settings",
  queue: "queue",
  history: "history",
} as const;

/** A saved library reference — a track/album/artist/playlist the user starred. */
export interface LibraryEntry {
  /** The content id (`mbid:…` / `isrc:…` / `playlist:…`). */
  id: string;
  kind: "track" | "album" | "artist" | "playlist";
  name: string;
  artistName?: string;
  poster?: string;
  savedAt: number;
  updatedAt: number;
}

export interface Playlist {
  id: string;
  name: string;
  /** Ordered track identities (never resolution). */
  tracks: TrackRef[];
  createdAt: number;
  updatedAt: number;
}

/**
 * An installed addon. **`manifestUrl` is credential material** — for a configured
 * addon it embeds the debrid key (§6a) — so this record lives in the dedicated
 * secret-bearing `addons` table and its URL is never logged/exported in the clear
 * (see {@link redactManifestUrl}).
 */
export interface InstalledAddonRecord {
  /** The manifest `id` (stable key; a re-config/update replaces in place). */
  id: string;
  /** The full install URL — SECRET for configured addons. */
  manifestUrl: string;
  name: string;
  /** Whether the URL carries a config segment (i.e. is credential-bearing). */
  configured: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface SettingEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

/**
 * One play in the listening history (§6 "play history"; the durable source a
 * recently-played view and the §6b listening-state sync build on). Like every
 * other record it stores **identity only** — a `TrackRef`, never the resolved
 * stream that was actually played. History is capped by a retention limit so it
 * cannot grow without bound.
 */
export interface PlayEvent {
  id: string;
  track: TrackRef;
  playedAt: number;
}

/**
 * The persisted queue **identity** (§4a/§6) — no resolution. On hydration every
 * item is rebuilt with `resolution: idle`, so the JIT scheduler re-resolves the
 * current/next items fresh and a reload never plays from a stale bearer URL.
 */
export interface PersistedQueue {
  itemsById: Record<QueueItemId, { id: QueueItemId; track: TrackRef }>;
  canonicalOrder: QueueItemId[];
  playOrder: QueueItemId[];
  currentItemId: QueueItemId | null;
  repeat: RepeatMode;
  shuffle: boolean;
  autoplaySeed?: RadioSeed;
  updatedAt: number;
}

/**
 * Redact a configured addon's manifest URL for display/logging (§6a): show the
 * host, mask the config segment (which carries the debrid key). Never emit the
 * raw configured URL to a log, export, or the UI.
 */
export function redactManifestUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "«addon url»";
  }
  const parts = u.pathname.split("/").filter((p) => p.length > 0);
  // Configured form: `/<config>/manifest.json` — mask the leading config segment.
  if (parts.length >= 2 && parts[parts.length - 1] === "manifest.json") {
    return `${u.origin}/…/manifest.json`;
  }
  return `${u.origin}${u.pathname}`;
}

/** Does this manifest URL carry a config segment (⇒ credential-bearing)? */
export function isConfiguredUrl(url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter((p) => p.length > 0);
    return parts.length >= 2 && parts[parts.length - 1] === "manifest.json";
  } catch {
    return false;
  }
}
