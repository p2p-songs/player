/**
 * The addon client's HTTP transport (ARCHITECTURE §3 "Addon protocol client",
 * §5a). Deliberately a *narrow, injectable* seam — not the global `fetch`
 * directly — so the whole addon client is headless-testable with a fake and so
 * `src/core` never reaches for a DOM/global implicitly (the engine-purity rule,
 * §8/§11).
 *
 * It also owns the one classification the rest of the client depends on:
 * **"this addon is down" vs "this addon has no answer."** That distinction is
 * what lets the resolver (§5) apply provider-wide backoff to an unreachable /
 * auth-failing addon without punishing a track that simply isn't in a healthy
 * addon's library (ARCHITECTURE §4b — the P-3 "distinguish a failed track from a
 * down addon" requirement).
 */

/** The minimal response shape the client needs; a subset of the DOM `Response`. */
export interface HttpResponse {
  status: number;
  /** Parse the body as JSON. Rejects on invalid JSON. */
  json(): Promise<unknown>;
}

/** A GET function. `signal` MUST be honored for cancellation (§5a command plane). */
export type HttpGet = (url: string, opts: { signal?: AbortSignal }) => Promise<HttpResponse>;

/**
 * A transport-level failure: the addon is effectively **down for us** — network
 * error, timeout, 5xx, or an auth/limit status (401/403/429). The resolver backs
 * such a provider off (§4b) rather than re-hitting it per track. `status` is
 * absent for a network-level failure (no HTTP response at all).
 */
export class AddonUnreachableError extends Error {
  constructor(
    message: string,
    /** HTTP status, if a response arrived; absent for a network-level failure. */
    readonly status?: number,
  ) {
    super(message);
    this.name = "AddonUnreachableError";
  }
}

/**
 * The addon answered (2xx) but the body didn't satisfy the protocol schema — a
 * broken/incompatible addon. Treated like unreachability for backoff purposes
 * (we stop trusting a consistently-malformed provider), but kept a distinct type
 * so a caller can tell "down" from "speaks the wrong protocol."
 */
export class AddonProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddonProtocolError";
  }
}

/** Statuses that mean "provider down/limited for us" → back off, don't retry per track. */
function isUnreachableStatus(status: number): boolean {
  // 5xx: server broken. 401/403: auth failing (a configured key gone bad).
  // 429: rate limited. All are addon-wide conditions, not per-track answers.
  return status >= 500 || status === 401 || status === 403 || status === 429;
}

/**
 * GET a protocol JSON resource and return the parsed (still-untyped) body.
 *
 * - A network throw or an unreachable status → {@link AddonUnreachableError}.
 * - `404` is **not** unreachability: it is a valid "this addon has no such
 *   resource/id" answer, surfaced as `undefined` so the caller reads it as an
 *   empty result (no match), never as an outage.
 * - Other `4xx` (e.g. a `400` from a request we built wrong) → `undefined` too:
 *   it is our problem with *this* call, not evidence the addon is down, so it
 *   must not trigger provider backoff. (`onBadRequest` surfaces it for diagnostics.)
 *
 * Never logs the URL — it can carry a configured addon's credential (§6a).
 */
export async function getJson(
  httpGet: HttpGet,
  url: string,
  opts: { signal?: AbortSignal; onBadRequest?: (status: number) => void } = {},
): Promise<unknown | undefined> {
  let res: HttpResponse;
  try {
    res = await httpGet(url, { ...(opts.signal ? { signal: opts.signal } : {}) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // Redact: never put the (possibly secret-bearing) URL into the message.
    throw new AddonUnreachableError(`addon request failed: ${errName(err)}`);
  }

  if (res.status === 404) return undefined;
  if (res.status >= 400) {
    if (isUnreachableStatus(res.status)) {
      throw new AddonUnreachableError(`addon responded ${res.status}`, res.status);
    }
    opts.onBadRequest?.(res.status);
    return undefined;
  }

  try {
    return await res.json();
  } catch {
    throw new AddonProtocolError("addon response was not valid JSON");
  }
}

function errName(err: unknown): string {
  if (err instanceof Error) return err.name || "error";
  return "error";
}

/**
 * The default transport: the platform `fetch`, asking for JSON. Requests
 * `no-store` so a browser HTTP cache never persists a configured (secret-bearing)
 * request or a bearer-URL `/stream` response (§6/§6a). Provide your own
 * {@link HttpGet} to inject timeouts, a proxy, or a fake in tests.
 */
export const defaultHttpGet: HttpGet = (url, { signal }) =>
  fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
