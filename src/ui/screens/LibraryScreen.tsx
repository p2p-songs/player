/**
 * Library (mockup panel 5), minimal: liked songs from the durable library store.
 * Playlists exist in the repository and land here when playlist UI is built.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { Artwork, Loading, StateBlock } from "../components/common.js";
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
    <div className="main-inner">
      <h1 className="page-title">Library</h1>
      <h2 className="section-title">Liked songs</h2>
      {liked.isLoading ? (
        <Loading />
      ) : entries.length === 0 ? (
        <StateBlock icon="♡" title="No liked songs yet" message="Tap the heart on a playing song to save it here." />
      ) : (
        <div className="rows">
          {entries.map((entry) => (
            <div key={entry.id} className="row" style={{ cursor: "default" }}>
              <Artwork src={entry.poster} alt={entry.name} size={38} />
              <button
                type="button"
                className="row-main"
                style={{ border: 0, background: "transparent", textAlign: "left", padding: 0 }}
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
                <span className="row-title">{entry.name}</span>
                <span className="row-sub">{entry.artistName ?? "Unknown artist"}</span>
              </button>
              <button type="button" className="btn btn-sm" onClick={() => unlike.mutate(entry.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
