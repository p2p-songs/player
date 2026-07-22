/**
 * Where the tonearm sits over the record.
 *
 * Plain maths, kept out of {@link Vinyl} so the constraint that actually matters
 * can be tested: **the needle must land in the grooves when playing and clear of
 * the record when parked.** Every value is a fraction of the record's diameter,
 * so the arm scales with `size` instead of drifting off it.
 *
 * The arm hangs from a pivot outside the disc and rotates clockwise about it, so
 * for a rotation θ the needle is at
 *
 *     (PIVOT_X − ARM_LENGTH·sin θ,  PIVOT_Y + ARM_LENGTH·cos θ)
 *
 * with the record centred on (0.5, 0.5). The two angles below are solutions to
 * that, not guesses — change `ARM_LENGTH` or the pivot and they have to be
 * re-solved, or the needle ends up hovering over the label or off the rim.
 */

export const ARM_LENGTH = 0.7;
/** How far the arm extends *behind* the pivot, carrying the counterweight. */
export const ARM_BACK = 0.13;
export const PIVOT_X = 1.1;
export const PIVOT_Y = 0.18;
/** Room for the arm to park to the right of the record. */
export const BOX_WIDTH = 1.26;

export const ANGLE_PLAYING = 26;
export const ANGLE_PARKED = -6;

/** The label, from `inset: 32%` — nothing should track inside this. */
export const LABEL_RADIUS = 0.18;
export const RIM_RADIUS = 0.5;

/** The needle's position, as fractions of the record's diameter. */
export function needlePosition(angleDeg: number): { x: number; y: number } {
  const t = (angleDeg * Math.PI) / 180;
  return {
    x: PIVOT_X - ARM_LENGTH * Math.sin(t),
    y: PIVOT_Y + ARM_LENGTH * Math.cos(t),
  };
}

/** How far the needle is from the spindle, in the same fractions. */
export function needleRadius(angleDeg: number): number {
  const { x, y } = needlePosition(angleDeg);
  return Math.hypot(x - 0.5, y - 0.5);
}

/** The counterweight's centre, which swings up behind the pivot. */
export function counterweightPosition(angleDeg: number): { x: number; y: number } {
  const t = (angleDeg * Math.PI) / 180;
  return {
    x: PIVOT_X + ARM_BACK * Math.sin(t),
    y: PIVOT_Y - ARM_BACK * Math.cos(t),
  };
}
