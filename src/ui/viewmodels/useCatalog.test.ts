import { describe, it, expect } from "vitest";
import type { MetaPreview } from "@p2p-songs/protocol";
import { mergeByRelevance } from "./useCatalog.js";

// Ids are branded (`string & BRAND<…>`); in a fixture we mint the string and
// assert the shape rather than route it through a parser.
const uuid = (name: string) => `${name.replace(/\W/g, "").padEnd(8, "0").slice(0, 8)}-0000-4000-8000-000000000000`;
const artist = (name: string, rankingScore?: number): MetaPreview =>
  ({
    type: "artist",
    id: `mbid:artist:${uuid(name)}`,
    name,
    ...(rankingScore !== undefined ? { rankingScore } : {}),
  }) as MetaPreview;
const album = (name: string, rankingScore?: number): MetaPreview =>
  ({
    type: "album",
    id: `mbid:release:${uuid(name)}`,
    name,
    ...(rankingScore !== undefined ? { rankingScore } : {}),
  }) as MetaPreview;
const track = (name: string, rankingScore?: number): MetaPreview =>
  ({
    type: "track",
    id: `mbid:recording:${uuid(name)}`,
    name,
    ...(rankingScore !== undefined ? { rankingScore } : {}),
  }) as MetaPreview;

describe("mergeByRelevance", () => {
  it("orders by rankingScore desc, regardless of type", () => {
    // A song query: the song is the most relevant hit and must land first, not
    // below the album pressings that share its name (the bug this fixes).
    const merged = mergeByRelevance([
      album("Teardrops on My Guitar (US album version)", 0.71),
      album("Teardrops on My Guitar", 0.82),
      track("Teardrops on My Guitar", 0.95),
      artist("Taylor Swift", 0.4),
    ]);
    expect(merged.map((m) => `${m.type}:${m.name}`)).toEqual([
      "track:Teardrops on My Guitar",
      "album:Teardrops on My Guitar",
      "album:Teardrops on My Guitar (US album version)",
      "artist:Taylor Swift",
    ]);
  });

  it("keeps an exact artist-name match first when it scores highest", () => {
    const merged = mergeByRelevance([track("Anti-Hero", 0.6), artist("Taylor Swift", 0.99), album("Midnights", 0.5)]);
    expect(merged[0]!.type).toBe("artist");
  });

  it("on an exact score tie, artist wins (an artist tops the score only when named)", () => {
    // "taylor swift": Meili scores the artist and her tracks/albums all 1.0; the
    // artist is the intended answer, so it must lead — not a track.
    const merged = mergeByRelevance([track("Fearless", 1), album("Fearless", 1), artist("Taylor Swift", 1)]);
    expect(merged.map((m) => m.type)).toEqual(["artist", "track", "album"]);
  });

  it("on a tie with no artist, track beats album (song title, not its pressings)", () => {
    // "teardrops on my guitar": song and album share a name and score; the song leads.
    const merged = mergeByRelevance([album("Teardrops on My Guitar", 0.94), track("Teardrops on My Guitar", 0.94)]);
    expect(merged.map((m) => m.type)).toEqual(["track", "album"]);
  });

  it("without scores, falls back to the type tie-break (artist, then track, then album)", () => {
    const merged = mergeByRelevance([album("B"), track("C"), artist("A")]);
    expect(merged.map((m) => m.type)).toEqual(["artist", "track", "album"]);
  });

  it("collapses duplicate recordings of the same song into one row", () => {
    // The screenshot bug: four MusicBrainz recordings of one song (different
    // pressings) all named the same by the same artist render as four identical
    // rows. Keep the highest-ranked one, drop the rest.
    const merged = mergeByRelevance([
      track("you seem pretty sad for a girl so in love", 0.9),
      track("you seem pretty sad for a girl so in love", 0.88),
      track("you seem pretty sad for a girl so in love", 0.85),
      track("the cure", 0.8),
    ]);
    expect(merged.map((m) => m.name)).toEqual(["you seem pretty sad for a girl so in love", "the cure"]);
  });

  it("keeps same-named results of different types (a song and its album)", () => {
    // Dedup keys on type too, so "Fearless" the song and "Fearless" the album
    // both survive — they are genuinely different results.
    const merged = mergeByRelevance([track("Fearless", 0.9), album("Fearless", 0.9)]);
    expect(merged.map((m) => m.type)).toEqual(["track", "album"]);
  });
});
