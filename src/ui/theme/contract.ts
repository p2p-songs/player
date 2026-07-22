/**
 * The theme token contract (ARCHITECTURE §7a).
 *
 * A theme is **data, never code** — a flat record of CSS custom property names
 * to values, applied with `setProperty`. That constraint is not stylistic: the
 * player holds configured addon URLs that carry debrid keys, and `script-src
 * 'self'` exists to stop injected code reading them (§6a). A theme that could
 * ship CSS or JS would walk straight through that, and CSS in particular is not
 * inert — attribute selectors plus `background-image` exfiltrate, and restyling
 * can hide the redaction the credential story depends on.
 *
 * So the vocabulary below is the *whole* of what a theme may change, and it is
 * deliberately wide enough that themes differ by more than colour. Colour alone
 * makes every theme the same app tinted; the things that actually separate a
 * Bauhaus grid from a neon deck are type, geometry, border weight and elevation.
 *
 * **The names here are the literal custom property names**, so this file is one
 * source of truth for three jobs: what a theme may set, what the stylesheet may
 * read, and — once themes are installable — what validation accepts.
 */

/**
 * Every token, grouped by what it controls. Adding one here obliges every
 * bundled theme to define it (the `Record` below is total, so TypeScript says
 * so), which is what keeps a theme from silently inheriting another's value.
 */
export const TOKEN_NAMES = [
  // ---- chrome: the persistent frame (sidebar, player bar) ----
  "--chrome-bg",
  "--chrome-bg-raised",
  "--chrome-text",
  "--chrome-text-muted",
  "--chrome-border",

  // ---- content canvas ----
  "--bg",
  "--surface",
  "--surface-sunken",
  "--text",
  "--text-muted",
  "--border",

  // ---- accent ----
  "--accent",
  "--accent-hover",
  "--accent-soft",
  "--on-accent",
  /** A second accent with its own role. Bauhaus needs red *and* blue; a neon
   *  theme needs magenta *and* cyan. One accent forces themes to look alike. */
  "--accent-2",
  "--on-accent-2",

  // ---- status ----
  "--warn",
  "--danger",
  /** The playback-failure strip. Its own token because a dark theme cannot
   *  tint a light surface to reach a readable warning colour. */
  "--alert-bg",

  // ---- type ----
  /** Headings, brand, section labels — where a theme's voice actually lives. */
  "--font-display",
  "--font-body",
  "--font-mono",
  "--text-xs",
  "--text-sm",
  "--text-md",
  "--text-lg",
  "--text-xl",
  "--text-2xl",
  "--weight-body",
  "--weight-medium",
  "--weight-bold",
  "--weight-display",
  "--tracking-display",
  "--tracking-label",
  /** `uppercase` or `none`. Shouted micro-labels are a whole aesthetic. */
  "--label-case",

  // ---- geometry ----
  "--radius",
  "--radius-lg",
  /** Fully-rounded things (chips, track). A square theme sets this to its radius. */
  "--radius-pill",
  /** Circular things (the play button, slider thumbs). */
  "--radius-round",
  "--border-width",
  "--border-width-thick",

  // ---- elevation ----
  "--shadow",
  "--shadow-lg",
  /** Accent bloom. `none` in a flat theme; the entire look of a neon one. */
  "--glow",

  // ---- focus ----
  "--focus-ring",
  "--focus-offset",

  // ---- motion ----
  "--motion-fast",

  // ---- layout ----
  "--sidebar-w",
  "--player-h",

  /** Placeholder art when a release has no cover — a full `background` value. */
  "--art-fallback",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** A complete set of token values. Total by design — see {@link TOKEN_NAMES}. */
export type ThemeTokens = Record<TokenName, string>;

export interface Theme {
  /** Stable id; persisted as the user's choice. */
  id: string;
  name: string;
  /** One line, shown in the picker. */
  description: string;
  /** Whether the content canvas is dark, for `color-scheme` and form controls. */
  scheme: "light" | "dark";
  tokens: ThemeTokens;
}
