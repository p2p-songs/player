/**
 * `AddonCollection` — the set of installed addons (ARCHITECTURE §3, §11). This
 * is the player's addon *collection*: install by pasting a manifest URL, remove,
 * enumerate. It owns **no default/bundled addon** — installation is exclusively
 * "user provides a manifest URL" (the neutrality invariant, §11). Configured
 * (credential-bearing) manifest URLs are held only inside the `AddonClient` and
 * never logged (§6a).
 *
 * It provides the two plane-specific views the rest of the engine needs:
 * - `streamProviders()` → feeds the resolution **command plane** (`AddonStreamResolver`).
 * - `getMeta` / metadata reads → the **query plane** (§5a/§6). At this core layer
 *   these are plain fetch+validate; the TanStack Query *policy* wrapper (dedup,
 *   SWR, retry) is applied where the `QueryClient` lives — the app/UI providers
 *   layer (P-5) — keeping `src/core` headless and dependency-light. Only the
 *   command plane needs to live in the engine, because it is scheduler-owned.
 */
import type { ContentType, MetaDetail } from "@p2p-songs/protocol";
import { AddonClient, type AddonClientOptions } from "./client.js";
import { AddonUnreachableError, isAbortError, isProviderDown } from "./http.js";

export class AddonCollection {
  /** Installed clients in installation order (which defines fan-out / rank order). */
  private readonly clients: AddonClient[] = [];

  constructor(private readonly clientOptions: AddonClientOptions = {}) {}

  /**
   * Install (or update) an addon from its manifest URL. Re-installing an addon
   * whose manifest `id` already exists replaces it (a config/version update).
   * Throws if the addon is unreachable or its manifest is invalid.
   */
  async install(manifestUrl: string, signal?: AbortSignal): Promise<AddonClient> {
    const client = await AddonClient.install(manifestUrl, this.clientOptions, signal);
    const existing = this.clients.findIndex((c) => c.id === client.id);
    if (existing >= 0) this.clients[existing] = client;
    else this.clients.push(client);
    return client;
  }

  /** Remove an installed addon by its manifest id. Returns whether one was removed. */
  remove(addonId: string): boolean {
    const i = this.clients.findIndex((c) => c.id === addonId);
    if (i < 0) return false;
    this.clients.splice(i, 1);
    return true;
  }

  list(): AddonClient[] {
    return [...this.clients];
  }

  /** Addons that serve `/stream` — the resolver's provider set. */
  streamProviders(): AddonClient[] {
    return this.clients.filter((c) => c.supports("stream"));
  }

  /**
   * `/meta` for one content item, from the first meta addon that owns its
   * type + id namespace and actually answers. A **down or malformed provider is
   * isolated** and the next capable addon is tried — one flaky metadata addon
   * must never shadow the healthy providers installed after it (audit A-008). A
   * reachable "no meta" answer (404 → `undefined`) also falls through to the next
   * provider. Only when *no* provider was reachable — every one faulted — is an
   * aggregate `AddonUnreachableError` surfaced, so the query layer retries rather
   * than caching a false "not found". Cancellation stays cancellation.
   *
   * (Cross-addon field *merging* — artwork from one, tracks from another — is a
   * P-4 refinement; first-answer is sufficient for a single meta provider.)
   */
  async getMeta(type: ContentType, id: string, signal?: AbortSignal): Promise<MetaDetail | undefined> {
    const providers = this.clients.filter((c) => c.supports("meta") && c.handlesType(type) && c.handlesId(id));
    let anyReachable = false;
    let anyDown = false;
    for (const addon of providers) {
      try {
        const meta = await addon.getMeta(type, id, signal);
        anyReachable = true; // reached the addon, even if it had no meta
        if (meta) return meta;
      } catch (err) {
        if (isAbortError(err)) throw err; // a skip/supersede — don't mask it
        if (isProviderDown(err)) {
          anyDown = true; // isolate this addon-wide fault, try the next provider
          continue;
        }
        throw err; // an unexpected (non-addon) error is a real bug — surface it
      }
    }
    if (!anyReachable && anyDown) throw new AddonUnreachableError("all meta providers unreachable");
    return undefined;
  }
}
