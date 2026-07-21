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
import type { Stream } from "@p2p-songs/protocol";
import type { TrackRef } from "../queue/types.js";
import type { Resolver, ResolveOutcome } from "../scheduler/resolver.js";
import type { AddonClient } from "./client.js";
import { AddonUnreachableError, AddonProtocolError } from "./http.js";
import { ProviderHealth, type ProviderHealthOptions } from "./provider-health.js";

export interface AddonStreamResolverOptions extends ProviderHealthOptions {
  /**
   * The current stream providers, newest queue/rank order. A supplier (not a
   * fixed array) so installs/removals in the collection are reflected live.
   */
  providers: () => AddonClient[];
}

export class AddonStreamResolver implements Resolver {
  private readonly providers: () => AddonClient[];
  private readonly health: ProviderHealth;

  constructor(opts: AddonStreamResolverOptions) {
    this.providers = opts.providers;
    this.health = new ProviderHealth(opts);
  }

  async resolve(track: TrackRef, signal: AbortSignal): Promise<ResolveOutcome> {
    const req = {
      recordingId: track.recordingId,
      ...(track.trackId ? { trackId: track.trackId } : {}),
      ...(track.releaseId ? { releaseId: track.releaseId } : {}),
    };

    // Which installed addons can even answer for this recording?
    const capable = this.providers().filter(
      (a) => a.supports("stream") && a.handlesType("track") && a.handlesId(track.recordingId),
    );
    if (capable.length === 0) return { ok: false, reason: "no stream addon for this track" };

    // …and of those, which are not currently backed off?
    const eligible = capable.filter((a) => !this.health.isBackedOff(a.id));
    if (eligible.length === 0) return { ok: false, reason: "stream addons backing off" };

    const results = await Promise.allSettled(
      // safeParse in the client guarantees StreamRequest shape; cast is at the seam only.
      eligible.map((addon) => addon.getStreams(req as Parameters<AddonClient["getStreams"]>[0], signal)),
    );

    // A supervening skip/reorder aborted us mid-flight; the scheduler's stamp
    // gate will drop this anyway, but reporting it as a non-result avoids
    // mutating provider health on a cancellation.
    if (signal.aborted) return { ok: false, reason: "cancelled" };

    const merged: Stream[] = [];
    let anyReachable = false;
    for (let i = 0; i < eligible.length; i++) {
      const addon = eligible[i]!;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        anyReachable = true;
        this.health.recordReachable(addon.id); // reachable — even an empty answer clears backoff
        for (const s of r.value) if (typeof s.url === "string") merged.push(s);
      } else if (isProviderDown(r.reason)) {
        this.health.recordFailure(addon.id); // addon-wide problem → back it off
      } else {
        throw r.reason; // AbortError or an unexpected non-addon error: don't swallow
      }
    }

    if (merged.length > 0) return { ok: true, streams: merged };
    // No playable stream. Separate "reachable but no match" from "all providers down".
    return anyReachable
      ? { ok: false, reason: "no playable stream found" }
      : { ok: false, reason: "stream addons unavailable" };
  }

  /** Ms until `addonId` is eligible again (test/telemetry aid). */
  backoffRemainingMs(addonId: string): number {
    return this.health.backoffRemainingMs(addonId);
  }
}

/** An addon-wide fault (down / auth / 5xx / malformed) — as opposed to a per-track empty answer. */
function isProviderDown(err: unknown): boolean {
  return err instanceof AddonUnreachableError || err instanceof AddonProtocolError;
}
