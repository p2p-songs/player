/** Artwork and time formatting. Layout/state blocks live in `primitives.tsx`. */
import { useState } from "react";
import { ProceduralArt } from "./ProceduralArt.js";

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
}: {
  src?: string | undefined;
  alt: string;
  size?: number;
  seed?: string | undefined;
}) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  if (src && src !== failedSrc) {
    return (
      <img
        className="shrink-0 border-2 border-border object-cover"
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
  return <ProceduralArt seed={seed ?? alt} size={size} />;
}

export { StateBlock, Loading, PartialBanner } from "./primitives.js";
