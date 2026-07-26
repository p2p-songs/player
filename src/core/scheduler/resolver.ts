/**
 * The resolver interface (ARCHITECTURE §5/§5a). Turning a track into a ranked
 * list of playable streams is the **resolution command plane**: credentialed,
 * rate-limited, possibly state-changing — NOT a cacheable GET. So it lives
 * behind this narrow interface (the real one is the addon `/stream` client in
 * P-3; a fake drives P-1), and the scheduler that calls it applies command-plane
 * semantics: dedup by operation id, no retry/refetch, cancellation, memory-only.
 */
import type { Resolving, Stream } from "@p2p-songs/protocol";
import type { TrackRef } from "../queue/types.js";

export type ResolveOutcome =
  | { ok: true; streams: Stream[] }
  /**
   * No stream *yet* — a provider is preparing one (e.g. a debrid addon
   * downloading an uncached torrent). The engine holds the track and re-resolves
   * on the provider's cadence instead of skipping it.
   */
  | { ok: false; resolving: Resolving }
  | { ok: false; reason?: string };

export interface Resolver {
  /** Resolve a track to a ranked stream list. Honor `signal` for cancellation. */
  resolve(track: TrackRef, signal: AbortSignal): Promise<ResolveOutcome>;
}
