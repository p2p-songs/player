/**
 * Saved-library view-models (§6).
 *
 * The library holds **identity, not media** — a saved album is an id and enough
 * to draw a row, never a track listing or a stream. So there is one save path
 * for every kind of thing: a song from the player bar, an album or artist from
 * its detail screen. Reading it back is the same shape too, which is what lets
 * the library screen sort mixed kinds by when they were saved.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import type { LibraryEntry } from "../../core/persistence/schema.js";
import type { TrackRef } from "../../core/queue/types.js";

/** What a screen supplies to save something; the store adds the timestamps. */
export type SavedItem = Omit<LibraryEntry, "savedAt" | "updatedAt">;

/** Everything saved, most-recently-saved first. */
export function useLibrary() {
  const { repository } = useServices();
  return useQuery({
    queryKey: ["library"],
    queryFn: () => repository.listLibrary(),
  });
}

export function useIsSaved(id: string | undefined) {
  const { repository } = useServices();
  return useQuery({
    // A `["library", …]` prefix, so any save/remove invalidates this too.
    queryKey: ["library", "is", id],
    enabled: id !== undefined,
    queryFn: () => repository.isInLibrary(id!),
  });
}

export function useToggleSaved() {
  const { repository } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, saved }: { item: SavedItem; saved: boolean }) => {
      if (saved) {
        await repository.removeFromLibrary(item.id);
      } else {
        await repository.saveToLibrary(item);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
  });
}

export function useRemoveSaved() {
  const { repository } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repository.removeFromLibrary(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
  });
}

export function trackToSaved(track: TrackRef): SavedItem {
  return {
    id: track.recordingId,
    kind: "track",
    name: track.title,
    ...(track.artist ? { artistName: track.artist } : {}),
    ...(track.artwork ? { poster: track.artwork } : {}),
  };
}

/** A saved song → the queue's `TrackRef`, so a library row can be played. */
export function savedToTrack(entry: LibraryEntry): TrackRef {
  return {
    recordingId: entry.id as TrackRef["recordingId"],
    title: entry.name,
    ...(entry.artistName ? { artist: entry.artistName } : {}),
    ...(entry.poster ? { artwork: entry.poster } : {}),
  };
}
