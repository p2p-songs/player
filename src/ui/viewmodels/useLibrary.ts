/** Saved-library view-models (§6): like/unlike the current track. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import type { TrackRef } from "../../core/queue/types.js";

export function useIsLiked(id: string | undefined) {
  const { repository } = useServices();
  return useQuery({
    queryKey: ["library", "is", id],
    enabled: id !== undefined,
    queryFn: () => repository.isInLibrary(id!),
  });
}

export function useToggleLike() {
  const { repository } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ track, liked }: { track: TrackRef; liked: boolean }) => {
      if (liked) {
        await repository.removeFromLibrary(track.recordingId);
      } else {
        await repository.saveToLibrary({
          id: track.recordingId,
          kind: "track",
          name: track.title,
          ...(track.artist ? { artistName: track.artist } : {}),
          ...(track.artwork ? { poster: track.artwork } : {}),
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
  });
}
