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

/** Cross-addon search, merged and deduped by the collection. */
export function useSearch(type: ContentType, query: string, enabled: boolean) {
  const { collection } = useServices();
  return useQuery({
    queryKey: ["search", type, query],
    enabled: enabled && query.trim().length > 0,
    queryFn: ({ signal }) => collection.search(type, query.trim(), signal),
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
