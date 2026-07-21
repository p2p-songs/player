/**
 * MediaSession binding (ARCHITECTURE §4c, §7) — wires engine state to the OS
 * media controls (lock screen, media keys, Bluetooth, notification): it mirrors
 * the current track's metadata + play/pause state out to `navigator.mediaSession`
 * and routes the platform action handlers (play/pause/next/prev/seek/stop) back
 * into engine commands. For a background music app this is a headline feature,
 * not polish.
 *
 * It depends only on a narrow command surface (which `Engine` satisfies) and an
 * injectable `MediaSessionLike` — so it's unit-testable headlessly, and it
 * degrades to a no-op where the platform has no MediaSession (SSR / headless).
 * It reads engine state and issues commands; it never owns playback/queue logic
 * (the §8a engine/UI rule).
 */
import type { EngineState } from "../engine/engine.js";

/** The subset of the platform `MediaSession` this binding touches. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler(action: string, handler: ((details: { seekTime?: number }) => void) | null): void;
}

export interface MediaMetadataInit {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: { src: string }[];
}

/** The engine commands MediaSession drives (satisfied by `Engine`). */
export interface MediaSessionEngine {
  getState(): EngineState;
  subscribe(listener: (state: EngineState) => void): () => void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(ms: number): void;
  stop(): void;
}

export interface BindMediaSessionOptions {
  /** The session to drive (default: `navigator.mediaSession` when present). */
  session?: MediaSessionLike;
  /** Build a metadata object (default: `new MediaMetadata(init)`). */
  createMetadata?: (init: MediaMetadataInit) => unknown;
}

/**
 * Bind `engine` to the platform MediaSession. Returns an unbind that removes the
 * action handlers and stops mirroring. A no-op (returns an empty unbind) where no
 * MediaSession is available.
 */
export function bindMediaSession(engine: MediaSessionEngine, options: BindMediaSessionOptions = {}): () => void {
  const session = options.session ?? platformSession();
  if (!session) return () => {};
  const createMetadata = options.createMetadata ?? ((init: MediaMetadataInit) => new MediaMetadata(init));

  const handlers: Record<string, (details: { seekTime?: number }) => void> = {
    play: () => engine.play(),
    pause: () => engine.pause(),
    nexttrack: () => engine.next(),
    previoustrack: () => engine.prev(),
    stop: () => engine.stop(),
    seekto: (details) => {
      if (typeof details.seekTime === "number") engine.seek(details.seekTime * 1000);
    },
  };
  for (const [action, handler] of Object.entries(handlers)) safeSetHandler(session, action, handler);

  // Only push to the OS when something it shows actually changed.
  let lastItemId: string | null | undefined;
  let lastStatus = "";
  const apply = (state: EngineState): void => {
    const cur = state.queue.currentItemId;
    if (cur !== lastItemId) {
      lastItemId = cur;
      const track = cur ? state.queue.itemsById[cur]?.track : undefined;
      session.metadata = track
        ? createMetadata({
            title: track.title,
            ...(track.artist ? { artist: track.artist } : {}),
            ...(track.album ? { album: track.album } : {}),
            ...(track.artwork ? { artwork: [{ src: track.artwork }] } : {}),
          })
        : null;
    }
    const status = state.playback.status;
    if (status !== lastStatus) {
      lastStatus = status;
      session.playbackState = status === "playing" ? "playing" : status === "paused" ? "paused" : "none";
    }
  };

  apply(engine.getState());
  const unsubscribe = engine.subscribe(apply);
  return () => {
    unsubscribe();
    for (const action of Object.keys(handlers)) safeSetHandler(session, action, null);
  };
}

/** `navigator.mediaSession` if the platform has it, else `undefined`. */
function platformSession(): MediaSessionLike | undefined {
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    return navigator.mediaSession as unknown as MediaSessionLike;
  }
  return undefined;
}

/** Some browsers throw for actions they don't support — never let that break the bind. */
function safeSetHandler(session: MediaSessionLike, action: string, handler: ((details: { seekTime?: number }) => void) | null): void {
  try {
    session.setActionHandler(action, handler);
  } catch {
    /* unsupported action — ignore */
  }
}
