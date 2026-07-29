/**
 * The default metadata addon must seed *once* and respect a removal — the two
 * failure modes that would make it feel broken are it re-appearing after the
 * user deletes it, and it never showing up at all. Both are asserted here
 * against a fake HTTP transport and the in-memory store, no network.
 *
 * (Neutrality is unaffected: this is a metadata addon installed through the
 * ordinary `install(manifestUrl)` path — the stream plane bundles nothing.)
 */
import { describe, it, expect } from "vitest";
import type { Manifest } from "@p2p-songs/protocol";
import { AddonCollection } from "../core/addon/index.js";
import { FakeHttp } from "../core/addon/fake-http.js";
import { MemoryStore, PlayerRepository } from "../core/persistence/index.js";
import {
  DEFAULTS_SEED_KEY,
  STREAM_DEFAULTS_SEED_KEY,
  seedDefaultMetadataAddon,
  seedDefaultStreamAddon,
} from "./default-addons.js";

const URL = "https://musicmeta.example/manifest.json";
const META_MANIFEST: Manifest = {
  id: "com.p2p-songs.musicmeta",
  version: "0.1.0",
  name: "MusicMeta",
  description: "",
  resources: ["catalog", "meta"],
  types: ["artist", "album", "track"],
  catalogs: [],
} as Manifest;

function wire(opts: { reachable: boolean }) {
  const http = new FakeHttp();
  if (opts.reachable) http.on(URL, () => ({ status: 200, body: META_MANIFEST }));
  else http.fail((u) => u === URL);
  const collection = new AddonCollection({ httpGet: http.get });
  const repository = new PlayerRepository(new MemoryStore());
  return { collection, repository };
}

describe("seedDefaultMetadataAddon", () => {
  it("installs the default on first boot and persists it", async () => {
    const { collection, repository } = wire({ reachable: true });

    await seedDefaultMetadataAddon(collection, repository, { url: URL });

    expect(collection.list().map((c) => c.id)).toContain("com.p2p-songs.musicmeta");
    const saved = await repository.listAddons();
    expect(saved.map((r) => r.manifestUrl)).toEqual([URL]);
    expect(await repository.getSetting(DEFAULTS_SEED_KEY, 0)).toBe(1);
  });

  it("does not re-add the default once seeded (idempotent across boots)", async () => {
    const { collection, repository } = wire({ reachable: true });

    await seedDefaultMetadataAddon(collection, repository, { url: URL });
    await seedDefaultMetadataAddon(collection, repository, { url: URL });

    expect((await repository.listAddons()).length).toBe(1);
  });

  it("respects a removal — a seeded-then-removed default never comes back", async () => {
    const { collection, repository } = wire({ reachable: true });
    await seedDefaultMetadataAddon(collection, repository, { url: URL });

    // User removes it.
    collection.remove("com.p2p-songs.musicmeta");
    await repository.removeAddon("com.p2p-songs.musicmeta");

    // A later boot must not resurrect it.
    await seedDefaultMetadataAddon(collection, repository, { url: URL });

    expect(collection.list()).toHaveLength(0);
    expect(await repository.listAddons()).toHaveLength(0);
  });

  it("retries next boot when the default is unreachable (marker left unset)", async () => {
    // Boot 1: addon down → nothing seeded, marker unset.
    const down = wire({ reachable: false });
    await seedDefaultMetadataAddon(down.collection, down.repository, { url: URL });
    expect(await down.repository.getSetting(DEFAULTS_SEED_KEY, 0)).toBe(0);
    expect(await down.repository.listAddons()).toHaveLength(0);

    // Boot 2 on the same store, addon now up → it lands.
    const http = new FakeHttp().on(URL, () => ({ status: 200, body: META_MANIFEST }));
    const collection = new AddonCollection({ httpGet: http.get });
    await seedDefaultMetadataAddon(collection, down.repository, { url: URL });
    expect(await down.repository.getSetting(DEFAULTS_SEED_KEY, 0)).toBe(1);
    expect(await down.repository.listAddons()).toHaveLength(1);
  });

  it("re-seeds when the default's version is bumped", async () => {
    const { collection, repository } = wire({ reachable: true });
    await seedDefaultMetadataAddon(collection, repository, { url: URL, version: 1 });
    collection.remove("com.p2p-songs.musicmeta");
    await repository.removeAddon("com.p2p-songs.musicmeta");

    // A brand-new default identity (version 2) is allowed back in.
    await seedDefaultMetadataAddon(collection, repository, { url: URL, version: 2 });
    expect(await repository.listAddons()).toHaveLength(1);
  });
});

/**
 * The stream default is the self-host operator override (§11). It must behave
 * exactly like the metadata default — seed once, respect removal — but track its
 * own marker so the two never interfere, and (because its URL is
 * credential-bearing) be stored as a `configured` addon so the UI redacts it.
 */
describe("seedDefaultStreamAddon", () => {
  // A configured install URL: a base64url config segment before /manifest.json,
  // which is what `isConfiguredUrl` keys on (§6a).
  const STREAM_URL = "https://bitbop.example/eyJkZWJyaWQiOnt9fQ/manifest.json";
  const STREAM_MANIFEST: Manifest = {
    id: "com.p2p-songs.bitbop",
    version: "0.1.0",
    name: "Bitbop",
    description: "",
    resources: ["stream"],
    types: ["track"],
    catalogs: [],
  } as Manifest;

  function wireStream() {
    const http = new FakeHttp().on(STREAM_URL, () => ({ status: 200, body: STREAM_MANIFEST }));
    const collection = new AddonCollection({ httpGet: http.get });
    const repository = new PlayerRepository(new MemoryStore());
    return { collection, repository };
  }

  it("seeds the stream default and stores it as a configured (redacted) addon", async () => {
    const { collection, repository } = wireStream();

    await seedDefaultStreamAddon(collection, repository, { url: STREAM_URL });

    expect(collection.list().map((c) => c.id)).toContain("com.p2p-songs.bitbop");
    const saved = await repository.listAddons();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.configured).toBe(true); // credential-bearing URL → redacted in the UI (§6a)
    expect(await repository.getSetting(STREAM_DEFAULTS_SEED_KEY, 0)).toBe(1);
  });

  it("respects a removal — a seeded-then-removed stream default never comes back", async () => {
    const { collection, repository } = wireStream();
    await seedDefaultStreamAddon(collection, repository, { url: STREAM_URL });

    collection.remove("com.p2p-songs.bitbop");
    await repository.removeAddon("com.p2p-songs.bitbop");

    await seedDefaultStreamAddon(collection, repository, { url: STREAM_URL });
    expect(collection.list()).toHaveLength(0);
    expect(await repository.listAddons()).toHaveLength(0);
  });

  it("tracks a separate marker from the metadata default (removing one leaves the other)", async () => {
    const http = new FakeHttp()
      .on(URL, () => ({ status: 200, body: META_MANIFEST }))
      .on(STREAM_URL, () => ({ status: 200, body: STREAM_MANIFEST }));
    const collection = new AddonCollection({ httpGet: http.get });
    const repository = new PlayerRepository(new MemoryStore());

    await seedDefaultMetadataAddon(collection, repository, { url: URL });
    await seedDefaultStreamAddon(collection, repository, { url: STREAM_URL });
    expect(await repository.listAddons()).toHaveLength(2);

    // Remove only the stream default; the metadata one is untouched and does not
    // re-seed the stream one on the next boot.
    collection.remove("com.p2p-songs.bitbop");
    await repository.removeAddon("com.p2p-songs.bitbop");
    await seedDefaultMetadataAddon(collection, repository, { url: URL });
    await seedDefaultStreamAddon(collection, repository, { url: STREAM_URL });

    const ids = (await repository.listAddons()).map((r) => r.id);
    expect(ids).toEqual(["com.p2p-songs.musicmeta"]);
  });
});
