/**
 * The tonearm's angles are solved against the record, not chosen by eye — so the
 * solution is the thing worth holding. A needle hovering over the label, or an
 * arm that "parks" still touching the rim, is the exact failure this catches,
 * and it is invisible to the typechecker and the build.
 */
import { describe, expect, it } from "vitest";
import {
  ANGLE_PARKED,
  ANGLE_PLAYING,
  BOX_WIDTH,
  LABEL_RADIUS,
  RIM_RADIUS,
  counterweightPosition,
  needlePosition,
  needleRadius,
} from "./vinyl-geometry.js";

describe("tonearm geometry", () => {
  it("drops the needle in the grooves, not on the label or past the rim", () => {
    const r = needleRadius(ANGLE_PLAYING);
    expect(r).toBeGreaterThan(LABEL_RADIUS);
    expect(r).toBeLessThan(RIM_RADIUS);
  });

  it("parks clear of the record", () => {
    expect(needleRadius(ANGLE_PARKED)).toBeGreaterThan(RIM_RADIUS);
  });

  it("swings inward — parking is further out than playing", () => {
    expect(needleRadius(ANGLE_PARKED)).toBeGreaterThan(needleRadius(ANGLE_PLAYING));
  });

  it("keeps the whole assembly inside its box", () => {
    // The headshell and counterweight are drawn around these points, so leave
    // room for their own radii rather than testing the centres against the edge.
    const margin = 0.04;
    for (const angle of [ANGLE_PARKED, ANGLE_PLAYING]) {
      const needle = needlePosition(angle);
      const weight = counterweightPosition(angle);
      expect(Math.max(needle.x, weight.x)).toBeLessThan(BOX_WIDTH - margin);
      expect(needle.y).toBeLessThan(1 - margin);
      // The counterweight swings up behind the pivot; it must not clear the top.
      expect(weight.y).toBeGreaterThan(margin);
    }
  });
});
