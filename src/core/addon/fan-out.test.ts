import { describe, it, expect } from "vitest";
import { askBounded, neverAbort } from "./fan-out.js";

const abortError = () => new DOMException("aborted", "AbortError");
/** A task that never settles until its signal aborts. */
const hang = (signal: AbortSignal) =>
  new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(abortError());
    else signal.addEventListener("abort", () => reject(abortError()), { once: true });
  });

describe("askBounded", () => {
  it("returns ok with the task's value", async () => {
    const r = await askBounded(async () => 42, neverAbort(), 1000);
    expect(r).toEqual({ kind: "ok", value: 42 });
  });

  it("returns error when the task rejects (not aborted, not timed out)", async () => {
    const boom = new Error("boom");
    const r = await askBounded(async () => {
      throw boom;
    }, neverAbort(), 1000);
    expect(r).toEqual({ kind: "error", error: boom });
  });

  it("returns timeout when the task exceeds the deadline", async () => {
    const r = await askBounded(hang, neverAbort(), 15);
    expect(r).toEqual({ kind: "timeout" });
  });

  it("returns aborted when the outer signal fires (outer wins over timeout)", async () => {
    const outer = new AbortController();
    setTimeout(() => outer.abort(), 5);
    const r = await askBounded(hang, outer.signal, 1000);
    expect(r).toEqual({ kind: "aborted" });
  });

  it("returns aborted immediately if the outer signal is already aborted", async () => {
    const outer = new AbortController();
    outer.abort();
    const r = await askBounded(hang, outer.signal, 1000);
    expect(r).toEqual({ kind: "aborted" });
  });

  it("times out against a task that IGNORES its abort signal (hard deadline, A-009)", async () => {
    // The failure A-009 found: a transport that never observes its signal must
    // not be able to wedge the helper past its deadline.
    const stubborn = () => new Promise<never>(() => {}); // never settles, ignores abort
    const started = Date.now();
    const r = await askBounded(stubborn, neverAbort(), 15);
    expect(r).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("aborts on the outer signal even if the task ignores it", async () => {
    const stubborn = () => new Promise<never>(() => {});
    const outer = new AbortController();
    setTimeout(() => outer.abort(), 5);
    const r = await askBounded(stubborn, outer.signal, 5000);
    expect(r).toEqual({ kind: "aborted" });
  });

  it("swallows a late rejection from an abandoned task (no unhandled rejection)", async () => {
    // Reached via globalThis: the player has no @types/node (it's a browser app).
    const proc = (globalThis as unknown as {
      process?: { on(e: string, l: (r: unknown) => void): void; off(e: string, l: (r: unknown) => void): void };
    }).process;
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => unhandled.push(r);
    proc?.on("unhandledRejection", onUnhandled);
    try {
      // Rejects well after the deadline has already produced `timeout`.
      const lateReject = (signal: AbortSignal) =>
        new Promise<never>((_res, reject) => {
          void signal;
          setTimeout(() => reject(new Error("too late")), 40);
        });
      const r = await askBounded(lateReject, neverAbort(), 10);
      expect(r).toEqual({ kind: "timeout" });
      await new Promise((res) => setTimeout(res, 60)); // let the late rejection land
      expect(unhandled).toEqual([]);
    } finally {
      proc?.off("unhandledRejection", onUnhandled);
    }
  });

  it("ignores a late resolution from an abandoned task", async () => {
    const lateResolve = () => new Promise<string>((res) => setTimeout(() => res("late"), 40));
    const r = await askBounded(lateResolve, neverAbort(), 10);
    expect(r).toEqual({ kind: "timeout" }); // the late value never overwrites the outcome
  });

  it("surfaces a synchronous throw from the task as an error", async () => {
    const boom = new Error("sync boom");
    const r = await askBounded(() => {
      throw boom;
    }, neverAbort(), 1000);
    expect(r).toEqual({ kind: "error", error: boom });
  });

  it("passes a child signal that aborts on timeout so the task can clean up", async () => {
    let sawAbort = false;
    await askBounded(
      (signal) =>
        new Promise<never>((_res, reject) =>
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(abortError());
          }, { once: true }),
        ),
      neverAbort(),
      10,
    );
    expect(sawAbort).toBe(true);
  });
});
