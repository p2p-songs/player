/**
 * `HtmlAudioBackend` — the real audio subsystem (ARCHITECTURE §4c), implemented
 * behind the same `AudioBackend` interface the engine already drives against a
 * fake. **Two media elements (A/B) are ping-ponged:** the idle one preloads the
 * next track's URL so the browser buffers its opening while the current track
 * plays, and advancing **swaps** to it rather than reloading — the dual-element
 * mechanism behind gapless/crossfade (§4c). Volume automation (the crossfade
 * ramp) and MediaSession are layered on in the next chunk; this chunk is the
 * correct load/preload/swap/event core.
 *
 * **Identity by token.** Every `load`/`preload` tags its element with the
 * engine's token; every event this backend emits echoes that element's current
 * token, so a late `loaded`/`ended`/`error` for a superseded attempt is
 * recognizable and dropped by identity downstream (§4b) rather than misapplied
 * to whatever is current now. `ended`/`position` are emitted only from the
 * **active** element (the idle one isn't playing); `loaded`/`error` may come
 * from either and are identity-filtered by the engine.
 *
 * Crossfade uses `element.volume`, never a Web Audio graph, on purpose: routing
 * a cross-origin media element through `MediaElementAudioSourceNode` taints it
 * unless the source sends CORS headers, which debrid/CDN links frequently don't
 * (§4c). Volume automation works regardless of CORS.
 */
import type { AudioBackend, AudioEvent } from "./backend.js";
import {
  defaultMediaElementFactory,
  defaultTicker,
  mediaErrorReason,
  type MediaElementFactory,
  type MediaElementLike,
  type Ticker,
} from "./media-element.js";

/** readyState ≥ this means the element has buffered enough to start (canplay). */
const HAVE_FUTURE_DATA = 3;
/** Volume-ramp granularity for crossfades. */
const FADE_STEP_MS = 50;

interface Slot {
  el: MediaElementLike;
  /** The engine token for the media currently in this element (undefined = released). */
  token: string | undefined;
  /** The URL currently loaded/preloaded in this element. */
  url: string | undefined;
  /**
   * This element's crossfade gain (0–1). The element's actual `volume` is always
   * `master × gain`, so the user's volume setting and the fade ramp compose
   * instead of overwriting each other.
   */
  gain: number;
  cleanup: () => void;
}

export class HtmlAudioBackend implements AudioBackend {
  private readonly slots: [Slot, Slot];
  private active: Slot;
  private idle: Slot;
  private handler: ((event: AudioEvent) => void) | undefined;
  private readonly ticker: Ticker;
  private cancelFade: (() => void) | undefined;
  /** User-facing volume (0–1), applied on top of each slot's fade gain. */
  private master = 1;

  constructor(factory: MediaElementFactory = defaultMediaElementFactory, ticker: Ticker = defaultTicker) {
    const a = this.makeSlot(factory());
    const b = this.makeSlot(factory());
    this.slots = [a, b];
    this.active = a;
    this.idle = b;
    this.ticker = ticker;
  }

  /** Set the user-facing volume (0–1). Composes with any in-flight crossfade. */
  setVolume(volume: number): void {
    this.master = clamp01(volume);
    for (const slot of this.slots) this.applyGain(slot, slot.gain);
  }

  get volume(): number {
    return this.master;
  }

  /** Record a slot's fade gain and push `master × gain` to the element. */
  private applyGain(slot: Slot, gain: number): void {
    slot.gain = clamp01(gain);
    slot.el.volume = clamp01(this.master * slot.gain);
  }

  load(url: string, token: string): void {
    this.endFade(); // a hard load supersedes any in-flight crossfade
    const outgoing = this.active;
    if (this.idle.url === url && this.idle.el.src) {
      // The next track was preloaded on the idle element — swap to it instead of
      // reloading, so its already-buffered audio starts gaplessly. The outgoing
      // element must be paused: unlike the reload branch (where setting `.src`
      // stops the old media), a swap leaves the old element running, which would
      // play both tracks at once.
      [this.active, this.idle] = [this.idle, this.active];
      outgoing.el.pause();
    } else {
      this.active.el.src = url;
      this.active.url = url;
      this.active.el.preload = "auto";
      this.active.el.load();
    }
    this.active.token = token;
    this.applyGain(this.active, 1);
    // A swapped-in preloaded element may already be past `canplay`; its listener
    // won't re-fire, so surface readiness now (with the *current* attempt token).
    if (this.active.el.readyState >= HAVE_FUTURE_DATA) this.emit({ type: "loaded", token });
  }

  play(): void {
    // A rejected play() is autoplay/gesture policy (NotAllowedError) or a
    // load/play race (AbortError) — NOT a stream failure. Genuine media failures
    // arrive via the "error" event, so swallow the promise rejection here.
    void this.active.el.play().catch(() => {});
  }

  pause(): void {
    this.active.el.pause();
  }

  seek(ms: number): void {
    this.active.el.currentTime = ms / 1000;
  }

  preload(url: string, token: string): void {
    if (this.idle.url === url && this.idle.el.src) return; // already buffering this url
    this.idle.el.src = url;
    this.idle.url = url;
    this.idle.token = token;
    this.idle.el.preload = "auto";
    this.applyGain(this.idle, 0); // silent until it becomes active (or is crossfaded up)
    this.idle.el.load();
  }

  /**
   * Overlap the current element with `url` on the idle element and ramp volumes
   * over `durationMs` (§4c). The incoming element becomes active immediately, so
   * it drives `position`/`ended` while the outgoing one fades out underneath it.
   * Uses `element.volume` — never Web Audio — to stay CORS-agnostic.
   */
  crossfadeTo(url: string, token: string, durationMs: number): void {
    this.endFade();
    if (this.idle.url !== url || !this.idle.el.src) {
      this.idle.el.src = url;
      this.idle.url = url;
      this.idle.el.preload = "auto";
      this.idle.el.load();
    }
    const incoming = this.idle;
    const outgoing = this.active;
    incoming.token = token;
    this.applyGain(incoming, 0);
    void incoming.el.play().catch(() => {});
    // Commit the swap up front: the incoming element is now the one we track.
    this.active = incoming;
    this.idle = outgoing;

    const steps = Math.max(1, Math.round(durationMs / FADE_STEP_MS));
    let i = 0;
    this.cancelFade = this.ticker.every(FADE_STEP_MS, () => {
      i += 1;
      const t = Math.min(1, i / steps);
      this.applyGain(incoming, t);
      this.applyGain(outgoing, 1 - t);
      if (i >= steps) this.endFade();
    });
  }

  stop(): void {
    this.endFade();
    this.active.el.pause();
    this.active.el.src = "";
    this.active.el.load(); // abort the in-flight network request
    this.active.token = undefined;
    this.active.url = undefined;
  }

  /**
   * Stop any in-flight volume ramp and silence the outgoing (idle) element — so
   * a superseding `load`/`stop`/crossfade doesn't leave the old track audibly
   * playing underneath, and a completed fade leaves the outgoing element paused
   * and reset for reuse.
   */
  private endFade(): void {
    if (!this.cancelFade) return;
    this.cancelFade();
    this.cancelFade = undefined;
    this.idle.el.pause();
    this.applyGain(this.idle, 1);
  }

  subscribe(handler: (event: AudioEvent) => void): () => void {
    this.handler = handler;
    return () => {
      if (this.handler === handler) this.handler = undefined;
    };
  }

  /** Detach all element listeners. Not part of the interface — backend teardown. */
  destroy(): void {
    for (const slot of this.slots) slot.cleanup();
    this.handler = undefined;
  }

  private makeSlot(el: MediaElementLike): Slot {
    const slot: Slot = { el, token: undefined, url: undefined, gain: 1, cleanup: () => {} };
    const onCanPlay = () => {
      if (slot.token) this.emit({ type: "loaded", token: slot.token });
    };
    const onEnded = () => {
      if (slot.token && slot === this.active) this.emit({ type: "ended", token: slot.token });
    };
    const onError = () => {
      if (slot.token) this.emit({ type: "error", token: slot.token, reason: mediaErrorReason(el.error?.code) });
    };
    const onTimeUpdate = () => {
      if (slot.token && slot === this.active) {
        this.emit({ type: "position", token: slot.token, ms: Math.round(el.currentTime * 1000) });
      }
    };
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("timeupdate", onTimeUpdate);
    slot.cleanup = () => {
      el.removeEventListener("canplay", onCanPlay);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("timeupdate", onTimeUpdate);
    };
    return slot;
  }

  private emit(event: AudioEvent): void {
    this.handler?.(event);
  }
}

/** Clamp to the 0–1 range a media element's `volume` accepts. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}
