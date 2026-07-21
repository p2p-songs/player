import { describe, it, expect } from "vitest";
import { AddonCollection } from "./collection.js";
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
