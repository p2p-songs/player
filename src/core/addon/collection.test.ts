import { describe, it, expect } from "vitest";
import { AddonCollection } from "./collection.js";
import { AddonUnreachableError } from "./http.js";
import { FakeHttp, abortError } from "./fake-http.js";
import type { Manifest } from "@p2p-songs/protocol";

const ARTIST = "mbid:artist:33333333-3333-3333-3333-333333333333";
const T1 = "mbid:recording:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const T2 = "mbid:recording:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const T3 = "mbid:recording:cccccccc-cccc-cccc-cccc-cccccccccccc";
const trackPreview = (id: string, name: string) => ({ type: "track", id, name });
/** A /catalog or /meta route that accepts the connection then never answers. */
const hang = (_url: string, signal?: AbortSignal) =>
  new Promise<{ status: number; body: unknown }>((_res, reject) => {
    if (signal?.aborted) reject(abortError());
    else signal?.addEventListener("abort", () => reject(abortError()), { once: true });
  });

function manifest(over: Partial<Manifest> & Pick<Manifest, "id">): Manifest {
  return {
    version: "1.0.0",
    name: over.id,
    description: "",
    resources: ["stream"],
    types: ["track"],
    catalogs: [],
    ...over,
  } as Manifest;
}

function serve(http: FakeHttp, host: string, m: Manifest): string {
  const url = `${host}/manifest.json`;
  http.on(url, () => ({ status: 200, body: m }));
  return url;
}

describe("AddonCollection", () => {
  it("installs, lists, and removes addons in order", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const aUrl = serve(http, "https://a.example", manifest({ id: "a" }));
    const bUrl = serve(http, "https://b.example", manifest({ id: "b" }));

    await collection.install(aUrl);
    await collection.install(bUrl);
    expect(collection.list().map((c) => c.id)).toEqual(["a", "b"]);

    expect(collection.remove("a")).toBe(true);
    expect(collection.remove("a")).toBe(false);
    expect(collection.list().map((c) => c.id)).toEqual(["b"]);
  });

  it("re-installing an existing id updates in place (config/version change)", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const url = "https://a.example/manifest.json";
    let version = "1.0.0";
    http.on(url, () => ({ status: 200, body: manifest({ id: "a", version }) }));

    await collection.install(url);
    version = "2.0.0";
    await collection.install(url);
    expect(collection.list()).toHaveLength(1);
    expect(collection.list()[0]!.manifest.version).toBe("2.0.0");
  });

  it("streamProviders filters to stream-capable addons", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const metaUrl = serve(http, "https://meta.example", manifest({ id: "meta", resources: ["meta", "catalog"], types: ["artist"] }));
    const streamUrl = serve(http, "https://stream.example", manifest({ id: "stream", resources: ["stream"] }));

    await collection.install(metaUrl);
    await collection.install(streamUrl);
    expect(collection.streamProviders().map((c) => c.id)).toEqual(["stream"]);
  });

  // --- metadata fault isolation (audit A-008) ---

  const metaManifest = (id: string) =>
    manifest({ id, resources: ["meta"], types: ["artist"], idPrefixes: ["mbid:artist:"] });

  const validMeta = { status: 200, body: { meta: { type: "artist", id: ARTIST, name: "The Artist" } } };

  /** Install two meta addons (m1 then m2) with scripted /meta routes. */
  async function twoMetaProviders(
    http: FakeHttp,
    m1: () => { status: number; body: unknown },
    m2: () => { status: number; body: unknown },
  ): Promise<AddonCollection> {
    const collection = new AddonCollection({ httpGet: http.get });
    http.on("https://m1.example/manifest.json", () => ({ status: 200, body: metaManifest("m1") }));
    http.on("https://m2.example/manifest.json", () => ({ status: 200, body: metaManifest("m2") }));
    http.when((u) => u.startsWith("https://m1.example/meta/"), m1);
    http.when((u) => u.startsWith("https://m2.example/meta/"), m2);
    await collection.install("https://m1.example/manifest.json");
    await collection.install("https://m2.example/manifest.json");
    return collection;
  }

  it("falls through a DOWN first provider to a healthy second", async () => {
    const http = new FakeHttp();
    const collection = await twoMetaProviders(http, () => ({ status: 503, body: {} }), () => validMeta);
    const meta = await collection.getMeta("artist", ARTIST);
    expect(meta?.name).toBe("The Artist");
    // the healthy provider was actually queried
    expect(http.requests.some((u) => u.startsWith("https://m2.example/meta/"))).toBe(true);
  });

  it("falls through a MALFORMED first provider to a healthy second", async () => {
    const http = new FakeHttp();
    const collection = await twoMetaProviders(http, () => ({ status: 200, body: { meta: { id: "x" } } }), () => validMeta);
    await expect(collection.getMeta("artist", ARTIST)).resolves.toMatchObject({ name: "The Artist" });
  });

  it("falls through an EMPTY (reachable) first provider to a healthy second", async () => {
    const http = new FakeHttp();
    const collection = await twoMetaProviders(http, () => ({ status: 404, body: { err: "not found" } }), () => validMeta);
    await expect(collection.getMeta("artist", ARTIST)).resolves.toMatchObject({ name: "The Artist" });
  });

  it("throws AddonUnreachableError only when NO provider is reachable", async () => {
    const http = new FakeHttp();
    const collection = await twoMetaProviders(http, () => ({ status: 503, body: {} }), () => ({ status: 500, body: {} }));
    await expect(collection.getMeta("artist", ARTIST)).rejects.toBeInstanceOf(AddonUnreachableError);
  });

  it("returns undefined (not an error) when reachable providers simply have no meta", async () => {
    const http = new FakeHttp();
    const collection = await twoMetaProviders(
      http,
      () => ({ status: 404, body: {} }),
      () => ({ status: 404, body: {} }),
    );
    await expect(collection.getMeta("artist", ARTIST)).resolves.toBeUndefined();
  });

  it("propagates cancellation instead of masking it as a provider fault", async () => {
    const http = new FakeHttp();
    const collection = await twoMetaProviders(http, () => validMeta, () => validMeta);
    const ac = new AbortController();
    ac.abort();
    await expect(collection.getMeta("artist", ARTIST, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("getMeta resolves from the first matching meta provider", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const metaManifest = manifest({ id: "meta", resources: ["meta"], types: ["artist"], idPrefixes: ["mbid:artist:"] });
    serve(http, "https://meta.example", metaManifest);
    http.when(
      (u) => u.includes("/meta/artist/"),
      () => ({ status: 200, body: { meta: { type: "artist", id: ARTIST, name: "The Artist" } } }),
    );
    await collection.install("https://meta.example/manifest.json");

    const meta = await collection.getMeta("artist", ARTIST);
    expect(meta?.name).toBe("The Artist");
  });

  it("getMeta bounds a hung provider and falls through to a healthy one (A-008)", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get }, { providerTimeoutMs: 20 });
    http.on("https://m1.example/manifest.json", () => ({ status: 200, body: metaManifest("m1") }));
    http.on("https://m2.example/manifest.json", () => ({ status: 200, body: metaManifest("m2") }));
    http.when((u) => u.startsWith("https://m1.example/meta/"), hang); // never answers
    http.when((u) => u.startsWith("https://m2.example/meta/"), () => validMeta);
    await collection.install("https://m1.example/manifest.json");
    await collection.install("https://m2.example/manifest.json");

    await expect(collection.getMeta("artist", ARTIST)).resolves.toMatchObject({ name: "The Artist" });
  });
});

// --- catalog search fan-out (P-4) ---

const catalogManifest = (id: string) =>
  manifest({
    id,
    resources: ["catalog"],
    types: ["track"],
    idPrefixes: ["mbid:recording:"],
    catalogs: [{ type: "track", id: "search", name: "Songs", extra: [{ name: "search", isRequired: true }] }],
  });

/** Install a catalog addon whose /catalog/track/search route returns `body`. */
async function catalogProvider(
  http: FakeHttp,
  collection: AddonCollection,
  host: string,
  id: string,
  route: (url: string, signal?: AbortSignal) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>,
): Promise<void> {
  http.on(`${host}/manifest.json`, () => ({ status: 200, body: catalogManifest(id) }));
  http.when((u) => u.startsWith(`${host}/catalog/track/`), route);
  await collection.install(`${host}/manifest.json`);
}

describe("AddonCollection.search", () => {
  it("merges results across catalog addons and dedupes by id (install order wins)", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    await catalogProvider(http, collection, "https://c1.example", "c1", () => ({
      status: 200,
      body: { metas: [trackPreview(T1, "Song 1 (c1)"), trackPreview(T2, "Song 2 (c1)")] },
    }));
    await catalogProvider(http, collection, "https://c2.example", "c2", () => ({
      status: 200,
      body: { metas: [trackPreview(T2, "Song 2 (c2)"), trackPreview(T3, "Song 3 (c2)")] },
    }));

    const metas = await collection.search("track", "song");
    expect(metas.map((m) => m.id)).toEqual([T1, T2, T3]);
    expect(metas.find((m) => m.id === T2)?.name).toBe("Song 2 (c1)"); // first provider wins the dup
  });

  it("isolates a down catalog provider and returns the healthy one's results", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    await catalogProvider(http, collection, "https://c1.example", "c1", () => ({ status: 503, body: {} }));
    await catalogProvider(http, collection, "https://c2.example", "c2", () => ({
      status: 200,
      body: { metas: [trackPreview(T1, "Song 1")] },
    }));

    await expect(collection.search("track", "song")).resolves.toEqual([expect.objectContaining({ id: T1 })]);
  });

  it("bounds a hung catalog provider (one addon can't stall search)", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get }, { providerTimeoutMs: 20 });
    await catalogProvider(http, collection, "https://c1.example", "c1", hang);
    await catalogProvider(http, collection, "https://c2.example", "c2", () => ({
      status: 200,
      body: { metas: [trackPreview(T1, "Song 1")] },
    }));

    await expect(collection.search("track", "song")).resolves.toEqual([expect.objectContaining({ id: T1 })]);
  });

  it("throws only when every catalog provider is unreachable", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    await catalogProvider(http, collection, "https://c1.example", "c1", () => ({ status: 503, body: {} }));
    await catalogProvider(http, collection, "https://c2.example", "c2", () => ({ status: 500, body: {} }));

    await expect(collection.search("track", "song")).rejects.toBeInstanceOf(AddonUnreachableError);
  });

  it("returns [] when no installed addon has a searchable catalog for the type", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    serve(http, "https://s.example", manifest({ id: "s", resources: ["stream"], types: ["track"] }));
    await collection.install("https://s.example/manifest.json");
    await expect(collection.search("track", "song")).resolves.toEqual([]);
  });
});

// --- a specific catalog by id (artist discography) ---

const ALBUM = "mbid:release:44444444-4444-4444-4444-444444444444";
const ALBUM2 = "mbid:release:55555555-5555-5555-5555-555555555555";
const ARTIST_ID = "mbid:artist:66666666-6666-6666-6666-666666666666";

const albumPreview = (id: string, name: string) => ({ type: "album", id, name });

const discographyManifest = (id: string) =>
  manifest({
    id,
    resources: ["catalog"],
    types: ["album"],
    idPrefixes: ["mbid:release:"],
    catalogs: [
      { type: "album", id: "search", name: "Albums", extra: [{ name: "search", isRequired: true }] },
      { type: "album", id: "byArtist", name: "Discography", extra: [{ name: "artistId", isRequired: true }] },
    ],
  });

describe("AddonCollection.catalogById", () => {
  it("asks only the named catalog, not every catalog of that type", async () => {
    // The distinction that matters: `album` has both a search catalog and a
    // discography one. Reusing search's "any catalog with a `search` extra"
    // selection here would fire an unrelated, argument-less search.
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const asked: string[] = [];
    http.on("https://d1.example/manifest.json", () => ({ status: 200, body: discographyManifest("d1") }));
    http.when(
      (u) => u.startsWith("https://d1.example/catalog/album/"),
      (url) => {
        asked.push(url.replace("https://d1.example/catalog/album/", "").split("/")[0]!);
        return { status: 200, body: { metas: [albumPreview(ALBUM, "First")] } };
      },
    );
    await collection.install("https://d1.example/manifest.json");

    const metas = await collection.catalogById("album", "byArtist", { artistId: ARTIST_ID });
    expect(metas.map((m) => m.id)).toEqual([ALBUM]);
    expect(asked).toEqual(["byArtist"]);
  });

  it("merges and dedupes across addons, like search does", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    for (const [host, id, metas] of [
      ["https://d1.example", "d1", [albumPreview(ALBUM, "First (d1)")]],
      ["https://d2.example", "d2", [albumPreview(ALBUM, "First (d2)"), albumPreview(ALBUM2, "Second")]],
    ] as const) {
      http.on(`${host}/manifest.json`, () => ({ status: 200, body: discographyManifest(id) }));
      http.when((u) => u.startsWith(`${host}/catalog/album/`), () => ({ status: 200, body: { metas } }));
      await collection.install(`${host}/manifest.json`);
    }

    const metas = await collection.catalogById("album", "byArtist", { artistId: ARTIST_ID });
    expect(metas.map((m) => m.id)).toEqual([ALBUM, ALBUM2]);
    expect(metas.find((m) => m.id === ALBUM)?.name).toBe("First (d1)"); // install order wins
  });

  it("returns empty when no installed addon advertises that catalog", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    await catalogProvider(http, collection, "https://c1.example", "c1", () => ({ status: 200, body: { metas: [] } }));

    // c1 has only a track/search catalog — asking for a discography must not
    // fall back to searching it.
    await expect(collection.catalogById("album", "byArtist", { artistId: ARTIST_ID })).resolves.toEqual([]);
  });

  it("isolates a down provider", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    for (const [host, id, res] of [
      ["https://d1.example", "d1", { status: 503, body: {} }],
      ["https://d2.example", "d2", { status: 200, body: { metas: [albumPreview(ALBUM, "First")] } }],
    ] as const) {
      http.on(`${host}/manifest.json`, () => ({ status: 200, body: discographyManifest(id) }));
      http.when((u) => u.startsWith(`${host}/catalog/album/`), () => res);
      await collection.install(`${host}/manifest.json`);
    }

    await expect(collection.catalogById("album", "byArtist", { artistId: ARTIST_ID })).resolves.toEqual([
      expect.objectContaining({ id: ALBUM }),
    ]);
  });
});

describe("AddonCollection.catalogStats", () => {
  const catalogManifest = (id: string): Manifest =>
    manifest({ id, resources: ["catalog"], types: ["artist", "album", "track"], idPrefixes: ["mbid:"] });

  it("sums /stats across catalog addons that report them", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const aUrl = serve(http, "https://a.example", catalogManifest("a"));
    const bUrl = serve(http, "https://b.example", catalogManifest("b"));
    http.on("https://a.example/stats", () => ({ status: 200, body: { artist: 10, album: 20, track: 30, total: 60 } }));
    // b is a catalog addon that doesn't implement /stats (404) → contributes nothing.
    http.on("https://b.example/stats", () => ({ status: 404, body: {} }));
    await collection.install(aUrl);
    await collection.install(bUrl);

    await expect(collection.catalogStats()).resolves.toEqual({ artists: 10, albums: 20, tracks: 30, total: 60 });
  });

  it("returns undefined when no catalog addon reports stats", async () => {
    const http = new FakeHttp();
    const collection = new AddonCollection({ httpGet: http.get });
    const aUrl = serve(http, "https://a.example", manifest({ id: "a", resources: ["stream"] }));
    await collection.install(aUrl);
    await expect(collection.catalogStats()).resolves.toBeUndefined();
  });
});
