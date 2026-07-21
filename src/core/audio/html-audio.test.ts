import { describe, it, expect, vi } from "vitest";
import { HtmlAudioBackend } from "./html-audio.js";
import { FakeMediaElement, fakeFactory } from "./fake-media-element.js";
import type { AudioEvent } from "./backend.js";
import type { Ticker } from "./media-element.js";

/** A ticker the test drives by hand — no real timers. */
class FakeTicker implements Ticker {
  private cb: (() => void) | undefined;
  every(_intervalMs: number, cb: () => void): () => void {
    this.cb = cb;
    return () => {
      this.cb = undefined;
    };
  }
  /** Fire `n` ticks. */
  tick(n = 1): void {
    for (let i = 0; i < n; i++) this.cb?.();
  }
}

/** Build a backend over two fake elements and capture its emitted events. */
function setup() {
  const a = new FakeMediaElement();
  const b = new FakeMediaElement();
  const ticker = new FakeTicker();
  const backend = new HtmlAudioBackend(fakeFactory(a, b), ticker);
  const events: AudioEvent[] = [];
  backend.subscribe((e) => events.push(e));
  return { a, b, backend, events, ticker };
}

describe("HtmlAudioBackend — load & playback", () => {
  it("loads the active element and emits 'loaded' with the load token on canplay", () => {
    const { a, backend, events } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    expect(a.src).toBe("https://cdn/x.flac");
    expect(a.loadCount).toBe(1);
    expect(events).toEqual([]); // not ready yet

    a.emitCanPlay();
    expect(events).toEqual([{ type: "loaded", token: "tok1" }]);
  });

  it("play()/pause() drive the active element", () => {
    const { a, backend } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    backend.play();
    expect(a.playCount).toBe(1);
    expect(a.paused).toBe(false);
    backend.pause();
    expect(a.pauseCount).toBe(1);
    expect(a.paused).toBe(true);
  });

  it("emits ended/position with the active element's token", () => {
    const { a, backend, events } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    a.emitTimeUpdate(12.34);
    a.emitEnded();
    expect(events).toContainEqual({ type: "position", token: "tok1", ms: 12340 });
    expect(events).toContainEqual({ type: "ended", token: "tok1" });
  });

  it("maps a media error to an 'error' event with a reason", () => {
    const { a, backend, events } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    a.emitError(3); // decode error
    expect(events).toContainEqual({ type: "error", token: "tok1", reason: "decode error" });
  });

  it("seek sets currentTime in seconds", () => {
    const { a, backend } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    backend.seek(45000);
    expect(a.currentTime).toBe(45);
  });

  it("a rejected play() is swallowed (autoplay policy is not a stream failure)", async () => {
    const a = new FakeMediaElement();
    const b = new FakeMediaElement();
    a.play = () => Promise.reject(new DOMException("blocked", "NotAllowedError"));
    const backend = new HtmlAudioBackend(fakeFactory(a, b));
    const events: AudioEvent[] = [];
    backend.subscribe((e) => events.push(e));
    backend.load("https://cdn/x.flac", "tok1");
    expect(() => backend.play()).not.toThrow();
    await Promise.resolve();
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("stop() pauses, releases the element, and stops emitting for the old token", () => {
    const { a, backend, events } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    backend.stop();
    expect(a.pauseCount).toBe(1);
    expect(a.src).toBe("");
    events.length = 0;
    a.emitEnded(); // token cleared → no event
    a.emitCanPlay();
    expect(events).toEqual([]);
  });
});

describe("HtmlAudioBackend — dual-element preload & swap (gapless core)", () => {
  it("preload buffers the idle element silently without disturbing the active one", () => {
    const { a, b, backend } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    expect(b.src).toBe("https://cdn/next.flac");
    expect(b.volume).toBe(0); // silent until active
    expect(b.loadCount).toBe(1);
    expect(a.src).toBe("https://cdn/cur.flac"); // active untouched
    expect(a.paused).toBe(true);
  });

  it("load() of a preloaded URL swaps to the idle element instead of reloading", () => {
    const { a, b, backend, events } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    b.emitCanPlay(); // the preloaded element is now ready (fires 'loaded' with preload token)
    events.length = 0;

    const bLoadsBefore = b.loadCount;
    backend.load("https://cdn/next.flac", "attempt2");
    // Swapped: no fresh network load on b, and readiness surfaces with the NEW token.
    expect(b.loadCount).toBe(bLoadsBefore);
    expect(events).toEqual([{ type: "loaded", token: "attempt2" }]);

    // b is now the active element — play()/ended come from it.
    backend.play();
    expect(b.playCount).toBe(1);
    expect(a.playCount).toBe(0);
    expect(b.volume).toBe(1); // brought up to full on becoming active
  });

  it("pauses the outgoing element on swap — no simultaneous playback", () => {
    const { a, b, backend } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.play();
    expect(a.paused).toBe(false); // Track 1 playing on element A

    backend.preload("https://cdn/next.flac", "next");
    backend.load("https://cdn/next.flac", "attempt2"); // swap to B (the Next press)
    expect(a.paused).toBe(true); // Track 1 must stop immediately on swap
    backend.play();
    expect(b.paused).toBe(false); // Track 2 now plays…
    expect(a.paused).toBe(true); // …and Track 1 is NOT still playing
  });

  it("after a swap, ended/position come from the newly-active element only", () => {
    const { a, b, backend, events } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    b.emitCanPlay();
    backend.load("https://cdn/next.flac", "attempt2");
    events.length = 0;

    a.emitEnded(); // old element, now idle → suppressed
    a.emitTimeUpdate(9);
    b.emitTimeUpdate(1.5);
    b.emitEnded();
    expect(events).toEqual([
      { type: "position", token: "attempt2", ms: 1500 },
      { type: "ended", token: "attempt2" },
    ]);
  });

  it("a fresh load() (no matching preload) loads on the active element normally", () => {
    const { a, b, backend } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    // Advance to a DIFFERENT url than what was preloaded → no swap.
    backend.load("https://cdn/other.flac", "attempt2");
    expect(a.src).toBe("https://cdn/other.flac");
    expect(a.loadCount).toBe(2); // reloaded on the active element
    expect(b.src).toBe("https://cdn/next.flac"); // idle preload untouched
  });

  it("destroy() detaches listeners so no further events fire", () => {
    const { a, backend, events } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    backend.destroy();
    events.length = 0;
    a.emitCanPlay();
    a.emitEnded();
    expect(events).toEqual([]);
  });

  it("subscribe returns an unsubscribe that detaches the handler", () => {
    const { a, backend } = setup();
    const handler = vi.fn();
    const unsub = backend.subscribe(handler);
    backend.load("https://cdn/x.flac", "tok1");
    unsub();
    a.emitCanPlay();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("HtmlAudioBackend — master volume", () => {
  it("scales the active element and survives a load", () => {
    const { a, backend } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    backend.setVolume(0.5);
    expect(a.volume).toBeCloseTo(0.5);
    backend.load("https://cdn/y.flac", "tok2"); // a fresh load keeps the user's setting
    expect(a.volume).toBeCloseTo(0.5);
    expect(backend.volume).toBe(0.5);
  });

  it("clamps out-of-range values", () => {
    const { a, backend } = setup();
    backend.load("https://cdn/x.flac", "tok1");
    backend.setVolume(5);
    expect(a.volume).toBe(1);
    backend.setVolume(-2);
    expect(a.volume).toBe(0);
  });

  it("composes with a crossfade instead of overwriting it", () => {
    const { a, b, backend, ticker } = setup();
    backend.setVolume(0.5);
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    backend.crossfadeTo("https://cdn/next.flac", "attempt2", 100); // 2 steps

    ticker.tick(); // mid-fade: gains are 0.5/0.5, master 0.5 → 0.25 each
    expect(b.volume).toBeCloseTo(0.25);
    expect(a.volume).toBeCloseTo(0.25);

    ticker.tick(); // fade complete: incoming at full gain × master
    expect(b.volume).toBeCloseTo(0.5);
  });

  it("applies a volume change made during a crossfade", () => {
    const { b, backend, ticker } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    backend.crossfadeTo("https://cdn/next.flac", "attempt2", 100);
    ticker.tick(2); // fade done, incoming gain 1
    backend.setVolume(0.25);
    expect(b.volume).toBeCloseTo(0.25);
  });
});

describe("HtmlAudioBackend — crossfade (volume automation)", () => {
  it("ramps the incoming element up and the outgoing one down over the window", () => {
    const { a, b, backend, ticker } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.play();
    backend.preload("https://cdn/next.flac", "next");

    backend.crossfadeTo("https://cdn/next.flac", "attempt2", 100); // 100ms / 50ms = 2 steps
    expect(b.playCount).toBe(1); // incoming started
    expect(b.volume).toBe(0); // starts silent

    ticker.tick(); // step 1 of 2 → t=0.5
    expect(b.volume).toBeCloseTo(0.5);
    expect(a.volume).toBeCloseTo(0.5);

    ticker.tick(); // step 2 of 2 → t=1, done
    expect(b.volume).toBe(1);
    expect(a.volume).toBe(1); // outgoing reset for reuse
    expect(a.paused).toBe(true); // outgoing paused at the end of the fade
  });

  it("makes the incoming element active — events carry the new token", () => {
    const { a, b, backend, events, ticker } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    backend.crossfadeTo("https://cdn/next.flac", "attempt2", 100);
    ticker.tick(2);
    events.length = 0;

    a.emitTimeUpdate(30); // outgoing, now idle → suppressed
    b.emitTimeUpdate(2);
    b.emitEnded();
    expect(events).toEqual([
      { type: "position", token: "attempt2", ms: 2000 },
      { type: "ended", token: "attempt2" },
    ]);
  });

  it("crossfades to a not-yet-preloaded url by loading it on the idle element first", () => {
    const { a, b, backend } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.crossfadeTo("https://cdn/fresh.flac", "attempt2", 50);
    expect(b.src).toBe("https://cdn/fresh.flac");
    expect(b.loadCount).toBe(1);
    expect(b.playCount).toBe(1);
    expect(a.src).toBe("https://cdn/cur.flac"); // outgoing still the old track (fading out)
  });

  it("a hard load() during a crossfade cancels the ramp", () => {
    const { a, b, backend, ticker } = setup();
    backend.load("https://cdn/cur.flac", "cur");
    backend.preload("https://cdn/next.flac", "next");
    backend.crossfadeTo("https://cdn/next.flac", "attempt2", 200); // 4 steps
    ticker.tick(1); // mid-fade
    backend.load("https://cdn/jump.flac", "attempt3"); // supersedes
    // further ticks must not move volumes (ramp was cancelled)
    const bVol = b.volume;
    const aVol = a.volume;
    ticker.tick(3);
    expect(b.volume).toBe(bVol);
    expect(a.volume).toBe(aVol);
  });
});
