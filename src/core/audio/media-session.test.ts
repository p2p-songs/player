import { describe, it, expect } from "vitest";
import { bindMediaSession, type MediaSessionLike, type MediaSessionEngine } from "./media-session.js";
import type { EngineState } from "../engine/engine.js";
import type { TrackRef } from "../queue/types.js";

class FakeSession implements MediaSessionLike {
  metadata: unknown = null;
  playbackState: "none" | "paused" | "playing" = "none";
  handlers = new Map<string, ((details: { seekTime?: number }) => void) | null>();
  setActionHandler(action: string, handler: ((details: { seekTime?: number }) => void) | null): void {
    this.handlers.set(action, handler);
  }
}

/** A minimal engine stub that lets a test push states and records commands. */
class EngineStub implements MediaSessionEngine {
  calls: string[] = [];
  private listeners = new Set<(s: EngineState) => void>();
  constructor(private state: EngineState) {}
  getState(): EngineState {
    return this.state;
  }
  subscribe(listener: (s: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(state: EngineState): void {
    this.state = state;
    for (const l of this.listeners) l(state);
  }
  play() { this.calls.push("play"); }
  pause() { this.calls.push("pause"); }
  next() { this.calls.push("next"); }
  prev() { this.calls.push("prev"); }
  seek(ms: number) { this.calls.push(`seek:${ms}`); }
  stop() { this.calls.push("stop"); }
}

const track = (over: Partial<TrackRef> = {}): TrackRef => ({
  recordingId: "mbid:recording:11111111-1111-1111-1111-111111111111" as TrackRef["recordingId"],
  title: "Song One",
  artist: "The Artist",
  album: "The Album",
  ...over,
});

function stateWith(itemId: string | null, status: string, tr: TrackRef = track()): EngineState {
  return {
    queue: {
      itemsById: itemId ? { [itemId]: { id: itemId, track: tr, resolution: { status: "idle" } } } : {},
      canonicalOrder: itemId ? [itemId] : [],
      playOrder: itemId ? [itemId] : [],
      currentItemId: itemId,
      repeat: "off",
      shuffle: false,
    },
    playback: { status } as EngineState["playback"],
  };
}

function setup(initial: EngineState) {
  const engine = new EngineStub(initial);
  const session = new FakeSession();
  const unbind = bindMediaSession(engine, { session, createMetadata: (init) => init });
  return { engine, session, unbind };
}

describe("bindMediaSession", () => {
  it("mirrors the current track's metadata to the session", () => {
    const { session } = setup(stateWith("q1", "playing"));
    expect(session.metadata).toMatchObject({
      title: "Song One",
      artist: "The Artist",
      album: "The Album",
    });
    expect(session.playbackState).toBe("playing");
  });

  it("updates metadata on item change and playbackState on status change", () => {
    const { engine, session } = setup(stateWith("q1", "playing"));
    engine.emit(stateWith("q2", "playing", track({ title: "Song Two" })));
    expect(session.metadata).toMatchObject({ title: "Song Two" });

    engine.emit(stateWith("q2", "paused", track({ title: "Song Two" })));
    expect(session.playbackState).toBe("paused");
  });

  it("maps non-playing/paused statuses to 'none'", () => {
    const { engine, session } = setup(stateWith("q1", "playing"));
    engine.emit(stateWith(null, "idle"));
    expect(session.playbackState).toBe("none");
    expect(session.metadata).toBeNull();
  });

  it("routes action handlers to engine commands", () => {
    const { engine, session } = setup(stateWith("q1", "playing"));
    session.handlers.get("play")!({});
    session.handlers.get("pause")!({});
    session.handlers.get("nexttrack")!({});
    session.handlers.get("previoustrack")!({});
    session.handlers.get("stop")!({});
    session.handlers.get("seekto")!({ seekTime: 42 }); // seconds → ms
    expect(engine.calls).toEqual(["play", "pause", "next", "prev", "stop", "seek:42000"]);
  });

  it("unbind removes the action handlers and stops mirroring", () => {
    const { engine, session, unbind } = setup(stateWith("q1", "playing"));
    unbind();
    expect(session.handlers.get("play")).toBeNull();
    engine.emit(stateWith("q2", "paused", track({ title: "Song Two" })));
    expect(session.playbackState).toBe("playing"); // no longer updated
  });

  it("is a no-op when no MediaSession is available", () => {
    const engine = new EngineStub(stateWith("q1", "playing"));
    // no session injected and no navigator.mediaSession in node → returns a no-op unbind
    const unbind = bindMediaSession(engine);
    expect(() => unbind()).not.toThrow();
  });
});
