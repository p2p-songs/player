import { describe, it, expect } from "vitest";
import { AddonClient } from "./client.js";
import { AddonStreamResolver } from "./stream-resolver.js";
import { FakeHttp, abortError, type FakeHandler } from "./fake-http.js";
import type { Manifest } from "@p2p-songs/protocol";
import type { TrackRef } from "../queue/types.js";

const REC = "mbid:recording:11111111-1111-1111-1111-111111111111";
const track: TrackRef = { recordingId: REC as TrackRef["recordingId"], title: "Song" };

function streamManifest(id: string): Manifest {
  return {
    id,
    version: "1.0.0",
    name: id,
    description: "",
    resources: ["stream"],
    types: ["track"],
    idPrefixes: ["mbid:recording:"],
    catalogs: [],
  };
}

/** Install a stream addon on its own host, scripting its /stream route. */
async function installStreamAddon(
  http: FakeHttp,
  id: string,
  host: string,
  streamRoute: FakeHandler,
): Promise<AddonClient> {
  const manifestUrl = `${host}/manifest.json`;
  http.on(manifestUrl, () => ({ status: 200, body: streamManifest(id) }));
  http.when((u) => u.startsWith(`${host}/stream/track/`), streamRoute);
  return AddonClient.install(manifestUrl, { httpGet: http.get });
}

const okStream = (url: string): FakeHandler => () => ({ status: 200, body: { streams: [{ url, name: url }] } });
const empty: FakeHandler = () => ({ status: 200, body: { streams: [] } });
const down: FakeHandler = () => ({ status: 503, body: {} });
/** Accepts the connection then never answers — only rejects when its signal aborts (the deadline). */
const hang: FakeHandler = (_url, signal) =>
  new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(abortError());
    else signal?.addEventListener("abort", () => reject(abortError()), { once: true });
  });

function newSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("AddonStreamResolver", () => {
  it("merges streams from all providers in provider order", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", okStream("https://a.cdn/x.flac"));
    const b = await installStreamAddon(http, "b", "https://b.example", okStream("https://b.cdn/y.flac"));
    const resolver = new AddonStreamResolver({ providers: () => [a, b] });

    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.streams.map((s) => s.url)).toEqual(["https://a.cdn/x.flac", "https://b.cdn/y.flac"]);
  });

  it("keeps only playable (url-bearing) streams", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", () => ({
      status: 200,
      body: { streams: [{ ytId: "abc", name: "yt" }, { url: "https://a.cdn/x.flac", name: "flac" }] },
    }));
    const resolver = new AddonStreamResolver({ providers: () => [a] });

    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.streams.map((s) => s.url)).toEqual(["https://a.cdn/x.flac"]);
  });

  it("returns 'no playable stream found' when reachable addons have no match", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", empty);
    const resolver = new AddonStreamResolver({ providers: () => [a] });

    const out = await resolver.resolve(track, newSignal());
    expect(out).toEqual({ ok: false, reason: "no playable stream found" });
  });

  it("surfaces a provider's `resolving` marker when it has no stream yet", async () => {
    const http = new FakeHttp();
    const resolving: FakeHandler = () => ({ status: 200, body: { streams: [], resolving: { progress: 0.5, message: "Downloading on debrid" } } });
    const a = await installStreamAddon(http, "a", "https://a.example", resolving);
    const resolver = new AddonStreamResolver({ providers: () => [a] });

    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(false);
    if (!out.ok && "resolving" in out) expect(out.resolving).toMatchObject({ progress: 0.5 });
    else throw new Error("expected a resolving outcome");
  });

  it("prefers a ready stream over a provider that is still resolving", async () => {
    const http = new FakeHttp();
    const resolving: FakeHandler = () => ({ status: 200, body: { streams: [], resolving: { progress: 0.2 } } });
    const a = await installStreamAddon(http, "a", "https://a.example", resolving);
    const b = await installStreamAddon(http, "b", "https://b.example", okStream("https://b.cdn/y.flac"));
    const resolver = new AddonStreamResolver({ providers: () => [a, b] });

    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.streams.map((s) => s.url)).toEqual(["https://b.cdn/y.flac"]);
  });

  it("returns 'no stream addon for this track' when no provider handles the id", async () => {
    const http = new FakeHttp();
    // idPrefixes is mbid:recording:; an isrc id is not handled
    const a = await installStreamAddon(http, "a", "https://a.example", empty);
    const resolver = new AddonStreamResolver({ providers: () => [a] });

    const isrcTrack: TrackRef = { recordingId: "isrc:USUM71703861" as TrackRef["recordingId"], title: "x" };
    const out = await resolver.resolve(isrcTrack, newSignal());
    expect(out).toEqual({ ok: false, reason: "no stream addon for this track" });
  });

  it("succeeds from a healthy addon while backing off a down one", async () => {
    const http = new FakeHttp();
    let t = 0;
    const a = await installStreamAddon(http, "a", "https://a.example", down);
    const b = await installStreamAddon(http, "b", "https://b.example", okStream("https://b.cdn/y.flac"));
    const resolver = new AddonStreamResolver({ providers: () => [a, b], baseMs: 1000, now: () => t });

    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.streams.map((s) => s.url)).toEqual(["https://b.cdn/y.flac"]);
    expect(resolver.backoffRemainingMs("a")).toBe(1000);
    expect(resolver.backoffRemainingMs("b")).toBe(0);
  });

  it("skips a backed-off provider on the next resolve (no re-hit)", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", down);
    const resolver = new AddonStreamResolver({ providers: () => [a], baseMs: 1000, now: () => 0 });

    const first = await resolver.resolve(track, newSignal());
    expect(first).toEqual({ ok: false, reason: "stream addons unavailable" });
    const requestsAfterFirst = http.requests.length;

    // Still inside the backoff window: the addon is skipped, not re-hit.
    const second = await resolver.resolve(track, newSignal());
    expect(second).toEqual({ ok: false, reason: "stream addons backing off" });
    expect(http.requests.length).toBe(requestsAfterFirst); // no new /stream request
  });

  it("clears backoff after a later reachable response", async () => {
    const http = new FakeHttp();
    let t = 0;
    let mode: FakeHandler = down;
    const a = await installStreamAddon(http, "a", "https://a.example", (u, s) => mode(u, s));
    const resolver = new AddonStreamResolver({ providers: () => [a], baseMs: 1000, now: () => t });

    await resolver.resolve(track, newSignal()); // fails → backoff 1000
    expect(resolver.backoffRemainingMs("a")).toBe(1000);

    t = 1000; // window elapsed → eligible again
    mode = okStream("https://a.cdn/x.flac");
    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(true);
    expect(resolver.backoffRemainingMs("a")).toBe(0); // reachable cleared it
  });

  // --- bounded fan-out: one hung provider must not wedge the resolve (audit A-008) ---

  it("returns a healthy provider's stream while a hung provider times out and is backed off", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", hang);
    const b = await installStreamAddon(http, "b", "https://b.example", okStream("https://b.cdn/y.flac"));
    const resolver = new AddonStreamResolver({ providers: () => [a, b], providerTimeoutMs: 20, baseMs: 1000, now: () => 0 });

    const out = await resolver.resolve(track, newSignal());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.streams.map((s) => s.url)).toEqual(["https://b.cdn/y.flac"]);
    expect(resolver.backoffRemainingMs("a")).toBe(1000); // hung → classified down → backed off
    expect(resolver.backoffRemainingMs("b")).toBe(0);
  });

  it("bounds an all-hung fan-out and backs every provider off", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", hang);
    const b = await installStreamAddon(http, "b", "https://b.example", hang);
    const resolver = new AddonStreamResolver({ providers: () => [a, b], providerTimeoutMs: 20, baseMs: 1000, now: () => 0 });

    const out = await resolver.resolve(track, newSignal());
    expect(out).toEqual({ ok: false, reason: "stream addons unavailable" });
    expect(resolver.backoffRemainingMs("a")).toBe(1000);
    expect(resolver.backoffRemainingMs("b")).toBe(1000);
  });

  it("a skip during a hang is a cancellation, not a provider fault", async () => {
    const http = new FakeHttp();
    const a = await installStreamAddon(http, "a", "https://a.example", hang);
    // Long provider deadline; the outer signal aborts first.
    const resolver = new AddonStreamResolver({ providers: () => [a], providerTimeoutMs: 1000, now: () => 0 });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const out = await resolver.resolve(track, controller.signal);
    expect(out).toEqual({ ok: false, reason: "cancelled" });
    expect(resolver.backoffRemainingMs("a")).toBe(0); // user skipped — the addon didn't fail
  });

  it("reports a cancellation without mutating provider health", async () => {
    const http = new FakeHttp();
    const controller = new AbortController();
    const a = await installStreamAddon(http, "a", "https://a.example", () => {
      controller.abort(); // abort mid-flight, then answer
      return { status: 200, body: { streams: [{ url: "https://a.cdn/x.flac", name: "x" }] } };
    });
    const resolver = new AddonStreamResolver({ providers: () => [a], now: () => 0 });

    const out = await resolver.resolve(track, controller.signal);
    expect(out).toEqual({ ok: false, reason: "cancelled" });
    expect(resolver.backoffRemainingMs("a")).toBe(0);
  });
});
