import { describe, it, expect } from "vitest";
import { proceduralBackground } from "./ProceduralArt.js";

describe("procedural cover art", () => {
  it("is stable for an id — art that reshuffles reads as a glitch", () => {
    const id = "mbid:release:00945de3-0f0c-49ad-9709-0212c672042b";
    expect(proceduralBackground(id)).toBe(proceduralBackground(id));
  });

  it("spreads real ids across the compositions rather than clustering", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `mbid:release:0000000${i}-0f0c-49ad-9709-0212c672042b`);
    const distinct = new Set(ids.map(proceduralBackground));
    // 6 patterns x 4 palettes x 3 rotations; clustering would show as a handful.
    expect(distinct.size).toBeGreaterThan(12);
  });

  /**
   * The whole reason this is CSS referencing tokens rather than a canvas: it
   * has to restyle with the theme for free. A literal colour here would be a
   * cover that stays put when everything around it changes.
   */
  it("draws only from theme tokens", () => {
    for (const seed of ["a", "album-2", "mbid:release:x", "♪", ""]) {
      const css = proceduralBackground(seed);
      expect(css).toMatch(/var\(--/);
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
      expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
    }
  });

  it("handles an empty seed rather than throwing", () => {
    expect(proceduralBackground("")).toContain("var(--");
  });
});
