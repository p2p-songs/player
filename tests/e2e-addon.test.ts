/**
 * Live-addon end-to-end integration (ARCHITECTURE §10, P-3 exit criteria).
 *
 * This is the first time the whole system runs for real instead of against
 * fakes: the **real** `stream-legal` and `musicmeta` addons — built with the
 * **real** `@p2p-songs/addon-sdk` router and served over **real HTTP**
 * (`serveHTTP`, actual TCP sockets on loopback) — driven by the real player:
 * `AddonCollection` + `AddonStreamResolver` + `Engine`, talking over the real
 * `fetch` transport.
 *
 * It proves the two things a unit test can't: (1) the player's request-URL
 * *builder* (`endpoints.ts`) round-trips through the SDK router's request
 * *parser* — the one place the wire grammar could silently drift — and
 * (2) resolve→buffer→play works against a genuine addon.
 *
 * Determinism without flakiness: the addons' upstreams (MusicBrainz, Internet
 * Archive, Jamendo) are **injected fixtures**, not live network — the addons are
 * designed for exactly this. So we exercise all the real addon + protocol + HTTP
 * code with controlled data. The addon packages are **test-only** devDeps; the
 * player still bundles/depends on no addon at runtime (neutrality, §11).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serveHTTP, type AddonServer } from "@p2p-songs/addon-sdk";
import {
  createStreamLegalAddon,
  type MetadataLookup,
  type RecordingMeta,
  type LegalSource,
  type Candidate,
  type TrackQuery,
} from "@p2p-songs/stream-legal";
import {
  createMusicMetaAddon,
  type MusicBrainzClient,
  type MbArtist,
  type MbRelease,
  type MbRecording,
  type MbReleaseDetail,
} from "@p2p-songs/musicmeta";
import type { RecordingId } from "@p2p-songs/protocol";
import { Engine } from "../src/core/engine/engine.js";
import { AddonCollection, AddonStreamResolver } from "../src/core/addon/index.js";
import { FakeAudio } from "../src/core/audio/fake.js";
import type { TrackRef } from "../src/core/queue/types.js";

// --- fixtures (bare UUIDs; the addons format them into mbid:<entity>:<uuid>) ---
const REC_UUID = "11111111-1111-1111-1111-111111111111";
const REL_UUID = "22222222-2222-2222-2222-222222222222";
const TRK_UUID = "44444444-4444-4444-4444-444444444444";
const REC_ID = `mbid:recording:${REC_UUID}` as RecordingId;
const REL_ID = `mbid:release:${REL_UUID}`;
const ARTIST = "Test Artist";
const TITLE = "Test Song";
const STREAM_URL = "https://cdn.example/test-song.mp3";

// musicmeta's upstream: a fake MusicBrainz client returning one album+track.
const fakeMb: MusicBrainzClient = {
  async searchArtists(): Promise<MbArtist[]> {
    return [];
  },
  async browseArtistReleases(): Promise<MbRelease[]> {
    return [];
  },
  async searchReleases(): Promise<MbRelease[]> {
    return [];
  },
  async searchRecordings(): Promise<MbRecording[]> {
    return [];
  },
  async getArtist(): Promise<MbArtist | undefined> {
    return undefined;
  },
  async getRelease(uuid): Promise<MbReleaseDetail | undefined> {
    if (uuid !== REL_UUID) return undefined;
    return {
      id: REL_UUID,
      title: "Test Album",
      artist: ARTIST,
      date: "2020-01-01",
      tracks: [{ trackId: TRK_UUID, recordingId: REC_UUID, title: TITLE, disc: 1, position: "1", durationMs: 120000 }],
    };
  },
  async getRecording(uuid): Promise<MbRecording | undefined> {
    if (uuid !== REC_UUID) return undefined;
    return { id: REC_UUID, title: TITLE, artist: ARTIST, durationMs: 120000 };
  },
};

// stream-legal's upstream: a metadata lookup + a fixed CC/PD source.
const fakeLookup: MetadataLookup = {
  async lookup(recordingId): Promise<RecordingMeta | undefined> {
    if (recordingId !== REC_ID) return undefined; // unknown recording → no match
    return { artist: ARTIST, title: TITLE, durationMs: 120000 };
  },
};

const fakeSource: LegalSource = {
  id: "fake-cc",
  name: "Fake CC Catalog",
  async search(query: TrackQuery): Promise<Candidate[]> {
    // Return a well-matching, openly-licensed candidate for our fixture track.
    if (query.title !== TITLE) return [];
    return [
      { source: "fake-cc", title: TITLE, artist: ARTIST, url: STREAM_URL, format: "MP3", durationMs: 120000, license: "Public Domain" },
    ];
  },
};

let meta: AddonServer;
let stream: AddonServer;

beforeAll(async () => {
  meta = await serveHTTP(createMusicMetaAddon({ mb: fakeMb }), { port: 0, log: false });
  stream = await serveHTTP(createStreamLegalAddon({ metadata: fakeLookup, sources: [fakeSource] }), { port: 0, log: false });
});

afterAll(async () => {
  await Promise.all([meta?.close(), stream?.close()]);
});

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("addon client e2e (real addons over HTTP)", () => {
  it("metadata plane: fetches album meta with its track listing", async () => {
    const collection = new AddonCollection();
    await collection.install(meta.url);

    const album = await collection.getMeta("album", REL_ID);
    expect(album?.type).toBe("album");
    expect(album?.name).toBe("Test Album");
    // The listing carries the streamable recording id — what the queue is built from.
    const tracks = album && album.type === "album" ? album.tracks : undefined;
    expect(tracks?.[0]?.recordingId).toBe(REC_ID);
    expect(tracks?.[0]?.title).toBe(TITLE);
  });

  it("command plane: resolves a stream over HTTP and plays it end-to-end", async () => {
    const collection = new AddonCollection();
    await collection.install(stream.url);

    const resolver = new AddonStreamResolver({ providers: () => collection.streamProviders() });
    const audio = new FakeAudio();
    const engine = new Engine(resolver, audio);

    const track: TrackRef = { recordingId: REC_ID, title: TITLE, artist: ARTIST, releaseId: REL_ID as TrackRef["releaseId"] };
    engine.setQueue([track]);
    engine.play();

    // Resolution runs over real HTTP → the engine loads the resolved URL into audio.
    await waitFor(() => audio.current !== undefined);
    expect(audio.current?.url).toBe(STREAM_URL);

    // Audio reports the buffer is ready → the FSM reaches "playing".
    audio.emitLoaded();
    expect(engine.getState().playback.status).toBe("playing");
    expect(audio.playing).toBe(true);

    engine.destroy();
  });

  it("command plane: a reachable addon with no match reports no playable stream", async () => {
    const collection = new AddonCollection();
    await collection.install(stream.url);
    const resolver = new AddonStreamResolver({ providers: () => collection.streamProviders() });

    const unknown: TrackRef = {
      recordingId: "mbid:recording:99999999-9999-9999-9999-999999999999" as RecordingId,
      title: "Unknown",
    };
    const out = await resolver.resolve(unknown, new AbortController().signal);
    expect(out).toEqual({ ok: false, reason: "no playable stream found" });
  });
});
