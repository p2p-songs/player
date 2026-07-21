/**
 * Bounded provider fan-out (ARCHITECTURE §5/§6; audit A-008). Asking an installed
 * addon anything over HTTP must never let one hung provider — a socket that
 * accepts the connection then never answers — stall the whole operation. This is
 * the shared primitive both planes use: the stream resolver (command plane) and
 * the metadata reads (query plane) run each provider through it.
 *
 * It runs `task` under a child `AbortController` linked to the caller's
 * `outerSignal` AND a per-call deadline, and **never rejects** — it reports the
 * outcome so the caller can isolate a down/timed-out provider (back it off / skip
 * it) while still honoring a genuine cancellation. An outer-signal abort takes
 * precedence over the timeout: the user skipped, the provider didn't fail.
 */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

export type Bounded<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" } // exceeded the per-provider deadline
  | { kind: "aborted" } // the outer signal fired — a supersede/skip
  | { kind: "error"; error: unknown };

export async function askBounded<T>(
  task: (signal: AbortSignal) => Promise<T>,
  outerSignal: AbortSignal,
  timeoutMs: number,
): Promise<Bounded<T>> {
  const child = new AbortController();
  const onOuterAbort = () => child.abort();
  if (outerSignal.aborted) child.abort();
  else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.abort();
  }, timeoutMs);
  try {
    return { kind: "ok", value: await task(child.signal) };
  } catch (error) {
    if (outerSignal.aborted) return { kind: "aborted" }; // outer cancel wins over our timeout
    if (timedOut) return { kind: "timeout" };
    return { kind: "error", error };
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

/** A never-aborting signal, for callers that don't supply one. */
export function neverAbort(): AbortSignal {
  return new AbortController().signal;
}
