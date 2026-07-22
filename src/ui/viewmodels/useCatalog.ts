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

export interface UnifiedResults {
  artists: MetaPreview[];
  albums: MetaPreview[];
  tracks: MetaPreview[];
}

const SEARCH_TYPES = ["artist", "album", "track"] as const;

/**
 * One search across every content type.
 *
 * People type "justin bieber baby" — an artist *and* a song — so asking them to
 * pick a category first is asking them to answer a question they don't have an
 * answer to. The protocol is typed per catalog, so the three searches still go
 * out separately; the merge happens here, and the caller sections the results.
 */
export function useUnifiedSearch(query: string, enabled: boolean) {
  const { collection } = useServices();
  return useQuery<UnifiedResults>({
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
      const [artists, albums, tracks] = settled.map((r) => (r.status === "fulfilled" ? r.value : []));
      return { artists: artists ?? [], albums: albums ?? [], tracks: tracks ?? [] };
    },
  });
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
