/**
 * A controllable fake audio backend for headless tests. It records what the
 * engine asked it to do (load/preload/play/pause) and lets a test drive the
 * outcomes synchronously (`emitLoaded`, `emitError`, `emitEnded`,
 * `emitPosition`) — including with an explicit stale token, to exercise
 * late/superseded completions.
 */
import type { AudioBackend, AudioEvent } from "./backend.js";

export class FakeAudio implements AudioBackend {
  private handler: ((event: AudioEvent) => void) | undefined;
  current: { url: string; token: string } | undefined;
  playing = false;
  readonly loadHistory: { url: string; token: string }[] = [];
  readonly preloadHistory: { url: string; token: string }[] = [];

  subscribe(handler: (event: AudioEvent) => void): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  load(url: string, token: string): void {
    this.current = { url, token };
    this.loadHistory.push({ url, token });
    this.playing = false;
  }
  preload(url: string, token: string): void {
    this.preloadHistory.push({ url, token });
  }
  play(): void {
    this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }
  seek(_ms: number): void {}
  stop(): void {
    this.current = undefined;
    this.playing = false;
  }

  // --- test controls (default to the current load's token) ---
  emitLoaded(token: string | undefined = this.current?.token): void {
    if (token) this.handler?.({ type: "loaded", token });
  }
  emitError(reason?: string, token: string | undefined = this.current?.token): void {
    if (token) this.handler?.({ type: "error", token, reason });
  }
  emitEnded(token: string | undefined = this.current?.token): void {
    if (token) this.handler?.({ type: "ended", token });
  }
  emitPosition(ms: number, token: string | undefined = this.current?.token): void {
    if (token) this.handler?.({ type: "position", token, ms });
  }
}
