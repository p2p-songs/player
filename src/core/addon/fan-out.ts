/**
 * Bounded provider fan-out (ARCHITECTURE §5/§6; audit A-008). Asking an installed
 * addon anything over HTTP must never let one hung provider — a socket that
 * accepts the connection then never answers — stall the whole operation. This is
 * the shared primitive both planes use: the stream resolver (command plane) and
 * the metadata reads (query plane) run each provider through it.
 *
 * It **never rejects** — it reports the outcome so the caller can isolate a
 * down/timed-out provider (back it off / skip it) while still honoring a genuine
 * cancellation. An outer-signal abort takes precedence over the timeout: the
 * user skipped, the provider didn't fail.
 *
 * The deadline is a **hard bound, not a cooperative one** (audit A-009). An
 * earlier version only aborted a child signal and then awaited the task, so a
 * task that ignored its signal never settled — the timeout branch was
 * unreachable and one uncooperative transport could still wedge every provider
 * behind it. The result now races the task against a timer we control; the child
 * signal is aborted afterwards purely so a *cooperative* transport can release
 * its socket.
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
  if (outerSignal.aborted) return { kind: "aborted" }; // don't start work we'd abandon

  const child = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onOuterAbort: (() => void) | undefined;

  // The deadline must settle **independently of the task** (audit A-009). Merely
  // aborting a child signal is cooperative: a transport that ignores its signal
  // would leave us awaiting forever and wedge every co-provider behind us. So we
  // race the task against a promise only we control.
  const deadline = new Promise<Bounded<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    onOuterAbort = () => resolve({ kind: "aborted" });
    outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  });

  // Never rejects — a sync throw or async rejection becomes a Bounded value, so
  // abandoning it below can't surface as an unhandled rejection.
  const ran: Promise<Bounded<T>> = (async () => {
    try {
      return { kind: "ok", value: await task(child.signal) } as Bounded<T>;
    } catch (error) {
      return (outerSignal.aborted ? { kind: "aborted" } : { kind: "error", error }) as Bounded<T>;
    }
  })();

  try {
    const result = await Promise.race([ran, deadline]);
    // If we gave up on the task, abort it so a cooperative transport can release
    // its socket. `ran` is already rejection-safe, so we simply drop it.
    if (result.kind === "timeout" || result.kind === "aborted") child.abort();
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onOuterAbort) outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

/** A never-aborting signal, for callers that don't supply one. */
export function neverAbort(): AbortSignal {
  return new AbortController().signal;
}
