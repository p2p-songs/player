/**
 * Per-provider health + exponential backoff (ARCHITECTURE §4b, §5.6).
 *
 * This is the P-3 half of "failure is bounded" that P-1 explicitly deferred: with
 * a single in-process fake resolver there was no *provider* to back off from, so
 * the engine's breaker only bounded per-track skip-ahead. Now that resolution
 * fans out to real, independent addons over HTTP, a globally unreachable or
 * auth-failing addon must be **backed off addon-wide** — otherwise every track
 * would re-hit a down provider and eat the round-trip. Crucially this
 * distinguishes *"this track isn't in a healthy addon"* (a reachable addon that
 * returns empty — **not** a failure) from *"this addon is down"* (unreachable /
 * 5xx / auth) — only the latter accrues backoff.
 *
 * The clock is injectable so tests are deterministic (no real timers).
 */
export interface ProviderHealthOptions {
  /** First backoff after one failure (default 1s). */
  baseMs?: number;
  /** Cap on the exponential backoff (default 60s). */
  maxMs?: number;
  /** Clock (default Date.now). */
  now?: () => number;
}

interface Entry {
  failures: number;
  backoffUntil: number;
}

export class ProviderHealth {
  private readonly entries = new Map<string, Entry>();
  private readonly baseMs: number;
  private readonly maxMs: number;
  private readonly now: () => number;

  constructor(opts: ProviderHealthOptions = {}) {
    this.baseMs = opts.baseMs ?? 1000;
    this.maxMs = opts.maxMs ?? 60000;
    this.now = opts.now ?? Date.now;
  }

  /** Is this provider currently in a backoff window (skip it this round)? */
  isBackedOff(id: string): boolean {
    const e = this.entries.get(id);
    return e !== undefined && e.backoffUntil > this.now();
  }

  /** A reachable response (even an empty one) clears any backoff — the addon is up. */
  recordReachable(id: string): void {
    this.entries.delete(id);
  }

  /** An addon-wide failure (unreachable / 5xx / auth / malformed): grow the backoff window. */
  recordFailure(id: string): void {
    const prev = this.entries.get(id)?.failures ?? 0;
    const failures = prev + 1;
    // 2^(n-1) * base, capped — 1s, 2s, 4s, … up to maxMs.
    const delay = Math.min(this.baseMs * 2 ** (failures - 1), this.maxMs);
    this.entries.set(id, { failures, backoffUntil: this.now() + delay });
  }

  /** Milliseconds until `id` is eligible again (0 if healthy/eligible now). Test/telemetry aid. */
  backoffRemainingMs(id: string): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    return Math.max(0, e.backoffUntil - this.now());
  }
}
