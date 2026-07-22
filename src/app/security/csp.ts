/**
 * The v1 browser threat model's Content-Security-Policy (ARCHITECTURE §6a).
 *
 * The named threat is **injected same-origin script exfiltrating a configured
 * addon's debrid key**. The load-bearing defense is therefore `script-src`: no
 * `'unsafe-inline'`, no `'unsafe-eval'`, only first-party bundles — which blocks
 * the classic XSS payload from ever executing. `object-src`/`base-uri`/
 * `frame-ancestors`/`form-action` close the usual bypasses, and
 * `require-trusted-types-for 'script'` denies the DOM-XSS sinks (the app has
 * none, and React's normal rendering uses none, so enforcement is free here).
 *
 * What CSP deliberately **cannot** lock down here: `connect-src`/`img-src`/
 * `media-src` must permit arbitrary `https:` origins, because addons are
 * user-installed URLs and their artwork and debrid CDNs live on hosts we can't
 * enumerate in advance. So CSP is not the exfiltration boundary for a *trusted*
 * addon — it's the boundary against *injected* code, which is the actual §6a
 * threat. This is called out honestly rather than overclaimed.
 *
 * Two profiles: `dev` must additionally allow Vite's HMR (inline bootstrap,
 * eval'd modules, a websocket), so the strict profile is applied to the
 * production build only.
 */
export type CspProfile = "dev" | "prod";

/**
 * Loopback origins, allowed in **both** profiles.
 *
 * The player never runs an addon — an addon is only ever a manifest URL the user
 * pasted. But that URL may point at a server *the user* runs on their own
 * machine (`serveHTTP` on `http://127.0.0.1:7003`), which is the intended shape
 * for a credential-bearing addon like Bitbop: your debrid key stays on your
 * hardware. `endpoints.ts` permits plain `http` for exactly these hosts and no
 * others, and this is the matching CSP allowance. A hosted player build with a
 * self-hosted addon is a supported pairing, so this is not dev-only (§6a, §10).
 */
const LOOPBACK_ADDON = ["http://localhost:*", "http://127.0.0.1:*"];

/**
 * Google Fonts, for the bundled themes' display faces (§7a).
 *
 * A deliberate, scoped exception to "no remote CSS": two pinned origins serving
 * only `@font-face` declarations and font binaries. It is **not** a loosening of
 * the theme rule — a theme still may not express a selector, and this stylesheet
 * is authored by neither us nor a theme. The real cost is privacy: Google sees
 * the IP of anyone using a theme with a webfont. The default theme uses a system
 * stack precisely so that cost is opt-in, and self-hosting the woff2 files
 * removes it entirely if that trade stops being acceptable.
 */
const FONT_CSS = ["https://fonts.googleapis.com"];
const FONT_FILES = ["https://fonts.gstatic.com"];

/** Vite's HMR socket — dev only, and never a `media-src`/addon origin. */
const HMR_SOCKET = ["ws://localhost:*", "ws://127.0.0.1:*"];

export function buildCsp(profile: CspProfile): string {
  const prod = profile === "prod";

  const scriptSrc = prod
    ? ["'self'"]
    : // Vite dev injects an inline bootstrap and evaluates transformed modules.
      ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  const connectSrc = prod
    ? ["'self'", "https:", ...LOOPBACK_ADDON]
    : ["'self'", "https:", ...LOOPBACK_ADDON, ...HMR_SOCKET];

  const directives: Record<string, string[] | true> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // React sets inline styles via the CSSOM (exempt), but allow inline styles
    // so a stylesheet-injecting dep can't hard-break the UI. Styles can't run script.
    "style-src": ["'self'", "'unsafe-inline'", ...FONT_CSS],
    "font-src": ["'self'", "data:", ...FONT_FILES],
    "img-src": ["'self'", "https:", "data:", "blob:"],
    // Audio comes from debrid/CDN https origins, or from a loopback addon.
    "media-src": ["'self'", "https:", ...LOOPBACK_ADDON],
    "connect-src": connectSrc,
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'none'"],
  };

  // Trusted Types: enforce only in prod (HMR uses sinks). Establishes the
  // DOM-XSS denial the §6a threat model calls for.
  if (prod) {
    directives["require-trusted-types-for"] = ["'script'"];
  }

  return Object.entries(directives)
    .map(([name, value]) => (value === true ? name : `${name} ${(value as string[]).join(" ")}`))
    .join("; ");
}

/** The `<meta http-equiv>` tag string injected into `index.html`. */
export function cspMetaTag(profile: CspProfile): string {
  return `<meta http-equiv="Content-Security-Policy" content="${buildCsp(profile)}" />`;
}
