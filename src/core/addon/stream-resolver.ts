/**
 * `AddonStreamResolver` — the **real** `Resolver` (ARCHITECTURE §5/§5a) that P-3
 * swaps in for the P-1 `FakeResolver`. It turns a track into a ranked stream
 * list by fanning `/stream` out across the installed stream addons over HTTP,
 * merging their results.
 *
 * It is deliberately a *plain* resolver: **no caching, no retry.** The
 * command-plane semantics §5a demands — dedup by operation id, no
 * retry/refetch, memory-only, stamped — are enforced by the `Scheduler` that
 * *calls* this (that separation is the whole point of the `Resolver` seam). The
 * one thing that genuinely belongs here, because only the multi-addon client can
 * see it, is **provider-wide backoff** (§4b): a down/auth-failing addon is
 * skipped addon-wide instead of re-hit per track.
 *
 * Neutrality (§11): it knows nothing addon-specific — every provider is called
 * through the generic protocol client and judged only by what it returns.
 */
import type { Stream, StreamRequest } from "@p2p-songs/protocol";
import type { TrackRef } from "../queue/types.js";
import type { Resolver, ResolveOutcome } from "../scheduler/resolver.js";
import type { AddonClient } from "./client.js";
import { isAbortError, isProviderDown } from "./http.js";
import { ProviderHealth, type ProviderHealthOptions } from "./provider-health.js";

/** How long to wait for a single provider before treating it as unreachable. */
const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

export interface AddonStreamResolverOptions extends ProviderHealthOptions {
  /**
   * The current stream providers, newest queue/rank order. A supplier (not a
   * fixed array) so installs/removals in the collection are reflected live.
   */
  providers: () => AddonClient[];
  /**
   * Per-provider deadline (ms). A provider that hasn't answered within it is
   * aborted and classified as unreachable → backed off, so one hung addon can
   * never stall the whole resolve (audit A-008). Default 15s.
   */
  providerTimeoutMs?: number;
}

/** The bounded outcome of asking one provider for streams — never rejects. */
type ProviderResult =
  | { kind: "ok"; streams: Stream[] }
  | { kind: "down" } // unreachable / 5xx / auth / malformed / timed out
  | { kind: "aborted" } // the outer (scheduler) signal fired — a supersede/skip
  | { kind: "fatal"; error: unknown };

export class AddonStreamResolver implements Resolver {
  private readonly providers: () => AddonClient[];
  private readonly health: ProviderHealth;
  private readonly providerTimeoutMs: number;

  constructor(opts: AddonStreamResolverOptions) {
    this.providers = opts.providers;
    this.health = new ProviderHealth(opts);
    this.providerTimeoutMs = opts.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  async resolve(track: TrackRef, signal: AbortSignal): Promise<ResolveOutcome> {
    const req = {
      recordingId: track.recordingId,
      ...(track.trackId ? { trackId: track.trackId } : {}),
      ...(track.releaseId ? { releaseId: track.releaseId } : {}),
    } as StreamRequest;

    // Which installed addons can even answer for this recording?
    const capable = this.providers().filter(
      (a) => a.supports("stream") && a.handlesType("track") && a.handlesId(track.recordingId),
    );
    if (capable.length === 0) return { ok: false, reason: "no stream addon for this track" };

    // …and of those, which are not currently backed off?
    const eligible = capable.filter((a) => !this.health.isBackedOff(a.id));
    if (eligible.length === 0) return { ok: false, reason: "stream addons backing off" };

    // Ask every eligible provider under its OWN bounded deadline. Each call
    // resolves within `providerTimeoutMs` even if the addon accepts the
    // connection and then hangs, so `Promise.all` here always completes — one
    // stalled provider can never wedge the whole resolution (audit A-008).
    const results = await Promise.all(eligible.map((addon) => this.askProvider(addon, req, signal)));

    // A supervening skip/reorder aborted us mid-flight; the scheduler's stamp
    // gate will drop this anyway, but returning early avoids mutating provider
    // health on a cancellation.
    if (signal.aborted) return { ok: false, reason: "cancelled" };

    const merged: Stream[] = [];
    let anyReachable = false;
    for (let i = 0; i < eligible.length; i++) {
      const addon = eligible[i]!;
      const r = results[i]!;
      switch (r.kind) {
        case "ok":
          anyReachable = true;
          this.health.recordReachable(addon.id); // reachable — even an empty answer clears backoff
          for (const s of r.streams) if (typeof s.url === "string") merged.push(s);
          break;
        case "down":
          this.health.recordFailure(addon.id); // addon-wide problem (incl. timeout) → back it off
          break;
        case "aborted":
          return { ok: false, reason: "cancelled" };
        case "fatal":
          throw r.error; // an unexpected non-addon error: don't swallow
      }
    }

    if (merged.length > 0) return { ok: true, streams: merged };
    // No playable stream. Separate "reachable but no match" from "all providers down".
    return anyReachable
      ? { ok: false, reason: "no playable stream found" }
      : { ok: false, reason: "stream addons unavailable" };
  }

  /**
   * Ask one provider for streams, bounded by `providerTimeoutMs` and the outer
   * signal, never rejecting. A timeout is classified as `down` (the addon is
   * unreachable *for us*), distinct from an outer-signal cancellation (`aborted`,
   * which must not accrue backoff — the user skipped, the addon didn't fail).
   */
  private async askProvider(addon: AddonClient, req: StreamRequest, outerSignal: AbortSignal): Promise<ProviderResult> {
    const child = new AbortController();
    const onOuterAbort = () => child.abort();
    if (outerSignal.aborted) child.abort();
    else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.abort();
    }, this.providerTimeoutMs);
    try {
      const streams = await addon.getStreams(req, child.signal);
      return { kind: "ok", streams };
    } catch (err) {
      if (outerSignal.aborted) return { kind: "aborted" }; // outer cancel wins over our timeout
      if (timedOut) return { kind: "down" }; // hung past its deadline → treat as unreachable
      if (isProviderDown(err)) return { kind: "down" };
      if (isAbortError(err)) return { kind: "aborted" }; // defensive: some other abort
      return { kind: "fatal", error: err };
    } finally {
      clearTimeout(timer);
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }

  /** Ms until `addonId` is eligible again (test/telemetry aid). */
  backoffRemainingMs(addonId: string): number {
    return this.health.backoffRemainingMs(addonId);
  }
}
