import { describe, it, expect } from "vitest";
import type { RecordingId } from "@p2p-songs/protocol";
import type { TrackRef, Rng } from "./types.js";
import { counterIdGen } from "./types.js";
import {
  createQueue,
  nextId,
  prevId,
  upNext,
  setShuffle,
  setRepeat,
  append,
  insertAfter,
  removeItem,
  moveItem,
  setResolution,
  currentItem,
} from "./queue.js";

const rec = (n: number): RecordingId =>
  `mbid:recording:${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}` as RecordingId;

const track = (n: number, over: Partial<TrackRef> = {}): TrackRef => ({
  recordingId: rec(n),
  title: `Track ${n}`,
  ...over,
});

const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i + 1));

/** A deterministic rng that reverses (each pick takes the current last element). */
const reverseRng: Rng = () => 0;

describe("createQueue", () => {
  it("assigns stable ids, sets current to the start, both orders equal when unshuffled", () => {
    const q = createQueue(tracks(3), counterIdGen());
    expect(q.canonicalOrder).toEqual(["q1", "q2", "q3"]);
    expect(q.playOrder).toEqual(["q1", "q2", "q3"]);
    expect(q.currentItemId).toBe("q1");
    expect(currentItem(q)!.track.title).toBe("Track 1");
  });

  it("allows the same track twice with distinct ids", () => {
    const t = track(1);
    const q = createQueue([t, t], counterIdGen());
    expect(q.canonicalOrder).toEqual(["q1", "q2"]);
    expect(q.itemsById["q1"]!.track.recordingId).toBe(q.itemsById["q2"]!.track.recordingId);
  });
});

describe("next/prev with repeat", () => {
  it("repeat off: advances then stops at the end", () => {
    let q = createQueue(tracks(3), counterIdGen());
    expect(nextId(q)).toBe("q2");
    q = { ...q, currentItemId: "q3" };
    expect(nextId(q)).toBeNull();
    expect(nextId(q, { auto: true })).toBeNull();
  });

  it("repeat one: replays the same on auto-advance, but a manual skip still moves on", () => {
    let q = setRepeat(createQueue(tracks(3), counterIdGen()), "one");
    q = { ...q, currentItemId: "q2" };
    expect(nextId(q, { auto: true })).toBe("q2"); // natural end → replay
    expect(nextId(q, { auto: false })).toBe("q3"); // manual skip → next
  });

  it("repeat all: wraps around in both directions", () => {
    let q = setRepeat(createQueue(tracks(3), counterIdGen()), "all");
    q = { ...q, currentItemId: "q3" };
    expect(nextId(q)).toBe("q1");
    q = { ...q, currentItemId: "q1" };
    expect(prevId(q)).toBe("q3");
  });
});

describe("shuffle (non-destructive) and up-next correctness", () => {
  it("keeps current first, leaves canonicalOrder + itemsById untouched, restores on toggle off", () => {
    const q0 = createQueue(tracks(5), counterIdGen(), { startIndex: 2 }); // current = q3
    const q1 = setShuffle(q0, true, reverseRng);
    expect(q1.playOrder[0]).toBe("q3"); // current stays first
    expect(new Set(q1.playOrder)).toEqual(new Set(q0.canonicalOrder)); // same members
    expect(q1.canonicalOrder).toEqual(q0.canonicalOrder); // canonical untouched
    expect(q1.itemsById).toBe(q0.itemsById); // items untouched (same ref)
    const q2 = setShuffle(q1, false);
    expect(q2.playOrder).toEqual(q0.canonicalOrder); // restored
  });

  it("up-next reads from playOrder, not canonicalOrder (the shuffle-bug fix)", () => {
    // Force a known non-identity play order.
    const q0 = createQueue(tracks(4), counterIdGen());
    const q = { ...q0, shuffle: true, currentItemId: "q2", playOrder: ["q2", "q4", "q1", "q3"] };
    expect(upNext(q)).toEqual(["q4", "q1", "q3"]); // follows play order after current
  });
});

describe("insert / remove / move keep every structure consistent", () => {
  it("insertAfter places the item after the anchor in both orders", () => {
    const gen = counterIdGen();
    let q = createQueue(tracks(3), gen); // q1 q2 q3
    q = insertAfter(q, "q1", [track(9)], gen); // → q4 after q1
    expect(q.canonicalOrder).toEqual(["q1", "q4", "q2", "q3"]);
    expect(q.playOrder).toEqual(["q1", "q4", "q2", "q3"]);
    expect(q.itemsById["q4"]!.track.title).toBe("Track 9");
  });

  it("removing the current item advances current along playOrder and purges it everywhere", () => {
    const gen = counterIdGen();
    let q = createQueue(tracks(3), gen);
    q = { ...q, currentItemId: "q2" };
    q = removeItem(q, "q2");
    expect(q.currentItemId).toBe("q3"); // advanced
    expect(q.canonicalOrder).toEqual(["q1", "q3"]);
    expect(q.playOrder).toEqual(["q1", "q3"]);
    expect(q.itemsById["q2"]).toBeUndefined();
  });

  it("removing the last current item falls back to the previous", () => {
    const gen = counterIdGen();
    let q = createQueue(tracks(3), gen);
    q = { ...q, currentItemId: "q3" };
    q = removeItem(q, "q3");
    expect(q.currentItemId).toBe("q2");
  });

  it("moveItem reorders canonical; playOrder follows only when not shuffled", () => {
    const gen = counterIdGen();
    let q = createQueue(tracks(4), gen); // q1 q2 q3 q4
    q = moveItem(q, "q4", 0);
    expect(q.canonicalOrder).toEqual(["q4", "q1", "q2", "q3"]);
    expect(q.playOrder).toEqual(["q4", "q1", "q2", "q3"]);

    const shuffledQ = { ...createQueue(tracks(4), counterIdGen()), shuffle: true, playOrder: ["q2", "q4", "q1", "q3"] };
    const moved = moveItem(shuffledQ, "q1", 0);
    expect(moved.canonicalOrder).toEqual(["q1", "q2", "q3", "q4"]);
    expect(moved.playOrder).toEqual(["q2", "q4", "q1", "q3"]); // shuffle order preserved
  });

  it("append adds to the tail of both orders", () => {
    const gen = counterIdGen();
    let q = createQueue(tracks(2), gen);
    q = append(q, [track(7)], gen);
    expect(q.canonicalOrder).toEqual(["q1", "q2", "q3"]);
    expect(q.playOrder).toEqual(["q1", "q2", "q3"]);
  });
});

describe("setResolution", () => {
  it("updates one item immutably without touching others", () => {
    const q0 = createQueue(tracks(2), counterIdGen());
    const q1 = setResolution(q0, "q1", { status: "resolving" });
    expect(q1.itemsById["q1"]!.resolution).toEqual({ status: "resolving" });
    expect(q1.itemsById["q2"]).toBe(q0.itemsById["q2"]); // untouched
    expect(q0.itemsById["q1"]!.resolution).toEqual({ status: "idle" }); // original unmutated
  });
});
