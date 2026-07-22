/** Artwork and time formatting. Layout/state blocks live in `primitives.tsx`. */
import { useState } from "react";
import { PlayIcon } from "lucide-react";
import { ProceduralArt } from "./ProceduralArt.js";
import { cn } from "@/lib/utils";

export function formatTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Cover art. Where an addon supplies none — which is most releases outside the
 * mainstream — a composition generated from `seed` stands in. `seed` should be
 * the release/track id rather than the title, so the same album keeps the same
 * cover even when its title is rendered differently.
 *
 * A supplied URL that *fails* falls back to the same generated art. Addons point
 * at third-party hosts we don't control (Cover Art Archive and friends), and
 * those 404 or rate-limit often enough that the browser's broken-image glyph
 * would otherwise be a normal sight in the library. The failure is remembered
 * *by URL* rather than as a flag, so a component reused for a different item —
 * or the same item after a refetch — retries instead of staying fallen back.
 */
export function Artwork({
  src,
  alt,
  size = 40,
  seed,
  round = false,
}: {
  src?: string | undefined;
  alt: string;
  size?: number;
  seed?: string | undefined;
  /** Circular. Reserved for **artists** — the convention is near-universal, and
   *  it distinguishes an artist row from an album row before any text is read. */
  round?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  if (src && src !== failedSrc) {
    return (
      <img
        className={cn("shrink-0 border-2 border-border object-cover", round && "rounded-full")}
        src={src}
        alt=""
        // Preflight's `height: auto` would otherwise override the attribute and
        // let a non-square remote image distort the row.
        style={{ width: size, height: size }}
        onError={() => setFailedSrc(src)}
        aria-hidden="true"
      />
    );
  }
  return <ProceduralArt seed={seed ?? alt} size={size} round={round} />;
}

/**
 * Artwork for a row whose click **plays** — a play badge covers it while the row
 * is hovered or its button focused.
 *
 * This is the affordance that tells a song row apart from an album or artist row
 * in a mixed list. A trailing `▶` vs `›` doesn't: they're 10px apart in meaning,
 * sit in the corner of the eye, and say nothing until you've learned them. A
 * badge on the thumbnail appears under the pointer at the moment of the click,
 * and it only appears on rows that play.
 *
 * Requires an ancestor with `group` — {@link Row} is one.
 */
export function PlayableArtwork({
  src,
  alt,
  size = 40,
  seed,
}: {
  src?: string | undefined;
  alt: string;
  size?: number;
  seed?: string | undefined;
}) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <Artwork src={src} alt={alt} size={size} seed={seed} />
      <span
        className="absolute inset-0 grid place-items-center bg-foreground/65 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        aria-hidden="true"
      >
        <PlayIcon className="size-4 text-background" fill="currentColor" />
      </span>
    </span>
  );
}

export { StateBlock, Loading, PartialBanner } from "./primitives.js";
