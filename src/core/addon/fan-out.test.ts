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
