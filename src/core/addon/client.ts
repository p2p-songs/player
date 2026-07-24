/**
 * `AddonClient` — the player's typed client for **one** installed addon
 * (ARCHITECTURE §3 "Addon protocol client"). It speaks only the generic
 * HTTP+JSON protocol via `@p2p-songs/protocol` — never anything addon-specific
 * (the neutrality invariant, §11).
 *
 * Every response is **validated against the protocol schema before it reaches
 * the engine**: an addon is untrusted input, so a malformed body is rejected
 * (`AddonProtocolError`) rather than fed into the queue/scheduler. This is the
 * runtime reason the player takes a (transitive) dependency on zod here, even
 * though its type-only protocol imports elsewhere are free.
 *
 * The client is manifest-aware — `supports`/`handlesType`/`handlesId` let a
 * caller (the collection / resolver, §5) skip an addon that never advertises the
 * resource, type, or id namespace being asked for, instead of making a doomed
 * request. It holds the (possibly credential-bearing, §6a) manifest URL and
 * never logs it.
 */
import {
  manifestSchema,
  streamResponseSchema,
  metaResponseSchema,
  catalogResponseSchema,
  lyricsResponseSchema,
  type Manifest,
  type Resource,
  type ContentType,
  type Stream,
  type StreamRequest,
  type LyricsRequest,
  type MetaDetail,
  type MetaPreview,
  type Lyric,
} from "@p2p-songs/protocol";
import {
  addonBaseFromManifestUrl,
  manifestUrl as manifestUrlOf,
  resourceUrl,
  statsUrl,
  type AddonBase,
  type ResourceRoute,
} from "./endpoints.js";
import { getJson, defaultHttpGet, AddonProtocolError, AddonUnreachableError, type HttpGet } from "./http.js";

/**
 * The only thing the client needs from a protocol schema: validate an untrusted
 * body. Structural, so the player validates addon responses without a direct
 * `zod` dependency — the `@p2p-songs/protocol` schemas satisfy this shape.
 */
interface Validator<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

/**
 * Public catalogue counts an addon may expose at `/stats` (a curated catalogue is
 * finite, so the player can tell the user how much is searchable). A generic,
 * source-free capability — not every addon implements it.
 */
export interface CatalogStats {
  artists: number;
  albums: number;
  tracks: number;
  /** artists + albums + tracks. */
  total: number;
}

/** Diagnostics for a request *we* built that the addon rejected as a 4xx (not an outage). */
export interface BadRequestInfo {
  addonId: string;
  resource: Resource;
  status: number;
}

export interface AddonClientOptions {
  /** Transport (default: platform `fetch`). Injected in tests. */
  httpGet?: HttpGet;
  /** Notified for a non-fatal 4xx (e.g. a 400 from a request we mis-built). Never receives the URL. */
  onBadRequest?: (info: BadRequestInfo) => void;
}

export class AddonClient {
  private constructor(
    readonly manifest: Manifest,
    private readonly base: AddonBase,
    private readonly httpGet: HttpGet,
    private readonly onBadRequest?: (info: BadRequestInfo) => void,
  ) {}

  /**
   * Install an addon from its manifest URL: fetch + validate the manifest, then
   * construct a client bound to it. Throws {@link AddonUnreachableError} if the
   * addon is down and {@link AddonProtocolError} if the manifest is malformed.
   */
  static async install(manifestUrl: string, opts: AddonClientOptions = {}, signal?: AbortSignal): Promise<AddonClient> {
    const httpGet = opts.httpGet ?? defaultHttpGet;
    const base = addonBaseFromManifestUrl(manifestUrl);
    const body = await getJson(httpGet, manifestUrlOf(base), { ...(signal ? { signal } : {}) });
    if (body === undefined) throw new AddonUnreachableError("addon returned no manifest");
    const parsed = manifestSchema.safeParse(body);
    if (!parsed.success) throw new AddonProtocolError("addon manifest failed validation");
    return new AddonClient(parsed.data, base, httpGet, opts.onBadRequest);
  }

  get id(): string {
    return this.manifest.id;
  }

  supports(resource: Resource): boolean {
    return this.manifest.resources.includes(resource);
  }

  handlesType(type: ContentType): boolean {
    return this.manifest.types.includes(type);
  }

  /** Does this addon advertise the id's namespace? (No `idPrefixes` ⇒ handles all.) */
  handlesId(id: string): boolean {
    const prefixes = this.manifest.idPrefixes;
    if (!prefixes || prefixes.length === 0) return true;
    return prefixes.some((p) => id.startsWith(p));
  }

  /** `/stream` for a recording. Returns the ranked stream list (empty ⇒ no match, not an error). */
  async getStreams(req: StreamRequest, signal?: AbortSignal): Promise<Stream[]> {
    const route: ResourceRoute = {
      resource: "stream",
      type: "track",
      id: req.recordingId,
      extra: streamExtra(req),
    };
    const res = await this.fetch("stream", route, streamResponseSchema, signal);
    return res?.streams ?? [];
  }

  /** `/meta` for a single content item. `undefined` ⇒ this addon has no meta for it. */
  async getMeta(type: ContentType, id: string, signal?: AbortSignal): Promise<MetaDetail | undefined> {
    const res = await this.fetch("meta", { resource: "meta", type, id }, metaResponseSchema, signal);
    return res?.meta;
  }

  /** `/catalog` listing. `extra` carries search/genre/skip filters. */
  async getCatalog(
    type: ContentType,
    id: string,
    extra: Record<string, string> | undefined,
    signal?: AbortSignal,
  ): Promise<MetaPreview[]> {
    const route: ResourceRoute = { resource: "catalog", type, id, ...(extra ? { extra } : {}) };
    const res = await this.fetch("catalog", route, catalogResponseSchema, signal);
    return res?.metas ?? [];
  }

  /**
   * `/stats` — the addon's public catalogue counts, or `undefined` if it doesn't
   * offer them. Best-effort by design: a non-catalog addon, a 404/503, an
   * unreachable host, or a malformed body all resolve to `undefined` (never an
   * error), because a missing size indicator must not break anything. Only an
   * abort propagates.
   */
  async getCatalogStats(signal?: AbortSignal): Promise<CatalogStats | undefined> {
    if (!this.supports("catalog")) return undefined;
    let res;
    try {
      res = await this.httpGet(statsUrl(this.base), { ...(signal ? { signal } : {}) });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return undefined;
    }
    if (res.status !== 200) return undefined;
    try {
      return parseCatalogStats(await res.json());
    } catch {
      return undefined;
    }
  }

  /** `/lyrics` for a recording. */
  async getLyrics(req: LyricsRequest, signal?: AbortSignal): Promise<Lyric[]> {
    const extra = req.trackId ? { trackId: req.trackId } : undefined;
    const route: ResourceRoute = { resource: "lyrics", type: "track", id: req.recordingId, ...(extra ? { extra } : {}) };
    const res = await this.fetch("lyrics", route, lyricsResponseSchema, signal);
    return res?.lyrics ?? [];
  }

  /** GET a resource and validate it. `undefined` ⇒ addon has no answer (404/benign 4xx). */
  private async fetch<T>(
    resource: Resource,
    route: ResourceRoute,
    schema: Validator<T>,
    signal: AbortSignal | undefined,
  ): Promise<T | undefined> {
    const url = resourceUrl(this.base, route);
    const body = await getJson(this.httpGet, url, {
      ...(signal ? { signal } : {}),
      onBadRequest: (status) => this.onBadRequest?.({ addonId: this.id, resource, status }),
    });
    if (body === undefined) return undefined;
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new AddonProtocolError(`${resource} response failed validation`);
    return parsed.data;
  }
}

/**
 * Validate an untrusted `/stats` body into {@link CatalogStats}, or `undefined`.
 * musicmeta reports singular keys (`{artist, album, track, total}`); we map to the
 * player's plural shape and require every count to be a finite number.
 */
function parseCatalogStats(body: unknown): CatalogStats | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const b = body as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const artists = num(b.artist);
  const albums = num(b.album);
  const tracks = num(b.track);
  const total = num(b.total);
  if (artists === undefined || albums === undefined || tracks === undefined || total === undefined) return undefined;
  return { artists, albums, tracks, total };
}

/** Build the `<extra>` record for a stream request from its optional album-context ids. */
function streamExtra(req: StreamRequest): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  if (req.trackId) extra.trackId = req.trackId;
  if (req.releaseId) extra.releaseId = req.releaseId;
  return Object.keys(extra).length > 0 ? extra : undefined;
}
