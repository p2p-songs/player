/**
 * Addon resource URL construction — the *build* side of the wire path grammar
 * the SDK router (`addon-sdk`) *parses* (PROTOCOL.md §5). The two are inverses;
 * the live-addon e2e test (§10) drives real requests through the real router,
 * which is what guards this against drift.
 *
 * An installed addon is identified by its **manifest URL**:
 *
 *   https://addon.example/manifest.json                     (unconfigured)
 *   https://addon.example/<base64url-config>/manifest.json  (configured — §6a)
 *
 * The config segment (when present) is part of the addon's base and prefixes
 * every resource route, exactly as the router expects. It is base64url
 * (`A-Za-z0-9_-`), already path-safe, so it is carried verbatim. The whole
 * manifest URL is credential-bearing for a configured addon and must never be
 * logged (§6a).
 */

const MANIFEST_SUFFIX = "/manifest.json";

/** A resolved addon base: everything up to but not including `/manifest.json`. */
export type AddonBase = string & { readonly __brand: "AddonBase" };

/**
 * Derive an addon's base (scheme + host + optional config segment) from its
 * installed manifest URL. Throws for anything that isn't a `…/manifest.json`, or
 * for a non-`https` URL — **except** `http://` to a loopback host, which is
 * allowed for local addon development. `https` is the secret-transport
 * requirement for any real (remote) addon whose configured URL may carry a
 * debrid credential (§6a); a loopback addon never leaves the machine, so plain
 * `http` there is safe and is how a locally-run addon (`serveHTTP`) is installed.
 */
export function addonBaseFromManifestUrl(manifestUrl: string): AddonBase {
  let parsed: URL;
  try {
    parsed = new URL(manifestUrl);
  } catch {
    throw new Error("addon manifest URL is not a valid URL");
  }
  const httpsOk = parsed.protocol === "https:";
  const loopbackHttpOk = parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
  if (!httpsOk && !loopbackHttpOk) {
    throw new Error("addon manifest URL must be https:// (http:// allowed only for loopback)");
  }
  if (!manifestUrl.endsWith(MANIFEST_SUFFIX)) {
    throw new Error("addon install URL must end with /manifest.json");
  }
  return manifestUrl.slice(0, -MANIFEST_SUFFIX.length) as AddonBase;
}

/** localhost / 127.0.0.0-8 / ::1 — an addon reachable only from this machine. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, ""); // URL keeps IPv6 in brackets
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** The manifest URL for a base. */
export function manifestUrl(base: AddonBase): string {
  return `${base}${MANIFEST_SUFFIX}`;
}

/**
 * The `/stats` URL for a base — a **root** endpoint at the addon's origin, not
 * under any config segment (it exposes only public catalogue counts, never
 * anything credential-bearing). Optional: an addon that doesn't implement it just
 * 404s, which the client treats as "no stats".
 */
export function statsUrl(base: AddonBase): string {
  return `${new URL(base).origin}/stats`;
}

export interface ResourceRoute {
  resource: "catalog" | "meta" | "stream" | "lyrics";
  /** Content type segment, e.g. `track`, `artist`, `album`, `playlist`. */
  type: string;
  /** The content id, unencoded (e.g. `mbid:recording:<uuid>`); encoded here. */
  id: string;
  /** Optional `<extra>` key/values (catalog filters; stream/lyrics album context). */
  extra?: Record<string, string>;
}

/**
 * Build a resource route URL: `<base>/<resource>/<type>/<id>.json` (or, with
 * extra, `…/<id>/<extra>.json`). Mirrors the router's decode: the id is a single
 * `encodeURIComponent` segment; `<extra>` is `encodeURIComponent(k=v&k=v)`.
 */
export function resourceUrl(base: AddonBase, route: ResourceRoute): string {
  const id = encodeURIComponent(route.id);
  const head = `${base}/${route.resource}/${route.type}/${id}`;
  const extra = route.extra ? stringifyExtra(route.extra) : undefined;
  return extra ? `${head}/${extra}.json` : `${head}.json`;
}

/**
 * Encode an `<extra>` record the way the router decodes it: a `key=value&…`
 * query string, then a single `encodeURIComponent` so it is one path segment.
 * (Independent re-implementation of the SDK's `stringifyExtra`; the player must
 * not depend on SDK internals — only on `@p2p-songs/protocol`.)
 */
export function stringifyExtra(extra: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) params.append(k, v);
  return encodeURIComponent(params.toString());
}
