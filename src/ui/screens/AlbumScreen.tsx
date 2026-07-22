/** Album detail: cover, Play/Shuffle, and the track listing. */
import { useMeta, albumToTracks } from "../viewmodels/useCatalog.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useIsSaved, useToggleSaved } from "../viewmodels/useLibrary.js";
import { Artwork, formatTime } from "../components/common.js";
import { Loading, Muted, PageTitle, Row, RowIndex, RowMain, RowTime, Rows, StateBlock } from "../components/primitives.js";
import { Button } from "@/components/ui/button";

export function AlbumScreen({ albumId, onBack }: { albumId: string; onBack: () => void }) {
  const meta = useMeta("album", albumId);
  const { playTracks, setShuffle } = usePlayer();
  const { data: saved } = useIsSaved(albumId);
  const toggleSaved = useToggleSaved();
  const tracks = albumToTracks(meta.data);
  const totalMs = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  return (
    <div className="max-w-5xl p-8 pb-12">
      <Button size="sm" variant="outline" onClick={onBack} className="mb-5">
        ‹ Back
      </Button>

      {meta.isLoading ? (
        <Loading label="Loading album…" />
      ) : meta.isError || !meta.data ? (
        <StateBlock
          icon="⚠"
          title="Couldn't load this album"
          message="No installed addon could provide its details."
          action={
            <Button size="sm" onClick={() => meta.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-6 flex items-end gap-5">
            <Artwork src={meta.data.poster} alt={meta.data.name} seed={meta.data.id} size={168} />
            <div className="flex flex-col gap-1.5">
              <PageTitle>{meta.data.name}</PageTitle>
              <Muted>
                {meta.data.artistName ?? "Unknown artist"}
                {meta.data.releaseDate ? ` · ${meta.data.releaseDate.slice(0, 4)}` : ""}
                {tracks.length ? ` · ${tracks.length} tracks` : ""}
                {totalMs ? ` · ${Math.round(totalMs / 60000)} min` : ""}
              </Muted>
              <div className="mt-2 flex gap-2">
                <Button onClick={() => playTracks(tracks)} disabled={tracks.length === 0}>
                  ▶ Play
                </Button>
                <Button
                  variant="outline"
                  disabled={tracks.length === 0}
                  onClick={() => {
                    setShuffle(true);
                    playTracks(tracks);
                  }}
                >
                  ⤨ Shuffle
                </Button>
                <Button
                  variant="outline"
                  aria-pressed={saved ?? false}
                  onClick={() =>
                    toggleSaved.mutate({
                      saved: saved ?? false,
                      item: {
                        id: meta.data!.id,
                        kind: "album",
                        name: meta.data!.name,
                        ...(meta.data!.artistName ? { artistName: meta.data!.artistName } : {}),
                        ...(meta.data!.poster ? { poster: meta.data!.poster } : {}),
                      },
                    })
                  }
                >
                  {saved ? "♥ Saved" : "♡ Save"}
                </Button>
              </div>
            </div>
          </div>

          {tracks.length === 0 ? (
            <StateBlock icon="♪" title="No track listing" message="This addon didn't provide tracks for the album." />
          ) : (
            <Rows>
              {tracks.map((track, i) => (
                <Row key={`${track.recordingId}-${i}`} onClick={() => playTracks(tracks.slice(i))}>
                  <RowIndex>{i + 1}</RowIndex>
                  <RowMain title={track.title} sub={track.artist ?? meta.data?.artistName ?? ""} />
                  <RowTime>{formatTime(track.durationMs)}</RowTime>
                </Row>
              ))}
            </Rows>
          )}
        </>
      )}
    </div>
  );
}
