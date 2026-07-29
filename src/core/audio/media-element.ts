/**
 * The narrow slice of `HTMLAudioElement` the real audio backend actually uses
 * (ARCHITECTURE §4c). Depending on this interface — not `HTMLAudioElement`
 * directly — keeps `HtmlAudioBackend`'s logic (dual-element swap, event→token
 * mapping, volume automation) **unit-testable in node** against a controllable
 * fake, the same injection discipline used everywhere else in `src/core`
 * (fake resolver, fake HTTP, injected clocks). Actual audible playback is the
 * one thing this can't prove; that's the manual browser smoke.
 */
export interface MediaElementLike {
  src: string;
  currentTime: number;
  /** HTMLMediaElement.duration — seconds, `NaN` until metadata loads, `Infinity` for a live stream. */
  readonly duration: number;
  /** 0..1; the crossfade path automates this instead of routing through Web Audio (§4c). */
  volume: number;
  preload: string;
  /** HTMLMediaElement.readyState — ≥3 (HAVE_FUTURE_DATA) means "can play". */
  readonly readyState: number;
  /** Set after a fatal media error; `code` is the MediaError code. */
  readonly error: { readonly code: number } | null;
  play(): Promise<void>;
  pause(): void;
  /** (Re)start loading `src`. */
  load(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type MediaElementFactory = () => MediaElementLike;

/**
 * The real factory: a detached `HTMLAudioElement`. Two of these (A/B) are
 * ping-ponged by the backend. Only constructed in a browser; headless tests
 * inject a fake factory instead.
 */
export const defaultMediaElementFactory: MediaElementFactory = () =>
  // `new Audio()` genuinely satisfies MediaElementLike at runtime; the cast only
  // bridges the DOM lib's wider addEventListener overloads.
  new Audio() as unknown as MediaElementLike;

/**
 * A repeating timer, injected so the crossfade volume ramp is testable without
 * real time (the test drives ticks synchronously). Default = `setInterval`.
 */
export interface Ticker {
  /** Invoke `cb` every `intervalMs`; returns a stop function. */
  every(intervalMs: number, cb: () => void): () => void;
}

export const defaultTicker: Ticker = {
  every(intervalMs, cb) {
    const id = setInterval(cb, intervalMs);
    return () => clearInterval(id);
  },
};

/** A human-readable reason for a MediaError code (HTMLMediaElement.error.code). */
export function mediaErrorReason(code: number | undefined): string {
  switch (code) {
    case 1:
      return "aborted";
    case 2:
      return "network error";
    case 3:
      return "decode error";
    case 4:
      return "source not supported";
    default:
      return "media error";
  }
}
