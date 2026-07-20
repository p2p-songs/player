import { describe, it, expect } from "vitest";
import { transition, initialState, type PlaybackState, type Stamp } from "./machine.js";

const stamp = (epoch: number, itemId: string, attemptId: number): Stamp => ({ epoch, itemId, attemptId });

/** Drive a happy path to `playing` for item A. */
function toPlaying(): PlaybackState {
  let s = initialState(1);
  s = transition(s, { type: "SELECT", epoch: 1, itemId: "A", attemptId: 1 });
  s = transition(s, { type: "RESOLVED", stamp: stamp(1, "A", 1), url: "https://x/a.flac" });
  s = transition(s, { type: "LOADED", stamp: stamp(1, "A", 1) });
  return s;
}

describe("happy path", () => {
  it("idle → resolving → buffering → playing → ended", () => {
    let s = initialState(1);
    s = transition(s, { type: "SELECT", epoch: 1, itemId: "A", attemptId: 1 });
    expect(s.status).toBe("resolving");
    s = transition(s, { type: "RESOLVED", stamp: stamp(1, "A", 1), url: "https://x/a.flac" });
    expect(s.status).toBe("buffering");
    s = transition(s, { type: "LOADED", stamp: stamp(1, "A", 1) });
    expect(s).toMatchObject({ status: "playing", itemId: "A", url: "https://x/a.flac", positionMs: 0 });
    s = transition(s, { type: "POSITION", ms: 1234 });
    expect(s).toMatchObject({ status: "playing", positionMs: 1234 });
    s = transition(s, { type: "ENDED" });
    expect(s).toMatchObject({ status: "ended", itemId: "A" });
  });

  it("play/pause toggles and preserves position", () => {
    let s = toPlaying();
    s = transition(s, { type: "POSITION", ms: 5000 });
    s = transition(s, { type: "PAUSE" });
    expect(s).toMatchObject({ status: "paused", positionMs: 5000 });
    s = transition(s, { type: "PLAY" });
    expect(s).toMatchObject({ status: "playing", positionMs: 5000 });
  });
});

describe("stale-completion safety (the §4b matrix)", () => {
  it("resolve-after-skip: a resolve for a superseded item is dropped", () => {
    let s = initialState(1);
    s = transition(s, { type: "SELECT", epoch: 1, itemId: "A", attemptId: 1 }); // resolving A
    s = transition(s, { type: "SELECT", epoch: 2, itemId: "B", attemptId: 1 }); // skipped to B
    const before = s;
    s = transition(s, { type: "RESOLVED", stamp: stamp(1, "A", 1), url: "https://x/a.flac" }); // late A resolve
    expect(s).toBe(before); // ignored — still resolving B
    expect(s).toMatchObject({ status: "resolving", itemId: "B", epoch: 2 });
  });

  it("wrong-epoch and wrong-attempt resolves are dropped", () => {
    let s = transition(initialState(3), { type: "SELECT", epoch: 3, itemId: "A", attemptId: 2 });
    expect(transition(s, { type: "RESOLVED", stamp: stamp(2, "A", 2), url: "u" })).toBe(s); // wrong epoch
    expect(transition(s, { type: "RESOLVED", stamp: stamp(3, "A", 1), url: "u" })).toBe(s); // wrong attempt
    expect(transition(s, { type: "RESOLVED", stamp: stamp(3, "B", 2), url: "u" })).toBe(s); // wrong item
  });

  it("failure-after-success: a stale LOAD_FAILED can't knock down the live playing item", () => {
    let s = toPlaying(); // playing A, attempt 1
    const stale = transition(s, { type: "LOAD_FAILED", stamp: stamp(1, "A", 0), reason: "old" });
    expect(stale).toBe(s); // stale attempt ignored
    const live = transition(s, { type: "LOAD_FAILED", stamp: stamp(1, "A", 1), reason: "dead url" });
    expect(live).toMatchObject({ status: "failed", itemId: "A", reason: "dead url" });
  });

  it("double-completion: a second RESOLVED after buffering is a no-op", () => {
    let s = initialState(1);
    s = transition(s, { type: "SELECT", epoch: 1, itemId: "A", attemptId: 1 });
    s = transition(s, { type: "RESOLVED", stamp: stamp(1, "A", 1), url: "https://x/a.flac" }); // buffering
    const after = transition(s, { type: "RESOLVED", stamp: stamp(1, "A", 1), url: "https://x/other.flac" });
    expect(after).toBe(s); // ignored — no longer resolving
    expect(after).toMatchObject({ status: "buffering", url: "https://x/a.flac" });
  });
});

describe("failure and terminal states", () => {
  it("RESOLVE_FAILED (valid) → failed; engine then decides fallback/skip", () => {
    let s = transition(initialState(1), { type: "SELECT", epoch: 1, itemId: "A", attemptId: 1 });
    s = transition(s, { type: "RESOLVE_FAILED", stamp: stamp(1, "A", 1), reason: "no streams" });
    expect(s).toMatchObject({ status: "failed", itemId: "A", reason: "no streams" });
  });

  it("TERMINATE → error (circuit breaker); RESET → idle at a new epoch", () => {
    let s = toPlaying();
    s = transition(s, { type: "TERMINATE", reason: "all sources failed" });
    expect(s).toMatchObject({ status: "error", reason: "all sources failed" });
    s = transition(s, { type: "RESET", epoch: 9 });
    expect(s).toEqual({ status: "idle", epoch: 9 });
  });

  it("events that don't apply are ignored (totality)", () => {
    const idle = initialState(0);
    expect(transition(idle, { type: "PAUSE" })).toBe(idle);
    expect(transition(idle, { type: "ENDED" })).toBe(idle);
    expect(transition(idle, { type: "POSITION", ms: 10 })).toBe(idle);
    expect(transition(idle, { type: "LOADED", stamp: stamp(0, "A", 1) })).toBe(idle);
  });
});
