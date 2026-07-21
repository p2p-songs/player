/** Album detail (mockup panel 4): cover, Play/Shuffle, and the track listing. */
import { useMeta, albumToTracks } from "../viewmodels/useCatalog.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { Artwork, Loading, StateBlock, formatTime } from "../components/common.js";

export function AlbumScreen({ albumId, onBack }: { albumId: string; onBack: () => void }) {
  const meta = useMeta("album", albumId);
  const { playTracks, setShuffle } = usePlayer();
  const tracks = albumToTracks(meta.data);
  const totalMs = tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  return (
    <div className="main-inner">
      <button type="button" className="btn btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>
        ‹ Back
      </button>

      {meta.isLoading ? (
        <Loading label="Loading album…" />
      ) : meta.isError || !meta.data ? (
        <StateBlock
          icon="⚠"
          title="Couldn't load this album"
          message="No installed addon could provide its details."
          action={
            <button type="button" className="btn btn-sm" onClick={() => meta.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <>
          <div className="inline" style={{ alignItems: "flex-end", gap: 20, marginBottom: 22 }}>
            <Artwork src={meta.data.poster} alt={meta.data.name} size={168} />
            <div className="stack" style={{ gap: 6 }}>
              <h1 className="page-title" style={{ margin: 0 }}>
                {meta.data.name}
              </h1>
              <div className="muted">
                {meta.data.artistName ?? "Unknown artist"}
                {meta.data.releaseDate ? ` · ${meta.data.releaseDate.slice(0, 4)}` : ""}
                {tracks.length ? ` · ${tracks.length} tracks` : ""}
                {totalMs ? ` · ${Math.round(totalMs / 60000)} min` : ""}
              </div>
              <div className="inline" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => playTracks(tracks)}
                  disabled={tracks.length === 0}
                >
                  ▶ Play
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShuffle(true);
                    playTracks(tracks);
                  }}
                  disabled={tracks.length === 0}
                >
                  ⤨ Shuffle
                </button>
              </div>
            </div>
          </div>

          {tracks.length === 0 ? (
            <StateBlock icon="♪" title="No track listing" message="This addon didn't provide tracks for the album." />
          ) : (
            <div className="rows">
              {tracks.map((track, i) => (
                <button
                  key={`${track.recordingId}-${i}`}
                  type="button"
                  className="row"
                  onClick={() => playTracks(tracks.slice(i))}
                >
                  <span className="row-index">{i + 1}</span>
                  <span className="row-main">
                    <span className="row-title">{track.title}</span>
                    <span className="row-sub">{track.artist ?? meta.data?.artistName ?? ""}</span>
                  </span>
                  <span className="row-time">{formatTime(track.durationMs)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
