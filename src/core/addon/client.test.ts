import { describe, it, expect, vi } from "vitest";
import { AddonClient } from "./client.js";
import { AddonProtocolError, AddonUnreachableError } from "./http.js";
import { FakeHttp } from "./fake-http.js";
import type { Manifest, StreamRequest } from "@p2p-songs/protocol";

const REC = "mbid:recording:11111111-1111-1111-1111-111111111111";
const RELEASE = "mbid:release:22222222-2222-2222-2222-222222222222";
const ARTIST = "mbid:artist:33333333-3333-3333-3333-333333333333";
const MANIFEST_URL = "https://addon.example/manifest.json";

const streamManifest: Manifest = {
  id: "com.test.stream",
  version: "1.0.0",
  name: "Test Stream",
  description: "",
  resources: ["stream"],
  types: ["track"],
  idPrefixes: ["mbid:recording:", "isrc:"],
  catalogs: [],
};

const STATS_URL = "https://addon.example/stats";

const catalogManifest: Manifest = {
  id: "com.test.catalog",
  version: "1.0.0",
  name: "Test Catalog",
  description: "",
  resources: ["catalog", "meta"],
  types: ["artist", "album", "track"],
  idPrefixes: ["mbid:"],
  catalogs: [],
};

function serveManifest(http: FakeHttp, manifest: Manifest): FakeHttp {
  return http.on(MANIFEST_URL, () => ({ status: 200, body: manifest }));
}

const req: StreamRequest = { recordingId: REC } as StreamRequest;

describe("AddonClient.install", () => {
  it("fetches and validates the manifest", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest);
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    expect(client.id).toBe("com.test.stream");
    expect(client.supports("stream")).toBe(true);
    expect(client.supports("catalog")).toBe(false);
    expect(client.handlesType("track")).toBe(true);
    expect(client.handlesId(REC)).toBe(true);
    expect(client.handlesId(ARTIST)).toBe(false);
  });

  it("throws AddonUnreachableError when the addon is down", async () => {
    const http = new FakeHttp().fail(() => true);
    await expect(AddonClient.install(MANIFEST_URL, { httpGet: http.get })).rejects.toBeInstanceOf(AddonUnreachableError);
  });

  it("throws AddonUnreachableError on a 5xx", async () => {
    const http = new FakeHttp().on(MANIFEST_URL, () => ({ status: 503, body: {} }));
    await expect(AddonClient.install(MANIFEST_URL, { httpGet: http.get })).rejects.toBeInstanceOf(AddonUnreachableError);
  });

  it("throws AddonProtocolError on a malformed manifest", async () => {
    const http = new FakeHttp().on(MANIFEST_URL, () => ({ status: 200, body: { id: "x" } }));
    await expect(AddonClient.install(MANIFEST_URL, { httpGet: http.get })).rejects.toBeInstanceOf(AddonProtocolError);
  });
});

describe("AddonClient.getStreams", () => {
  it("returns validated streams for a recording", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      () => ({ status: 200, body: { streams: [{ url: "https://cdn.test/a.flac", name: "FLAC" }] } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    const { streams } = await client.getStreams(req);
    expect(streams).toHaveLength(1);
    expect(streams[0]!.url).toBe("https://cdn.test/a.flac");
  });

  it("encodes the recording id into the request path", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      () => ({ status: 200, body: { streams: [] } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await client.getStreams(req);
    expect(http.requests.some((u) => u.includes("mbid%3Arecording%3A"))).toBe(true);
  });

  it("treats a 404 as an empty result, not an error", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      () => ({ status: 404, body: { err: "not found" } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getStreams(req)).resolves.toEqual({ streams: [] });
  });

  it("propagates AddonUnreachableError on a 503 (provider down)", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      () => ({ status: 503, body: {} }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getStreams(req)).rejects.toBeInstanceOf(AddonUnreachableError);
  });

  it("throws AddonProtocolError on a malformed stream body", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      // two sources on one stream is invalid per the protocol schema
      () => ({ status: 200, body: { streams: [{ url: "https://x/y", ytId: "abc" }] } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getStreams(req)).rejects.toBeInstanceOf(AddonProtocolError);
  });

  it("reports a benign 4xx to onBadRequest and returns empty (no backoff signal)", async () => {
    const onBadRequest = vi.fn();
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      () => ({ status: 400, body: { err: "bad request" } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get, onBadRequest });
    await expect(client.getStreams(req)).resolves.toEqual({ streams: [] });
    expect(onBadRequest).toHaveBeenCalledWith({ addonId: "com.test.stream", resource: "stream", status: 400 });
  });

  it("sends the album-context ids as <extra>", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest).when(
      (u) => u.includes("/stream/track/"),
      () => ({ status: 200, body: { streams: [] } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await client.getStreams({ recordingId: REC, releaseId: RELEASE } as StreamRequest);
    const streamUrl = http.requests.find((u) => u.includes("/stream/track/"))!;
    const extraSeg = streamUrl.split("/stream/track/")[1]!.split("/")[1]!.replace(/\.json$/, "");
    const params = new URLSearchParams(decodeURIComponent(extraSeg));
    expect(params.get("releaseId")).toBe(RELEASE);
  });
});

describe("AddonClient.getMeta", () => {
  const metaManifest: Manifest = {
    ...streamManifest,
    id: "com.test.meta",
    resources: ["meta"],
    types: ["artist", "album", "track"],
    idPrefixes: ["mbid:"],
  };

  it("returns the validated meta detail", async () => {
    const http = serveManifest(new FakeHttp(), metaManifest).when(
      (u) => u.includes("/meta/artist/"),
      () => ({ status: 200, body: { meta: { type: "artist", id: ARTIST, name: "The Artist" } } }),
    );
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    const meta = await client.getMeta("artist", ARTIST);
    expect(meta?.name).toBe("The Artist");
  });

  it("returns undefined when the addon has no meta (404)", async () => {
    const http = serveManifest(new FakeHttp(), metaManifest);
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getMeta("artist", ARTIST)).resolves.toBeUndefined();
  });
});

describe("AddonClient.getCatalogStats", () => {
  it("returns the mapped counts from /stats (singular keys → plural)", async () => {
    const http = serveManifest(new FakeHttp(), catalogManifest).on(STATS_URL, () => ({
      status: 200,
      body: { artist: 993, album: 144419, track: 756483, total: 901895 },
    }));
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getCatalogStats()).resolves.toEqual({
      artists: 993,
      albums: 144419,
      tracks: 756483,
      total: 901895,
    });
  });

  it("is undefined for a non-catalog addon (never even requests /stats)", async () => {
    const http = serveManifest(new FakeHttp(), streamManifest);
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getCatalogStats()).resolves.toBeUndefined();
    expect(http.requests).not.toContain(STATS_URL);
  });

  it("is undefined (never throws) when /stats is 503, 404, or a malformed body", async () => {
    for (const reply of [
      { status: 503, body: { error: "no index" } },
      { status: 404, body: { err: "not found" } },
      { status: 200, body: { artist: "lots" } }, // wrong type → rejected
      { status: 200, body: { artist: 1 } }, // missing keys → rejected
    ]) {
      const http = serveManifest(new FakeHttp(), catalogManifest).on(STATS_URL, () => reply);
      const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
      await expect(client.getCatalogStats()).resolves.toBeUndefined();
    }
  });

  it("is undefined when the host is unreachable (best-effort, not an outage)", async () => {
    const http = serveManifest(new FakeHttp(), catalogManifest).fail((u) => u === STATS_URL);
    const client = await AddonClient.install(MANIFEST_URL, { httpGet: http.get });
    await expect(client.getCatalogStats()).resolves.toBeUndefined();
  });
});
