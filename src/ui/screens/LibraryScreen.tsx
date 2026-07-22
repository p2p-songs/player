/**
 * Library, minimal: liked songs from the durable library store. Playlists exist
 * in the repository and land here when playlist UI is built.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { Artwork } from "../components/common.js";
import { Loading, PageTitle, Row, RowMain, Rows, SectionTitle, StateBlock } from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import type { TrackRef } from "../../core/queue/types.js";

export function LibraryScreen() {
  const { repository } = useServices();
  const { playTracks } = usePlayer();
  const queryClient = useQueryClient();

  const liked = useQuery({
    queryKey: ["library"],
    queryFn: () => repository.listLibrary(),
  });

  const unlike = useMutation({
    mutationFn: (id: string) => repository.removeFromLibrary(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["library"] }),
  });

  const entries = (liked.data ?? []).filter((e) => e.kind === "track");

  return (
    <div className="max-w-5xl p-8 pb-12">
      <PageTitle className="mb-6">Library</PageTitle>
      <SectionTitle>Liked songs</SectionTitle>
      {liked.isLoading ? (
        <Loading />
      ) : entries.length === 0 ? (
        <StateBlock icon="♡" title="No liked songs yet" message="Tap the heart on a playing song to save it here." />
      ) : (
        <Rows>
          {entries.map((entry) => (
            <Row key={entry.id}>
              <Artwork src={entry.poster} alt={entry.name} seed={entry.id} size={38} />
              {/* The row itself isn't clickable here — it carries two actions. */}
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() =>
                  playTracks([
                    {
                      recordingId: entry.id as TrackRef["recordingId"],
                      title: entry.name,
                      ...(entry.artistName ? { artist: entry.artistName } : {}),
                      ...(entry.poster ? { artwork: entry.poster } : {}),
                    },
                  ])
                }
              >
                <RowMain title={entry.name} sub={entry.artistName ?? "Unknown artist"} />
              </button>
              <Button size="xs" variant="outline" onClick={() => unlike.mutate(entry.id)}>
                Remove
              </Button>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
