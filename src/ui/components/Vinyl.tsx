/**
 * The record on the now-playing view.
 *
 * Built the same way as {@link ProceduralArt} and for the same reason: pure CSS
 * over tokens, deterministic from the release id. Grooves are a
 * `repeating-radial-gradient` rather than an image, so it stays sharp at any
 * size and costs nothing to ship.
 *
 * When the addon supplied real artwork it goes on the label, which is the one
 * place a square image can sit on a disc without being cropped into nonsense.
 *
 * It turns only while audio is playing, and `prefers-reduced-motion` stops it
 * (handled globally in `globals.css`) — a permanently spinning element is a
 * genuine problem for vestibular sensitivity, and it also reads as "playing"
 * when nothing is.
 *
 * Pausing **suspends** the animation rather than removing it. Dropping the class
 * resets `transform` to none, so the record snapped back upright on every pause
 * and jumped again on resume; `animation-play-state` holds the angle instead,
 * which is also what a real deck does.
 */
import { proceduralBackground } from "./ProceduralArt.js";

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
  return (
    <div
      className="relative shrink-0 rounded-full animate-disc"
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
      aria-hidden="true"
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
      <div
        className="absolute rounded-full border-2 border-border bg-chrome"
        style={{ inset: "47%" }}
      />
    </div>
  );
}
