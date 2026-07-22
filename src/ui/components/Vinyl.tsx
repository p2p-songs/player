/**
 * The record and tonearm on the now-playing view.
 *
 * Built the same way as {@link ProceduralArt} and for the same reason: pure CSS
 * over tokens, deterministic from the release id. Grooves are a
 * `repeating-radial-gradient` rather than an image, so it stays sharp at any
 * size and costs nothing to ship.
 *
 * When the addon supplied real artwork it goes on the label, which is the one
 * place a square image can sit on a disc without being cropped into nonsense.
 *
 * It turns only while audio is playing, and `prefers-reduced-motion` stops both
 * the spin and the arm's swing (handled globally in `globals.css`) — a
 * permanently moving element is a genuine problem for vestibular sensitivity,
 * and a spinning record also reads as "playing" when nothing is.
 *
 * Pausing **suspends** the spin rather than removing it. Dropping the class
 * resets `transform` to none, so the record snapped back upright on every pause
 * and jumped again on resume; `animation-play-state` holds the angle instead,
 * which is also what a real deck does.
 *
 * ## The tonearm
 *
 * The angles and dimensions live in `vinyl-geometry.ts` — plain maths, kept out
 * of here so the constraint that actually matters can be tested: the needle
 * lands in the grooves when playing and clear of the record when parked. This
 * file only turns those fractions into pixels.
 */
import { proceduralBackground } from "./ProceduralArt.js";
import {
  ANGLE_PARKED,
  ANGLE_PLAYING,
  ARM_BACK,
  ARM_LENGTH,
  BOX_WIDTH,
  PIVOT_X,
  PIVOT_Y,
} from "./vinyl-geometry.js";

export function Vinyl({
  seed,
  artwork,
  spinning,
  size = 420,
}: {
  seed: string;
  artwork?: string | undefined;
  spinning: boolean;
  size?: number;
}) {
  const px = (fraction: number) => fraction * size;
  const shaftWidth = Math.max(3, px(0.016));
  const pivotSize = px(0.085);
  const weightSize = px(0.075);
  const headSize = px(0.055);

  return (
    <div className="relative shrink-0" style={{ width: px(BOX_WIDTH), height: size }} aria-hidden="true">
      <div
        className="absolute top-0 left-0 rounded-full animate-disc"
        style={{
          animationPlayState: spinning ? "running" : "paused",
          width: size,
          height: size,
          background:
            // Grooves, then the disc body. Two stops of near-black keeps the
            // ridges legible without turning it into a target.
            "repeating-radial-gradient(circle at 50% 50%, #1c1610 0 3px, #241c14 3px 6px)",
          boxShadow: "inset 0 0 0 2px var(--accent)",
        }}
      >
        <div
          className="absolute overflow-hidden rounded-full border-2 border-border"
          style={{
            inset: "32%",
            background: artwork ? undefined : proceduralBackground(seed),
          }}
        >
          {artwork ? <img src={artwork} alt="" className="size-full object-cover" /> : null}
        </div>
        {/* Spindle hole. Small, but its absence is what makes these read as CDs. */}
        <div className="absolute rounded-full border-2 border-border bg-chrome" style={{ inset: "47%" }} />
      </div>

      {/*
        The arm. One rotation about the pivot carries the whole assembly —
        counterweight, shaft, headshell — which is why they're nested here rather
        than positioned separately: a real arm is one rigid body, and three
        elements animated in parallel drift apart at the edges of the easing.
      */}
      <div
        className="absolute"
        style={{
          left: px(PIVOT_X) - shaftWidth / 2,
          top: px(PIVOT_Y - ARM_BACK),
          width: shaftWidth,
          height: px(ARM_BACK + ARM_LENGTH),
          transformOrigin: `50% ${px(ARM_BACK)}px`,
          transform: `rotate(${spinning ? ANGLE_PLAYING : ANGLE_PARKED}deg)`,
          // Slow and eased: a stylus is lowered, not thrown. Long enough to read
          // as a deliberate mechanism, short enough not to lag a play tap.
          transition: "transform 1100ms cubic-bezier(0.4, 0, 0.2, 1)",
          background: "var(--chrome-muted)",
        }}
      >
        <div
          className="absolute rounded-full border-2 border-border"
          style={{
            left: shaftWidth / 2 - weightSize / 2,
            top: -weightSize / 2,
            width: weightSize,
            height: weightSize,
            background: "var(--chrome-muted)",
          }}
        />
        {/* Headshell — the stylus end, in accent so the eye can find where it sits. */}
        <div
          className="absolute border-2 border-border"
          style={{
            left: shaftWidth / 2 - headSize / 2,
            bottom: -headSize * 0.35,
            width: headSize,
            height: headSize * 1.2,
            background: "var(--accent)",
          }}
        />
      </div>

      {/* Bearing, drawn over the shaft so the arm reads as anchored to it. */}
      <div
        className="absolute rounded-full border-2 border-border"
        style={{
          left: px(PIVOT_X) - pivotSize / 2,
          top: px(PIVOT_Y) - pivotSize / 2,
          width: pivotSize,
          height: pivotSize,
          background: "var(--chrome-track)",
        }}
      />
    </div>
  );
}
