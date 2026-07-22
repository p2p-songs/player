/** Artwork and time formatting. Layout/state blocks live in `primitives.tsx`. */
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
  if (src) {
    return (
      <img
        className="shrink-0 border-2 border-border object-cover"
        src={src}
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
      />
    );
  }
  return <ProceduralArt seed={seed ?? alt} size={size} />;
}

export { StateBlock, Loading, PartialBanner } from "./primitives.js";
