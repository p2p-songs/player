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

/** Loopback origins where a locally-run addon (`serveHTTP`) is reached over http (§6a, §10). */
const LOOPBACK = "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*";

export function buildCsp(profile: CspProfile): string {
  const prod = profile === "prod";

  const scriptSrc = prod
    ? ["'self'"]
    : // Vite dev injects an inline bootstrap and evaluates transformed modules.
      ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  const connectSrc = prod
    ? ["'self'", "https:", "http://localhost:*", "http://127.0.0.1:*"]
    : ["'self'", "https:", LOOPBACK];

  const directives: Record<string, string[] | true> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    // React sets inline styles via the CSSOM (exempt), but allow inline styles
    // so a stylesheet-injecting dep can't hard-break the UI. Styles can't run script.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "https:", "data:", "blob:"],
    // Audio comes from debrid/CDN https origins and, in dev, loopback addons.
    "media-src": prod ? ["'self'", "https:", "http://localhost:*", "http://127.0.0.1:*"] : ["'self'", "https:", LOOPBACK],
    "connect-src": connectSrc,
    "font-src": ["'self'", "data:"],
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
