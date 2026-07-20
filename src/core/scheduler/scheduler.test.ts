import { describe, it, expect } from "vitest";
import type { RecordingId } from "@p2p-songs/protocol";
import type { QueueItem } from "../queue/types.js";
import type { Stamp } from "../playback/machine.js";
import { Scheduler } from "./scheduler.js";
import { FakeResolver, urlStream } from "./fake-resolver.js";

const rec = (n: string): RecordingId => `mbid:recording:${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}` as RecordingId;
const item = (id: string, n: string): QueueItem => ({ id, track: { recordingId: rec(n), title: `t${n}` }, resolution: { status: "idle" } });
const stamp = (epoch: number, itemId: string, attemptId: number): Stamp => ({ epoch, itemId, attemptId });

describe("Scheduler command-plane semantics (§5a)", () => {
  it("dedups concurrent resolves for the same stamp into one resolver call", async () => {
    const resolver = new FakeResolver();
    const d = resolver.manual(rec("1"));
    const sched = new Scheduler(resolver);
    const it1 = item("q1", "1");
    const p1 = sched.resolve(it1, stamp(1, "q1", 1));
    const p2 = sched.resolve(it1, stamp(1, "q1", 1));
    expect(p1).toBe(p2); // same in-flight promise
    d.resolve({ ok: true, streams: [urlStream("https://cdn/1.flac")] });
    await p1;
    expect(resolver.calls).toEqual([rec("1")]); // resolver hit exactly once
  });

  it("tags the outcome with the stamp it was called under", async () => {
    const resolver = new FakeResolver().script(rec("1"), { ok: true, streams: [urlStream("https://cdn/1.flac")] });
    const sched = new Scheduler(resolver);
    const out = await sched.resolve(item("q1", "1"), stamp(2, "q1", 3));
    expect(out.stamp).toEqual(stamp(2, "q1", 3));
    expect(out.ok).toBe(true);
  });

  it("a resolver throw becomes ok:false, not a rejection", async () => {
    const resolver = new FakeResolver().script(rec("1"), async () => {
      throw new Error("indexer down");
    });
    const out = await new Scheduler(resolver).resolve(item("q1", "1"), stamp(1, "q1", 1));
    expect(out).toMatchObject({ ok: false, reason: "indexer down" });
  });

  it("supersedes a stale attempt for the same item (aborts the old resolution)", async () => {
    const resolver = new FakeResolver();
    resolver.manual(rec("1")); // attempt 1 hangs
    const sched = new Scheduler(resolver);
    const it1 = item("q1", "1");
    void sched.resolve(it1, stamp(1, "q1", 1));
    expect(sched.inflightCount).toBe(1);
    // A new attempt for the same item supersedes attempt 1.
    resolver.script(rec("1"), { ok: true, streams: [urlStream("https://cdn/1.flac")] });
    await sched.resolve(it1, stamp(1, "q1", 2));
    expect(resolver.aborts).toBe(1); // attempt 1 was aborted
  });

  it("cancelExcept aborts resolutions for items no longer near the cursor", async () => {
    const resolver = new FakeResolver();
    resolver.manual(rec("1"));
    resolver.manual(rec("2"));
    const sched = new Scheduler(resolver);
    void sched.resolve(item("q1", "1"), stamp(1, "q1", 1));
    void sched.resolve(item("q2", "2"), stamp(1, "q2", 1));
    expect(sched.inflightCount).toBe(2);
    sched.cancelExcept(new Set(["q2"])); // keep only q2
    expect(sched.inflightCount).toBe(1);
    expect(resolver.aborts).toBe(1);
  });

  it("a late completion still resolves (its stamp lets the reducer drop it later)", async () => {
    const resolver = new FakeResolver();
    const d = resolver.manual(rec("1"));
    const sched = new Scheduler(resolver);
    const p = sched.resolve(item("q1", "1"), stamp(1, "q1", 1));
    sched.cancelExcept(new Set()); // user skipped away; cancel it
    d.resolve({ ok: true, streams: [urlStream("https://cdn/1.flac")] }); // but it completes anyway
    const out = await p;
    expect(out.stamp).toEqual(stamp(1, "q1", 1)); // carries its stamp — engine drops it by identity
  });
});
