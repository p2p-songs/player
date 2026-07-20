/**
 * Audio backend interface (ARCHITECTURE §4c). A narrow surface so the engine and
 * machine are testable against a fake with no DOM; the real P-2 backend is the
 * dual-`<audio>` + volume-automation implementation behind this same interface.
 *
 * Every load/preload carries a **token** (the engine passes a serialized stamp),
 * and every event echoes it back — so a completion is tied to the exact attempt
 * that started it. A late `loaded`/`ended`/`error` for a superseded attempt is
 * recognizable and can be dropped by identity (§4b), not misapplied to whatever
 * happens to be current now.
 */
export type AudioEvent =
  | { type: "loaded"; token: string }
  | { type: "error"; token: string; reason?: string }
  | { type: "ended"; token: string }
  | { type: "position"; token: string; ms: number };

export interface AudioBackend {
  /** Load the active element with `url`, tagged with `token`; buffers to canplay. */
  load(url: string, token: string): void;
  play(): void;
  pause(): void;
  seek(ms: number): void;
  /** Buffer the next track on the idle element ahead of time. */
  preload(url: string, token: string): void;
  /** Stop and release the active element. */
  stop(): void;
  /** Subscribe to backend events; returns an unsubscribe. */
  subscribe(handler: (event: AudioEvent) => void): () => void;
}
