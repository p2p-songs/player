import { describe, it, expect } from "vitest";
import { ProviderHealth } from "./provider-health.js";

describe("ProviderHealth", () => {
  it("is healthy by default", () => {
    const h = new ProviderHealth({ now: () => 0 });
    expect(h.isBackedOff("a")).toBe(false);
  });

  it("backs off exponentially: 1s, 2s, 4s (capped)", () => {
    let t = 0;
    const h = new ProviderHealth({ baseMs: 1000, maxMs: 4000, now: () => t });
    h.recordFailure("a");
    expect(h.backoffRemainingMs("a")).toBe(1000);
    t = 1000;
    expect(h.isBackedOff("a")).toBe(false); // window elapsed

    h.recordFailure("a");
    expect(h.backoffRemainingMs("a")).toBe(2000); // 2^1 * 1000
    t = 3000;
    h.recordFailure("a");
    expect(h.backoffRemainingMs("a")).toBe(4000); // 2^2 * 1000, capped at 4000
    h.recordFailure("a");
    expect(h.backoffRemainingMs("a")).toBe(4000); // still capped
  });

  it("a reachable response clears backoff", () => {
    let t = 0;
    const h = new ProviderHealth({ baseMs: 1000, now: () => t });
    h.recordFailure("a");
    expect(h.isBackedOff("a")).toBe(true);
    h.recordReachable("a");
    expect(h.isBackedOff("a")).toBe(false);
    expect(h.backoffRemainingMs("a")).toBe(0);
  });

  it("tracks providers independently", () => {
    const h = new ProviderHealth({ baseMs: 1000, now: () => 0 });
    h.recordFailure("a");
    expect(h.isBackedOff("a")).toBe(true);
    expect(h.isBackedOff("b")).toBe(false);
  });
});
