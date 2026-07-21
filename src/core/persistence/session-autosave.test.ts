import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionAutosave, AUTOSAVE_DEBOUNCE_MS } from "./session-autosave.js";
import type { Queue } from "../queue/types.js";

/** Minimal distinct queue snapshots — only identity matters to the autosaver. */
function queueOf(label: string): Queue {
  return {
    itemsById: {},
    canonicalOrder: [],
    playOrder: [],
    currentItemId: null,
    shuffle: false,
    repeat: "off",
    _label: label,
  } as unknown as Queue;
}

describe("SessionAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid edits into one write of the newest snapshot", async () => {
    const save = vi.fn(async () => {});
    const autosave = new SessionAutosave({ save });

    autosave.schedule(queueOf("a"));
    vi.advanceTimersByTime(300);
    autosave.schedule(queueOf("b"));
    vi.advanceTimersByTime(300);
    const last = queueOf("c");
    autosave.schedule(last);

    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(last);
  });

  it("does not reschedule for repeated notifications of the same snapshot", async () => {
    // The engine notifies ~4x/s on position ticks with the *same* queue object.
    // Rescheduling on those resets the debounce faster than it can fire, which
    // starved the autosave for the entire duration of playback.
    const save = vi.fn(async () => {});
    const autosave = new SessionAutosave({ save });
    const queue = queueOf("playing");

    autosave.schedule(queue);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    for (let tick = 0; tick < 40; tick++) {
      autosave.schedule(queue); // same reference: the position ticks
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(save).toHaveBeenCalledTimes(1); // no rewrites, and no starvation either
  });

  it("flush writes the pending snapshot before the debounce elapses", async () => {
    const save = vi.fn(async () => {});
    const autosave = new SessionAutosave({ save });
    const queue = queueOf("edited");

    autosave.schedule(queue);
    vi.advanceTimersByTime(100); // user closes the tab 100ms after editing
    autosave.flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledWith(queue);
  });

  it("dispose flushes instead of dropping the newest edit", async () => {
    const save = vi.fn(async () => {});
    const autosave = new SessionAutosave({ save });
    const queue = queueOf("edited");

    autosave.schedule(queue);
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledWith(queue);

    autosave.schedule(queueOf("after-dispose"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps a rejected snapshot pending and retries on the next flush", async () => {
    const errors: unknown[] = [];
    const save = vi
      .fn<(queue: Queue) => Promise<void>>()
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValue(undefined);
    const autosave = new SessionAutosave({ save, onError: (e) => errors.push(e) });
    const queue = queueOf("at-risk");

    autosave.schedule(queue);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(errors).toHaveLength(1);

    autosave.flush(); // the snapshot is still pending, so this retries it
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(queue);
  });

  it("does not spin retrying a snapshot that keeps failing", async () => {
    const save = vi.fn(async () => {
      throw new Error("store closed");
    });
    const autosave = new SessionAutosave({ save, onError: () => {} });

    autosave.schedule(queueOf("doomed"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("writes a snapshot that arrives while an earlier write is in flight", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));
    const save = vi.fn<(queue: Queue) => Promise<void>>().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const autosave = new SessionAutosave({ save });

    autosave.schedule(queueOf("first"));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);

    const newer = queueOf("newer");
    autosave.schedule(newer);
    autosave.flush(); // ignored while the first write is in flight...
    expect(save).toHaveBeenCalledTimes(1);

    release(); // ...and picked up when it settles
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(newer);
  });

  it("markDurable suppresses writing a just-hydrated snapshot back", async () => {
    const save = vi.fn(async () => {});
    const autosave = new SessionAutosave({ save });
    const restored = queueOf("restored");

    autosave.markDurable(restored);
    autosave.schedule(restored);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(save).not.toHaveBeenCalled();
  });
});
