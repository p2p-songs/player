/**
 * `AddonCollection` — the set of installed addons (ARCHITECTURE §3, §11). This
 * is the player's addon *collection*: install by pasting a manifest URL, remove,
 * enumerate. It bundles **no stream addon and no credentials** — the neutrality
 * invariant (§11) governs the stream plane. Every install, including the app
 * layer's one default *metadata* addon (`app/default-addons.ts`), comes through
 * `install(manifestUrl)`; this class has no notion of a default and treats them
 * all alike. Configured (credential-bearing) manifest URLs are held only inside
 * the `AddonClient` and never logged (§6a).
 *
 * It provides the two plane-specific views the rest of the engine needs:
 * - `streamProviders()` → feeds the resolution **command plane** (`AddonStreamResolver`).
 * - `getMeta` / metadata reads → the **query plane** (§5a/§6). At this core layer
 *   these are plain fetch+validate; the TanStack Query *policy* wrapper (dedup,
 *   SWR, retry) is applied where the `QueryClient` lives — the app/UI providers
 *   layer (P-5) — keeping `src/core` headless and dependency-light. Only the
 *   command plane needs to live in the engine, because it is scheduler-owned.
 */
import type { ContentType, MetaDetail, MetaPreview } from "@p2p-songs/protocol";
import { AddonClient, type AddonClientOptions, type CatalogStats } from "./client.js";
import { AddonUnreachableError, isProviderDown } from "./http.js";
import { askBounded, neverAbort, DEFAULT_PROVIDER_TIMEOUT_MS } from "./fan-out.js";

export interface AddonCollectionOptions {
  /** Per-provider deadline for metadata reads (default 15s) — one hung addon can't stall a fan-out (A-008). */
  providerTimeoutMs?: number;
}

export class AddonCollection {
  /** Installed clients in installation order (which defines fan-out / rank order). */
  private readonly clients: AddonClient[] = [];
  private readonly providerTimeoutMs: number;

  constructor(
    private readonly clientOptions: AddonClientOptions = {},
    options: AddonCollectionOptions = {},
  ) {
    this.providerTimeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  }

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
   * Aggregate public catalogue counts across every catalog addon that exposes
   * `/stats` — how much music is searchable, for the "X songs · Y albums · Z
   * artists indexed" awareness indicator. `undefined` when none report stats (so
   * the UI simply shows nothing rather than a misleading zero). Best-effort: a
   * provider without `/stats` contributes nothing; only an abort propagates.
   */
  async catalogStats(signal?: AbortSignal): Promise<CatalogStats | undefined> {
    const providers = this.clients.filter((c) => c.supports("catalog"));
    const results = await Promise.all(providers.map((c) => c.getCatalogStats(signal)));
    const present = results.filter((r): r is CatalogStats => r !== undefined);
    if (present.length === 0) return undefined;
    return present.reduce((acc, s) => ({
      artists: acc.artists + s.artists,
      albums: acc.albums + s.albums,
      tracks: acc.tracks + s.tracks,
      total: acc.total + s.total,
    }));
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
    const outer = signal ?? neverAbort();
    let anyReachable = false;
    let anyDown = false;
    for (const addon of providers) {
      // Bound each provider: a hung addon must not stall the sequential walk (A-008).
      const r = await askBounded((sig) => addon.getMeta(type, id, sig), outer, this.providerTimeoutMs);
      if (r.kind === "ok") {
        anyReachable = true; // reached the addon, even if it had no meta
        if (r.value) return r.value;
      } else if (r.kind === "timeout") {
        anyDown = true; // isolate this addon-wide fault, try the next provider
      } else if (r.kind === "aborted") {
        throw abortError(); // a skip/supersede — propagate, don't mask
      } else if (isProviderDown(r.error)) {
        anyDown = true;
      } else {
        throw r.error; // an unexpected (non-addon) error is a real bug — surface it
      }
    }
    if (!anyReachable && anyDown) throw new AddonUnreachableError("all meta providers unreachable");
    return undefined;
  }

  /**
   * Search every installed catalog addon of `type` in parallel and merge the
   * results, deduped by content id (first addon in install order wins). This is
   * the metadata-plane sibling of the stream resolver's fan-out (§6 "parallel
   * fan-out across installed addons; merge/dedup by MBID"): each provider runs
   * under its own bounded deadline and a down/malformed/timed-out one is isolated
   * — a healthy addon's results are never lost to a flaky co-provider. An
   * aggregate `AddonUnreachableError` surfaces only when no provider was reachable
   * (so the caller retries rather than showing an empty search as authoritative).
   */
  async search(type: ContentType, query: string, signal?: AbortSignal): Promise<MetaPreview[]> {
    return this.catalog(type, { search: query }, (client) => this.searchCatalogsFor(client, type), signal);
  }

  /**
   * A specific catalog by id, with its own required extra — e.g. an artist's
   * discography (`byArtist` + `artistId`). Same fan-out, isolation, and
   * dedup rules as {@link search}; only the catalog selection differs.
   */
  async catalogById(
    type: ContentType,
    catalogId: string,
    extra: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<MetaPreview[]> {
    return this.catalog(
      type,
      extra,
      (client) =>
        client.supports("catalog")
          ? client.manifest.catalogs.filter((cat) => cat.type === type && cat.id === catalogId)
          : [],
      signal,
    );
  }

  /** The shared fan-out both catalog entry points use. */
  private async catalog(
    type: ContentType,
    extra: Record<string, string>,
    catalogsFor: (client: AddonClient) => { id: string }[],
    signal?: AbortSignal,
  ): Promise<MetaPreview[]> {
    const providers = this.clients.filter((c) => catalogsFor(c).length > 0);
    if (providers.length === 0) return [];
    const outer = signal ?? neverAbort();

    const results = await Promise.all(
      providers.map((addon) =>
        askBounded(async (sig) => {
          const metas: MetaPreview[] = [];
          for (const cat of catalogsFor(addon)) {
            metas.push(...(await addon.getCatalog(type, cat.id, extra, sig)));
          }
          return metas;
        }, outer, this.providerTimeoutMs),
      ),
    );
    if (outer.aborted) throw abortError();

    const merged: MetaPreview[] = [];
    let anyReachable = false;
    let anyDown = false;
    for (const r of results) {
      if (r.kind === "ok") {
        anyReachable = true;
        merged.push(...r.value);
      } else if (r.kind === "timeout") {
        anyDown = true;
      } else if (r.kind === "error") {
        if (isProviderDown(r.error)) anyDown = true;
        else throw r.error;
      }
      // "aborted" handled by the outer.aborted check above
    }
    const deduped = dedupById(merged);
    if (deduped.length === 0 && !anyReachable && anyDown) {
      throw new AddonUnreachableError("all catalog providers unreachable");
    }
    return deduped;
  }

  /** The searchable catalogs an addon advertises for `type` (a catalog with a `search` extra). */
  private searchCatalogsFor(client: AddonClient, type: ContentType) {
    if (!client.supports("catalog")) return [];
    return client.manifest.catalogs.filter(
      (cat) => cat.type === type && (cat.extra ?? []).some((e) => e.name === "search"),
    );
  }
}

/** A fresh AbortError, for propagating a cancellation the bounded helper swallowed. */
function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

/** Merge preview lists, keeping the first occurrence of each content id (install-order priority). */
function dedupById(metas: MetaPreview[]): MetaPreview[] {
  const seen = new Set<string>();
  const out: MetaPreview[] = [];
  for (const m of metas) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}
