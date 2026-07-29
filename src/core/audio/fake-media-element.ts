/**
 * A controllable `MediaElementLike` for headless backend tests. It records what
 * the backend did to it (play/pause/load counts, src, volume, currentTime) and
 * lets a test drive the media events (`emitCanPlay`/`emitEnded`/`emitError`/
 * `emitTimeUpdate`) synchronously — the audio analogue of `FakeResolver`, so the
 * dual-element/swap/token logic is deterministic without a real browser.
 */
import type { MediaElementLike } from "./media-element.js";

export class FakeMediaElement implements MediaElementLike {
  src = "";
  currentTime = 0;
  duration = NaN; // real elements report NaN until metadata loads
  volume = 1;
  preload = "";
  readyState = 0;
  error: { readonly code: number } | null = null;

  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  paused = true;

  private readonly listeners = new Map<string, Set<() => void>>();

  play(): Promise<void> {
    this.playCount++;
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCount++;
    this.paused = true;
  }
  load(): void {
    this.loadCount++;
    this.currentTime = 0;
    this.readyState = 0;
    this.error = null;
    this.paused = true; // (re)loading a source stops any current playback
  }
  addEventListener(type: string, listener: () => void): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  // --- test controls ---
  private fire(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l();
  }
  /** Buffered enough to start → `canplay`. */
  emitCanPlay(): void {
    this.readyState = 4;
    this.fire("canplay");
  }
  emitEnded(): void {
    this.fire("ended");
  }
  emitError(code = 4): void {
    this.error = { code };
    this.fire("error");
  }
  emitTimeUpdate(seconds: number, duration?: number): void {
    this.currentTime = seconds;
    if (duration !== undefined) this.duration = duration;
    this.fire("timeupdate");
  }
}

/** Build a factory that hands out the given elements in order (A then B). */
export function fakeFactory(...els: FakeMediaElement[]): () => FakeMediaElement {
  let i = 0;
  return () => {
    const el = els[i++];
    if (!el) throw new Error("fakeFactory: requested more elements than provided");
    return el;
  };
}
