/**
 * The Dexie adapter against a real IndexedDB implementation (`fake-indexeddb`),
 * so the browser store is proven headlessly — including that the persistence
 * *rules* still hold through IndexedDB's structured-clone boundary, and that
 * state actually survives a fresh connection (the "reload" case).
 */
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import Dexie from "dexie";
import { DexieStore } from "./dexie-store.js";
import { PlayerRepository } from "./repository.js";
import type { Queue, TrackRef } from "../queue/types.js";

const REC = "mbid:recording:11111111-1111-1111-1111-111111111111";
const track = (title = "Song"): TrackRef => ({ recordingId: REC as TrackRef["recordingId"], title });

let dbNames: string[] = [];
/** A store on a fresh, uniquely-named database. */
function freshStore(name = `test-${Math.random().toString(36).slice(2)}`) {
  dbNames.push(name);
  return { store: new DexieStore(name), name };
}

afterEach(async () => {
  for (const n of dbNames) await Dexie.delete(n);
  dbNames = [];
});

describe("DexieStore (IndexedDB)", () => {
  it("satisfies the PersistenceStore port: put/get/getAll/delete/clear", async () => {
    const { store } = freshStore();
    await store.put("library", "a", { v: 1 });
    await store.put("library", "b", { v: 2 });
    expect(await store.get("library", "a")).toEqual({ v: 1 });
    expect((await store.getAll<{ v: number }>("library")).map((x) => x.v).sort()).toEqual([1, 2]);
    await store.delete("library", "a");
    expect(await store.get("library", "a")).toBeUndefined();
    await store.clear("library");
    expect(await store.getAll("library")).toEqual([]);
    store.close();
  });

  it("returns undefined for a missing key", async () => {
    const { store } = freshStore();
    expect(await store.get("settings", "nope")).toBeUndefined();
    store.close();
  });

  it("persists across a new connection (survives a reload)", async () => {
    const { store, name } = freshStore();
    const repo = new PlayerRepository(store, { now: () => 1, newId: () => "pl1" });
    await repo.saveToLibrary({ id: "alb", kind: "album", name: "Album" });
    await repo.saveAddon({ id: "meta", manifestUrl: "https://meta.example/manifest.json", name: "Meta" });
    store.close();

    // Re-open the same database, as a page reload would.
    const reopened = new DexieStore(name);
    const repo2 = new PlayerRepository(reopened, { now: () => 2, newId: () => "pl2" });
    expect((await repo2.listLibrary()).map((e) => e.id)).toEqual(["alb"]);
    expect((await repo2.listAddons()).map((a) => a.id)).toEqual(["meta"]);
    reopened.close();
  });

  it("update() is atomic across concurrent callers (A-009)", async () => {
    const { store } = freshStore();
    await store.put("library", "counter", { n: 0 });
    // Ten overlapping increments; a get-then-put would lose most of them.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        store.update<{ n: number }>("library", "counter", (cur) => ({ n: (cur?.n ?? 0) + 1 })),
      ),
    );
    expect(await store.get("library", "counter")).toEqual({ n: 10 });
    store.close();
  });

  it("does not lose either edit when two playlist adds overlap", async () => {
    const { store } = freshStore();
    const repo = new PlayerRepository(store, { now: () => 1, newId: () => "pl1" });
    const pl = await repo.createPlaylist("Favs");
    await Promise.all([repo.addToPlaylist(pl.id, track("A")), repo.addToPlaylist(pl.id, track("B"))]);
    const titles = (await repo.getPlaylist(pl.id))!.tracks.map((t) => t.title).sort();
    expect(titles).toEqual(["A", "B"]);
    store.close();
  });

  it("persists play history (the v2 table)", async () => {
    const { store } = freshStore();
    let t = 0;
    const repo = new PlayerRepository(store, { now: () => ++t, newId: (() => { let n = 0; return () => `h${++n}`; })() });
    await repo.recordPlay(track("First"));
    await repo.recordPlay(track("Second"));
    expect((await repo.listRecentPlays()).map((e) => e.track.title)).toEqual(["Second", "First"]);
    store.close();
  });

  it("upgrades a v1 database to v2 without losing data", async () => {
    const name = `upgrade-${Math.random().toString(36).slice(2)}`;
    dbNames.push(name);
    // A database as v1 shipped it: five tables, no `history`.
    const v1 = new Dexie(name);
    v1.version(1).stores({ library: "key", playlists: "key", addons: "key", settings: "key", queue: "key" });
    await v1.open();
    await v1.table("library").put({ key: "alb", value: { id: "alb", kind: "album", name: "Kept", savedAt: 1, updatedAt: 1 } });
    v1.close();

    // Re-opening through the current adapter must migrate, not wipe.
    const store = new DexieStore(name);
    const repo = new PlayerRepository(store);
    expect((await repo.listLibrary()).map((e) => e.id)).toEqual(["alb"]);
    await repo.recordPlay(track("Post-upgrade")); // the new table is usable
    expect(await repo.listRecentPlays()).toHaveLength(1);
    store.close();
  });

  it("keeps the queue-identity rule through IndexedDB: no resolution, hydrates to idle", async () => {
    const { store, name } = freshStore();
    const repo = new PlayerRepository(store, { now: () => 1, newId: () => "x" });
    const queue: Queue = {
      itemsById: {
        q1: {
          id: "q1",
          track: track("One"),
          resolution: {
            status: "resolved",
            streams: [{ url: "https://debrid.example/secret-bearer" }],
            chosenIdx: 0,
            url: "https://debrid.example/secret-bearer",
          },
        },
      },
      canonicalOrder: ["q1"],
      playOrder: ["q1"],
      currentItemId: "q1",
      repeat: "off",
      shuffle: false,
    };
    await repo.saveQueue(queue);

    // What actually landed in IndexedDB carries no bearer URL and no resolution.
    const raw = JSON.stringify(await store.get("queue", "current"));
    expect(raw).not.toContain("secret-bearer");
    expect(raw).not.toContain("resolution");
    store.close();

    // And a reload rehydrates it idle, so the scheduler re-resolves fresh.
    const reopened = new DexieStore(name);
    const loaded = (await new PlayerRepository(reopened).loadQueue())!;
    expect(loaded.currentItemId).toBe("q1");
    expect(loaded.itemsById.q1!.resolution).toEqual({ status: "idle" });
    expect(loaded.itemsById.q1!.track.title).toBe("One");
    reopened.close();
  });
});
