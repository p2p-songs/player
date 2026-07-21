import { describe, it, expect } from "vitest";
import { PlayerRepository } from "./repository.js";
import { MemoryStore } from "./memory-store.js";
import { redactManifestUrl, isConfiguredUrl } from "./schema.js";
import type { Queue, TrackRef } from "../queue/types.js";

const REC = "mbid:recording:11111111-1111-1111-1111-111111111111";
const track = (over: Partial<TrackRef> = {}): TrackRef => ({
  recordingId: REC as TrackRef["recordingId"],
  title: "Song",
  ...over,
});

/** A repo over a fresh MemoryStore with a deterministic clock + id gen. */
function repo() {
  let t = 0;
  let n = 0;
  return new PlayerRepository(new MemoryStore(), { now: () => ++t, newId: () => `id${++n}` });
}

describe("PlayerRepository — library", () => {
  it("saves, lists (newest first), checks membership, and removes", async () => {
    const r = repo();
    await r.saveToLibrary({ id: "a", kind: "album", name: "Album A" });
    await r.saveToLibrary({ id: "b", kind: "artist", name: "Artist B" });
    expect((await r.listLibrary()).map((e) => e.id)).toEqual(["b", "a"]); // b saved later
    expect(await r.isInLibrary("a")).toBe(true);
    expect(await r.isInLibrary("z")).toBe(false);
    await r.removeFromLibrary("a");
    expect(await r.isInLibrary("a")).toBe(false);
  });

  it("preserves savedAt when re-saving the same entry", async () => {
    const r = repo();
    await r.saveToLibrary({ id: "a", kind: "album", name: "A" });
    const first = (await r.listLibrary())[0]!;
    await r.saveToLibrary({ id: "a", kind: "album", name: "A (renamed)" });
    const again = (await r.listLibrary())[0]!;
    expect(again.savedAt).toBe(first.savedAt);
    expect(again.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(again.name).toBe("A (renamed)");
  });
});

describe("PlayerRepository — playlists", () => {
  it("creates, adds/removes tracks, reorders, renames, and deletes", async () => {
    const r = repo();
    const pl = await r.createPlaylist("Favs");
    expect(pl.id).toBe("id1");

    await r.addToPlaylist(pl.id, track({ title: "One" }));
    await r.addToPlaylist(pl.id, track({ title: "Two" }));
    expect((await r.getPlaylist(pl.id))!.tracks.map((t) => t.title)).toEqual(["One", "Two"]);

    await r.removeFromPlaylist(pl.id, 0);
    expect((await r.getPlaylist(pl.id))!.tracks.map((t) => t.title)).toEqual(["Two"]);

    await r.setPlaylistTracks(pl.id, [track({ title: "X" }), track({ title: "Y" })]);
    expect((await r.getPlaylist(pl.id))!.tracks.map((t) => t.title)).toEqual(["X", "Y"]);

    await r.renamePlaylist(pl.id, "Bangers");
    expect((await r.getPlaylist(pl.id))!.name).toBe("Bangers");

    await r.deletePlaylist(pl.id);
    expect(await r.getPlaylist(pl.id)).toBeUndefined();
  });
});

describe("PlayerRepository — installed addons (secret-bearing)", () => {
  it("marks configured URLs, preserves addedAt on update, lists in install order", async () => {
    const r = repo();
    await r.saveAddon({ id: "meta", manifestUrl: "https://meta.example/manifest.json", name: "Meta" });
    await r.saveAddon({ id: "debrid", manifestUrl: "https://debrid.example/eyJrIjoidiJ9/manifest.json", name: "Debrid" });

    const list = await r.listAddons();
    expect(list.map((a) => a.id)).toEqual(["meta", "debrid"]);
    expect(list.find((a) => a.id === "meta")!.configured).toBe(false);
    expect(list.find((a) => a.id === "debrid")!.configured).toBe(true);

    const addedAt = (await r.getAddon("debrid"))!.addedAt;
    await r.saveAddon({ id: "debrid", manifestUrl: "https://debrid.example/bmV3a2V5/manifest.json", name: "Debrid" });
    const updated = (await r.getAddon("debrid"))!;
    expect(updated.addedAt).toBe(addedAt); // stable across a key rotation
    expect(updated.manifestUrl).toContain("bmV3a2V5");

    await r.removeAddon("meta");
    expect(await r.getAddon("meta")).toBeUndefined();
  });
});

describe("PlayerRepository — settings", () => {
  it("returns the fallback until set, then the stored value", async () => {
    const r = repo();
    expect(await r.getSetting("volume", 0.8)).toBe(0.8);
    await r.setSetting("volume", 0.3);
    expect(await r.getSetting("volume", 0.8)).toBe(0.3);
  });
});

describe("PlayerRepository — queue identity (persist identity, not media)", () => {
  const resolvedQueue = (): Queue => ({
    itemsById: {
      q1: {
        id: "q1",
        track: track({ title: "One" }),
        // a resolved item carrying a SECRET bearer URL — must never be persisted
        resolution: { status: "resolved", streams: [{ url: "https://debrid.example/secret-bearer" }], chosenIdx: 0, url: "https://debrid.example/secret-bearer" },
      },
      q2: { id: "q2", track: track({ title: "Two" }), resolution: { status: "resolving" } },
    },
    canonicalOrder: ["q1", "q2"],
    playOrder: ["q1", "q2"],
    currentItemId: "q1",
    repeat: "all",
    shuffle: false,
  });

  it("saves the queue without any resolution and rehydrates every item to idle", async () => {
    const store = new MemoryStore();
    const r = new PlayerRepository(store, { now: () => 1, newId: () => "x" });
    await r.saveQueue(resolvedQueue());

    // The RAW persisted record must contain neither the bearer URL nor a resolution field.
    const persisted = JSON.stringify(await store.get("queue", "current"));
    expect(persisted).not.toContain("secret-bearer");
    expect(persisted).not.toContain("resolution");

    const loaded = (await r.loadQueue())!;
    expect(loaded.currentItemId).toBe("q1");
    expect(loaded.repeat).toBe("all");
    expect(loaded.playOrder).toEqual(["q1", "q2"]);
    expect(loaded.itemsById.q1!.resolution).toEqual({ status: "idle" });
    expect(loaded.itemsById.q2!.resolution).toEqual({ status: "idle" });
    expect(JSON.stringify(loaded)).not.toContain("secret-bearer"); // the bearer URL never survived
  });

  it("clearQueue removes the persisted queue", async () => {
    const r = repo();
    await r.saveQueue(resolvedQueue());
    await r.clearQueue();
    expect(await r.loadQueue()).toBeUndefined();
  });
});

describe("secret URL helpers (§6a)", () => {
  it("redacts the config segment of a configured URL", () => {
    expect(redactManifestUrl("https://debrid.example/eyJrIjoidiJ9/manifest.json")).toBe("https://debrid.example/…/manifest.json");
    expect(redactManifestUrl("https://meta.example/manifest.json")).toBe("https://meta.example/manifest.json");
    expect(redactManifestUrl("not a url")).toBe("«addon url»");
  });

  it("detects whether a URL is configured (credential-bearing)", () => {
    expect(isConfiguredUrl("https://debrid.example/eyJrIjoidiJ9/manifest.json")).toBe(true);
    expect(isConfiguredUrl("https://meta.example/manifest.json")).toBe(false);
  });
});
