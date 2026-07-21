import { describe, it, expect } from "vitest";
import { AddonCollection } from "./collection.js";
import { AddonUnreachableError } from "./http.js";
import { FakeHttp } from "./fake-http.js";
import type { Manifest } from "@p2p-songs/protocol";

const ARTIST = "mbid:artist:33333333-3333-3333-3333-333333333333";

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
});
