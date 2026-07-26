/**
 * Queue model (ARCHITECTURE §4a). Identity is by **stable `QueueItemId`**, never
 * by array index — the fix for the shuffle/insert/remove ambiguity of the early
 * cursor+order draft. Two id sequences: `canonicalOrder` (the order the user
 * built) and `playOrder` (the order playback follows; == canonical when shuffle
 * is off, a derived shuffle when on). Position is `currentItemId`, never an index.
 */
import type { RecordingId, TrackId, ReleaseId, Stream } from "@p2p-songs/protocol";

export type RepeatMode = "off" | "one" | "all";
export type QueueItemId = string;

/**
 * A persistable reference to a track. Identity is entity-typed MBIDs (Plan §8):
 * `recordingId` is THE streamable / cache / dedup key; `trackId`/`releaseId` are
 * album context only.
 */
export interface TrackRef {
  recordingId: RecordingId;
  trackId?: TrackId;
  releaseId?: ReleaseId;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  artwork?: string;
}

/**
 * Per-item resolution. **Memory-only** — never persisted; forced to `idle` on
 * hydration (§6). `expiresAt` is only ever a hint (§5); correctness never
 * depends on it.
 */
export type ResolutionState =
  | { status: "idle" }
  | { status: "resolving" }
  /**
   * A source isn't ready yet but is being prepared — a stream addon reported
   * `resolving` (e.g. a debrid addon downloading an uncached torrent). The engine
   * holds the track and re-resolves rather than skipping; the UI shows progress.
   */
  | { status: "downloading"; progress?: number; message?: string }
  | { status: "resolved"; streams: Stream[]; chosenIdx: number; url: string; expiresAt?: string }
  | { status: "failed"; reason?: string };

export interface QueueItem {
  id: QueueItemId;
  track: TrackRef;
  resolution: ResolutionState;
}

/** Seed for autoplay/radio extension when the queue nears its end (§4a). */
export interface RadioSeed {
  kind: "artist" | "album" | "track";
  /** The seed entity's content id. */
  id: string;
}

export interface Queue {
  itemsById: Record<QueueItemId, QueueItem>;
  /** The order the user built (playlist/album order); stable, never touched by shuffle. */
  canonicalOrder: QueueItemId[];
  /** The order playback follows; == canonicalOrder when shuffle off, derived when on. */
  playOrder: QueueItemId[];
  /** Position IS an id, never an index. `null` == nothing selected. */
  currentItemId: QueueItemId | null;
  repeat: RepeatMode;
  shuffle: boolean;
  autoplaySeed?: RadioSeed;
}

/** Generates stable, unique queue-item ids. Injected so tests are deterministic. */
export type IdGen = () => QueueItemId;

/** A default counter-based id generator (`q1`, `q2`, …). Each call to this returns a fresh sequence. */
export function counterIdGen(prefix = "q"): IdGen {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Deterministic RNG hook for shuffle (defaults to Math.random). Returns [0,1). */
export type Rng = () => number;
