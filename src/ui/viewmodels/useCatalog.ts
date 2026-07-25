/**
 * Metadata query-plane view-models (§5a/§6). These are ordinary idempotent GETs,
 * so they run under the normal TanStack Query policy — cache, dedup, background
 * revalidation. `/stream` deliberately never comes through here: resolution is a
 * scheduler-owned command inside the engine.
 */
import { useQuery } from "@tanstack/react-query";
import type { ContentType, MetaDetail, MetaPreview } from "@p2p-songs/protocol";
import { useServices } from "../../app/providers.js";
import { AddonUnreachableError } from "../../core/addon/index.js";
import type { TrackRef } from "../../core/queue/types.js";

/** Cross-addon search for one content type, merged and deduped by the collection. */
export function useSearch(type: ContentType, query: string, enabled: boolean) {
  const { collection } = useServices();
  return useQuery({
    queryKey: ["search", type, query],
    enabled: enabled && query.trim().length > 0,
    queryFn: ({ signal }) => collection.search(type, query.trim(), signal),
  });
}

const SEARCH_TYPES = ["artist", "album", "track"] as const;

/** Max merged results to show — the per-type searches return up to 25 each. */
const MERGED_LIMIT = 40;

/**
 * Tie-break order when two hits are *equally* relevant (Meilisearch gives every
 * equally-good match the same score). Artist first: an artist's only searchable
 * text is its name, so it reaches the top score **only when the query is that
 * name** — i.e. an artist query, where the artist is the answer. Below that a
 * search box wants to play, so track beats album (a song title query shouldn't
 * surface the album pressings above the song).
 */
const TYPE_PRIORITY: Record<string, number> = { artist: 0, track: 1, album: 2, playlist: 3 };

/**
 * One search across every content type, merged into a **single relevance-ordered
 * list**.
 *
 * People type "justin bieber baby" — an artist *and* a song — so asking them to
 * pick a category first is asking a question they can't answer, and *sectioning*
 * by type buries the obvious hit (searching a song title pushes the song below
 * every album pressing that shares its name). The protocol is typed per catalog,
 * so the three searches still go out separately, but each hit carries the addon's
 * `rankingScore` (Meilisearch relevance), so we merge them into one list ordered
 * by that score — the single most relevant item first, whatever its type. Equal
 * scores break by {@link TYPE_PRIORITY} (artist, then track, then album). When an
 * addon doesn't report a score everything is 0, so the tie-break alone orders it.
 */
export function useUnifiedSearch(query: string, enabled: boolean) {
  const { collection } = useServices();
  return useQuery<MetaPreview[]>({
    queryKey: ["search", query],
    enabled: enabled && query.trim().length > 0,
    queryFn: async ({ signal }) => {
      const q = query.trim();
      const settled = await Promise.allSettled(SEARCH_TYPES.map((t) => collection.search(t, q, signal)));
      // One type failing is not a failed search — the others still have answers.
      // Only a clean sweep is an outage, and it keeps the "couldn't reach any
      // addon" state meaning what it says.
      const first = settled[0]!;
      if (settled.every((r) => r.status === "rejected")) throw (first as PromiseRejectedResult).reason;
      return mergeByRelevance(settled.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));
    },
  });
}

/** Merge per-type hits into one list by `rankingScore` desc, tie-broken by kind. */
export function mergeByRelevance(items: MetaPreview[]): MetaPreview[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const byScore = (b.item.rankingScore ?? 0) - (a.item.rankingScore ?? 0);
      if (byScore !== 0) return byScore;
      const byKind = (TYPE_PRIORITY[a.item.type] ?? 9) - (TYPE_PRIORITY[b.item.type] ?? 9);
      return byKind !== 0 ? byKind : a.i - b.i; // stable within a kind (keeps addon rank)
    })
    .slice(0, MERGED_LIMIT)
    .map((x) => x.item);
}

/**
 * An artist's discography.
 *
 * Artist search returns only an id and a name, so this is what stops an artist
 * result being a dead end. It reads a *catalog* rather than the artist's `meta`
 * because a discography is a list of items, which is what catalogs are for —
 * and the results are ordinary album previews, so the album screen needs no
 * special case for them.
 */
export function useArtistAlbums(artistId: string | undefined) {
  const { collection } = useServices();
  return useQuery({
    queryKey: ["artist-albums", artistId],
    enabled: artistId !== undefined,
    queryFn: ({ signal }) => collection.catalogById("album", "byArtist", { artistId: artistId! }, signal),
  });
}

/**
 * How much music is searchable, across every catalog addon that reports it — for
 * the "X songs · Y albums · Z artists indexed" awareness line. The catalogue is
 * curated (popular/official), not all of recorded music, so telling the user its
 * size sets the right expectation up front. `undefined` when no addon reports
 * stats; the UI then shows nothing rather than a misleading zero. Counts move
 * only on a nightly reindex, so this is cached long and never refetched on focus.
 */
export function useCatalogStats(enabled: boolean) {
  const { collection } = useServices();
  return useQuery({
    queryKey: ["catalog-stats"],
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: ({ signal }) => collection.catalogStats(signal),
  });
}

/** Full detail for one item (album track listing, artist page, …). */
export function useMeta(type: ContentType, id: string | undefined) {
  const { collection } = useServices();
  return useQuery({
    queryKey: ["meta", type, id],
    enabled: id !== undefined,
    queryFn: ({ signal }) => collection.getMeta(type, id!, signal),
  });
}

/** True when the failure means "no addon could be reached" rather than "no results". */
export function isUnreachable(error: unknown): boolean {
  return error instanceof AddonUnreachableError;
}

/** A track search preview → the queue's `TrackRef`. `description` carries the artist. */
export function previewToTrack(preview: MetaPreview): TrackRef {
  return {
    recordingId: preview.id as TrackRef["recordingId"],
    title: preview.name,
    ...(preview.description ? { artist: preview.description } : {}),
    ...(preview.poster ? { artwork: preview.poster } : {}),
  };
}

/** An album's meta → the ordered `TrackRef[]` to queue. */
export function albumToTracks(meta: MetaDetail | undefined): TrackRef[] {
  if (!meta || meta.type !== "album" || !meta.tracks) return [];
  return meta.tracks.map((t) => ({
    recordingId: t.recordingId,
    ...(t.trackId ? { trackId: t.trackId } : {}),
    releaseId: meta.id,
    title: t.title,
    ...(t.artistName ?? meta.artistName ? { artist: t.artistName ?? meta.artistName } : {}),
    album: meta.name,
    ...(t.durationMs ? { durationMs: t.durationMs } : {}),
    ...(meta.poster ? { artwork: meta.poster } : {}),
  }));
}
