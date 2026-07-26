import { describe, it, expect, vi } from "vitest";
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

  it("preloads the immediate-next item's URL into the idle audio element (§5.2)", async () => {
    const { engine, audio } = makeEngine(3);
    engine.play();
    await flush();
    audio.emitLoaded(); // → playing → prefetch upcoming
    await flush();
    const q2 = res(engine, "q2");
    const q3 = res(engine, "q3");
    expect(q2.status).toBe("resolved");
    const preloaded = audio.preloadHistory.map((p) => p.url);
    if (q2.status === "resolved") expect(preloaded).toContain(q2.url); // immediate next: preloaded
    if (q3.status === "resolved") expect(preloaded).not.toContain(q3.url); // 2nd-out: not (one idle element)
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

describe("resolving (a source being downloaded on debrid)", () => {
  it("holds the track in a downloading state instead of skipping", async () => {
    const { engine, resolver } = makeEngine(1);
    resolver.script(rec("1"), { ok: false, resolving: { progress: 0.4, message: "Downloading on debrid", retryAfter: 5 } });
    engine.play();
    await flush();
    const r = res(engine, "q1");
    expect(r.status).toBe("downloading");
    if (r.status === "downloading") expect(r.progress).toBe(0.4);
    expect(playback(engine).status).not.toBe("error");
  });

  it("re-resolves after the retry delay and plays once the download completes", async () => {
    vi.useFakeTimers();
    try {
      const { engine, resolver, audio } = makeEngine(1);
      let call = 0;
      resolver.script(rec("1"), async () =>
        call++ === 0 ? { ok: false, resolving: { retryAfter: 5 } } : { ok: true, streams: [urlStream("https://ready")] },
      );
      engine.play();
      await vi.advanceTimersByTimeAsync(0); // settle the first resolve
      expect(res(engine, "q1").status).toBe("downloading");
      await vi.advanceTimersByTimeAsync(5_000); // fire the poll → re-resolve → resolved
      expect(res(engine, "q1").status).toBe("resolved");
      audio.emitLoaded();
      expect(playback(engine).status).toBe("playing");
      expect(resolver.calls.filter((c) => c === rec("1")).length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up (fails) if the download never finishes within the poll budget", async () => {
    vi.useFakeTimers();
    try {
      const { engine, resolver } = makeEngine(1, { maxDownloadPolls: 3 });
      resolver.script(rec("1"), { ok: false, resolving: { retryAfter: 3 } }); // never completes
      engine.play();
      await vi.advanceTimersByTimeAsync(0);
      expect(res(engine, "q1").status).toBe("downloading");
      // Each step is one poll → re-resolve; after the (small) budget it must fail.
      for (let i = 0; i < 10 && res(engine, "q1").status !== "failed"; i++) {
        await vi.advanceTimersToNextTimerAsync();
      }
      expect(res(engine, "q1").status).toBe("failed");
      expect(res(engine, "q1")).toMatchObject({ reason: "download timed out" });
    } finally {
      vi.useRealTimers();
    }
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

  it("repeat:all does not let a failing queue bypass the breaker (bound survives the wrap)", async () => {
    const { engine, resolver } = makeEngine(2, { maxConsecutiveFailures: 2 });
    for (const n of ["1", "2"]) resolver.script(rec(n), { ok: false, reason: "down" });
    engine.setRepeat("all");
    engine.play();
    for (let i = 0; i < 12; i++) await flush();
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

  // A-007 HIGH: the queue-resolution cache must be stamp-gated too, not just the FSM.
  it("old success after new success does NOT overwrite the queue's resolution cache", async () => {
    const { engine, resolver } = makeEngine(1);
    const dOld = resolver.manual(rec("1"));
    engine.play(); // attempt 1 for q1 (pending)
    const dNew = resolver.manual(rec("1"));
    engine.selectItem("q1"); // attempt 2 for q1 supersedes attempt 1
    dNew.resolve({ ok: true, streams: [urlStream("https://fresh")] });
    await flush();
    dOld.resolve({ ok: true, streams: [urlStream("https://stale")] }); // late, superseded
    await flush();
    expect(playback(engine)).toMatchObject({ status: "buffering", url: "https://fresh" });
    const r = res(engine, "q1");
    expect(r.status).toBe("resolved");
    expect(r).toMatchObject({ url: "https://fresh" }); // NOT poisoned to https://stale
  });

  it("an old failure after a new success does not clobber the resolved cache", async () => {
    const { engine, resolver } = makeEngine(1);
    const dOld = resolver.manual(rec("1"));
    engine.play();
    const dNew = resolver.manual(rec("1"));
    engine.selectItem("q1");
    dNew.resolve({ ok: true, streams: [urlStream("https://fresh")] });
    await flush();
    dOld.resolve({ ok: false, reason: "old failed" }); // stale failure
    await flush();
    expect(res(engine, "q1")).toMatchObject({ status: "resolved", url: "https://fresh" });
  });

  it("a superseded prefetch result cannot overwrite the current attempt's resolution", async () => {
    const { engine, resolver, audio } = makeEngine(2);
    // q1 default-resolves and plays → triggers prefetch of q2 (make it hang).
    const dPrefetch = resolver.manual(rec("2"));
    engine.play();
    await flush();
    audio.emitLoaded(); // playing q1 → prefetch q2 starts (dPrefetch pending)
    await flush();
    // Now the user jumps to q2 → a current attempt supersedes the prefetch.
    const dCurrent = resolver.manual(rec("2"));
    engine.selectItem("q2");
    dCurrent.resolve({ ok: true, streams: [urlStream("https://current")] });
    await flush();
    dPrefetch.resolve({ ok: true, streams: [urlStream("https://prefetch")] }); // late
    await flush();
    expect(res(engine, "q2")).toMatchObject({ status: "resolved", url: "https://current" });
  });
});

describe("stream freshness (expiry hint)", () => {
  it("re-resolves a cached item whose resolution has expired, instead of reusing a dead URL", async () => {
    const { engine, resolver, audio } = makeEngine(2);
    resolver.script(rec("1"), { ok: true, streams: [urlStream("https://a", { behaviorHints: { expiresAt: "2000-01-01T00:00:00Z" } })] });
    engine.play();
    await flush();
    audio.emitLoaded();
    await flush(); // playing q1; q2 prefetched
    expect(resolver.calls.filter((c) => c === rec("1")).length).toBe(1);
    engine.next(); // → q2
    engine.prev(); // → back to q1, whose cached resolution is expired
    await flush();
    expect(resolver.calls.filter((c) => c === rec("1")).length).toBe(2); // re-resolved, not reused
  });
});

describe("empty-queue append is playable (A-007)", () => {
  it("appending the first item to an empty queue lets play() start it", async () => {
    const resolver = new FakeResolver();
    const audio = new FakeAudio();
    const engine = new Engine(resolver, audio, { idGen: counterIdGen() });
    engine.setQueue([]); // empty
    engine.append([track(1)]);
    expect(engine.getState().queue.currentItemId).toBe("q1");
    engine.play();
    await flush();
    expect(playback(engine)).toMatchObject({ status: "buffering", itemId: "q1" });
  });
});

describe("Engine.getState — snapshot stability", () => {
  it("returns the same reference until something actually changes", async () => {
    const { engine, audio } = makeEngine(2);
    const first = engine.getState();
    expect(engine.getState()).toBe(first); // repeated reads are identical

    engine.play();
    await flush();
    const afterPlay = engine.getState();
    expect(afterPlay).not.toBe(first); // a real change produces a new snapshot
    expect(engine.getState()).toBe(afterPlay); // …and then stabilizes again

    audio.emitLoaded();
    const afterLoaded = engine.getState();
    expect(afterLoaded).not.toBe(afterPlay);
    expect(engine.getState()).toBe(afterLoaded);
  });

  it("restoreQueue rebuilds identity and forces every item back to idle", async () => {
    const { engine, audio } = makeEngine(2);
    engine.play();
    await flush();
    audio.emitLoaded();

    const saved = engine.getState().queue;
    expect(saved.itemsById.q1!.resolution.status).toBe("resolved");

    const restored = new Engine(new FakeResolver(), new FakeAudio(), { idGen: counterIdGen() });
    restored.restoreQueue(saved);
    const q = restored.getState().queue;
    expect(Object.keys(q.itemsById)).toEqual(["q1", "q2"]); // stable ids preserved
    expect(q.currentItemId).toBe(saved.currentItemId);
    expect(q.itemsById.q1!.resolution).toEqual({ status: "idle" }); // never replays a stale URL
    expect(q.itemsById.q2!.resolution).toEqual({ status: "idle" });
  });
});
