/**
 * Generated cover art for releases whose addon supplies no image.
 *
 * Most releases outside the mainstream have no artwork, and a grid of identical
 * grey initials is the single biggest reason a library looks unfinished. The
 * mockups all solve it the same way — geometric compositions in the theme's own
 * palette — and it is the one piece of "character" that is genuinely a component
 * rather than a token.
 *
 * Two properties make it work:
 *
 * - **Deterministic.** The pattern and palette come from a hash of the release
 *   id, so a given album always looks the same. Art that reshuffles on every
 *   render reads as a glitch, not as a design.
 * - **Pure CSS, referencing tokens.** Compositions are `background` values built
 *   from `var(--…)`, so they restyle with the theme for free. Reading computed
 *   colours in JS would have meant recomputing on every theme change and would
 *   not survive a token that is a gradient rather than a colour.
 */

/** Token triples, chosen so no composition can land ink-on-ink. */
const PALETTES = [
  ["var(--primary)", "var(--foreground)", "var(--accent)"],
  ["var(--accent)", "var(--primary)", "var(--card)"],
  ["var(--foreground)", "var(--accent)", "var(--primary)"],
  ["var(--primary)", "var(--muted)", "var(--foreground)"],
] as const;

/** Each entry composes one cover from a palette `[a, b, c]`. */
const PATTERNS: ((a: string, b: string, c: string) => string)[] = [
  // quartered
  (a, b, c) =>
    `linear-gradient(to right, ${b} 0 50%, ${a} 50% 100%) 0 0 / 100% 50% no-repeat, ` +
    `linear-gradient(to right, ${c} 0 50%, var(--card) 50% 100%) 0 100% / 100% 50% no-repeat`,
  // diagonal stripes
  (a, b) => `repeating-linear-gradient(45deg, ${a} 0 10%, ${b} 10% 20%)`,
  // off-centre disc
  (a, b, c) => `radial-gradient(circle at 62% 58%, ${c} 0 26%, ${a} 26% 46%, ${b} 46% 100%)`,
  // split field
  (a, b) => `linear-gradient(105deg, ${b} 0 46%, ${a} 46% 100%)`,
  // concentric rings
  (a, b, c) =>
    `repeating-radial-gradient(circle at 50% 50%, ${a} 0 8%, ${b} 8% 16%), linear-gradient(${c}, ${c})`,
  // horizon bands
  (a, b, c) => `linear-gradient(${b} 0 34%, ${a} 34% 62%, ${c} 62% 100%)`,
];

/** FNV-1a. Small, stable across runs, and good enough to scatter ids. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function proceduralBackground(seed: string): string {
  const h = hash(seed);
  const palette = PALETTES[h % PALETTES.length]!;
  const pattern = PATTERNS[(h >>> 8) % PATTERNS.length]!;
  // Rotate the triple so the same pattern reads differently across releases.
  const shift = (h >>> 16) % 3;
  const [a, b, c] = [palette[shift % 3]!, palette[(shift + 1) % 3]!, palette[(shift + 2) % 3]!];
  return pattern(a, b, c);
}

export function ProceduralArt({ seed, size, round = false }: { seed: string; size: number; round?: boolean }) {
  return (
    <div
      className={round ? "shrink-0 rounded-full border-2 border-border" : "shrink-0 border-2 border-border"}
      style={{ width: size, height: size, background: proceduralBackground(seed) }}
      aria-hidden="true"
    />
  );
}
