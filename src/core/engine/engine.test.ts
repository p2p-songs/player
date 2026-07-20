import { describe, it, expect } from "vitest";
import type { RecordingId } from "@p2p-songs/protocol";
import type { TrackRef } from "../queue/types.js";
import { counterIdGen } from "../queue/types.js";
import { Engine, type EngineOptions } from "./engine.js";
import { FakeAudio } from "../audio/fake.js";
import { FakeResolver, urlStream } from "../scheduler/fake-resolver.js";

const rec = (n: string): RecordingId => `mbid:recording:${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}` as RecordingId;
const track = (n: number): TrackRef => ({ recordingId: rec(String(n)), title: `Track ${n}`, durationMs: 200000 });
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i + 1));

/** Flush microtasks + timer callbacks so async resolutions settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeEngine(count: number, options: EngineOptions = {}) {
  const resolver = new FakeResolver();
  const audio = new FakeAudio();
  const engine = new Engine(resolver, audio, { idGen: counterIdGen(), ...options });
  engine.setQueue(tracks(count));
  return { engine, resolver, audio };
}
const playback = (e: Engine) => e.getState().playback;
const res = (e: Engine, id: string) => e.getState().queue.itemsById[id]!.resolution;

describe("happy path + prefetch", () => {
  it("play resolves → buffers → plays, then prefetches upcoming items", async () => {
    const { engine, audio } = makeEngine(3);
    engine.play();
    await flush();
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q1" });
    audio.emitLoaded();
    expect(playback(engine).status).toBe("playing");
    expect(audio.playing).toBe(true);
    await flush();
    // next 2 items prefetched (prefetchCount default 2)
    expect(res(engine, "q2").status).toBe("resolved");
    expect(res(engine, "q3").status).toBe("resolved");
  });

  it("on ended it auto-advances to the prefetched next item", async () => {
    const { engine, audio } = makeEngine(3);
    engine.play();
    await flush();
    audio.emitLoaded();
    await flush();
    audio.emitEnded();
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q2" });
    audio.emitLoaded();
    expect(playback(engine)).toMatchObject({ status: "playing", itemId: "q2" });
  });

  it("pause/resume and seek update state", async () => {
    const { engine, audio } = makeEngine(1);
    engine.play();
    await flush();
    audio.emitLoaded();
    audio.emitPosition(4000);
    expect(playback(engine)).toMatchObject({ status: "playing", positionMs: 4000 });
    engine.pause();
    expect(playback(engine)).toMatchObject({ status: "paused", positionMs: 4000 });
    expect(audio.playing).toBe(false);
    engine.play();
    expect(playback(engine).status).toBe("playing");
  });
});

describe("fallback within an item, then re-resolve", () => {
  it("walks the ranked stream list on a load failure", async () => {
    const { engine, resolver, audio } = makeEngine(1);
    resolver.script(rec("1"), { ok: true, streams: [urlStream("https://a"), urlStream("https://b")] });
    engine.play();
    await flush();
    expect(audio.current?.url).toBe("https://a");
    audio.emitError("dead link"); // → walk to next stream
    expect(audio.current?.url).toBe("https://b");
    audio.emitLoaded();
    expect(playback(engine).status).toBe("playing");
  });

  it("re-resolves the item once when the stream list is exhausted", async () => {
    const { engine, resolver, audio } = makeEngine(1);
    resolver.script(rec("1"), { ok: true, streams: [urlStream("https://only")] });
    engine.play();
    await flush();
    expect(resolver.calls.filter((c) => c === rec("1")).length).toBe(1);
    audio.emitError("dead"); // no next stream → re-resolve
    await flush();
    expect(resolver.calls.filter((c) => c === rec("1")).length).toBe(2); // re-resolved
    expect(playback(engine).status).toBe("buffering");
  });
});

describe("failure circuit-breaker (bounded skip-ahead)", () => {
  it("trips to a terminal error when every item keeps failing", async () => {
    const { engine, resolver } = makeEngine(3, { maxConsecutiveFailures: 2 });
    for (const n of ["1", "2", "3"]) resolver.script(rec(n), { ok: false, reason: "provider down" });
    engine.play();
    for (let i = 0; i < 12; i++) await flush(); // let the resolve→fail→skip loop run to its bound
    expect(playback(engine).status).toBe("error");
  });

  it("a successful play resets the breaker", async () => {
    const { engine, resolver, audio } = makeEngine(3, { maxConsecutiveFailures: 2 });
    resolver.script(rec("1"), { ok: false, reason: "down" }); // q1 fails
    engine.play();
    await flush();
    await flush();
    // q1 failed + re-resolved + skipped to q2 (default resolver → ok). q2 buffers:
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q2" });
    audio.emitLoaded(); // successful play → breaker reset
    expect(playback(engine).status).toBe("playing");
  });
});

describe("stale-completion safety (engine-level async-race matrix)", () => {
  it("resolve-after-skip: a late resolution for a skipped item is dropped", async () => {
    const { engine, resolver, audio } = makeEngine(2);
    const d1 = resolver.manual(rec("1"));
    resolver.script(rec("2"), { ok: true, streams: [urlStream("https://b")] });
    engine.play(); // start q1 (resolving, pending)
    engine.next(); // skip to q2 before q1 resolves
    await flush(); // q2 resolves → buffering q2
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q2" });
    d1.resolve({ ok: true, streams: [urlStream("https://a")] }); // q1 lands late
    await flush();
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q2" }); // still q2
    audio.emitLoaded();
    expect(audio.current?.url).toBe("https://b");
  });

  it("reorder-during-resolve: reordering other items doesn't misapply the resolution (ids are stable)", async () => {
    const { engine, resolver } = makeEngine(3);
    const d1 = resolver.manual(rec("1"));
    engine.play(); // resolving q1
    engine.move("q3", 0); // reorder while q1 resolves
    d1.resolve({ ok: true, streams: [urlStream("https://a")] });
    await flush();
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q1" }); // applied to q1 correctly
  });

  it("failure-after-success: a stale (wrong-token) load error can't knock down the live track", async () => {
    const { engine, audio } = makeEngine(1);
    engine.play();
    await flush();
    audio.emitLoaded();
    expect(playback(engine).status).toBe("playing");
    audio.emitError("stale", "bogus-token"); // unknown token → ignored
    expect(playback(engine).status).toBe("playing");
  });
});
