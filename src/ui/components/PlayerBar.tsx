/**
 * The persistent player bar (mockup panel 2/6 bottom). It renders engine state
 * and issues commands — it owns no playback logic (§8a). The "Source" readout
 * shows which addon resolved the current stream (§5).
 */
import { useEffect, useState } from "react";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { useServices } from "../../app/providers.js";
import { useIsLiked, useToggleLike } from "../viewmodels/useLibrary.js";
import { Artwork, formatTime } from "./common.js";

export function PlayerBar() {
  const player = usePlayer();
  const toggleQueue = useUi((s) => s.toggleQueue);
  const { audio } = useServices();
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    audio.setVolume(volume);
  }, [audio, volume]);

  const { track, status, isPlaying, positionMs, durationMs } = player;
  const busy = status === "resolving" || status === "buffering";
  const hasTrack = track !== undefined;

  return (
    <div className="player">
      <div className="player-track">
        {hasTrack ? (
          <>
            <Artwork src={track.artwork} alt={track.title} size={44} />
            <div className="player-meta">
              <div className="player-title">{track.title}</div>
              <div className="player-artist">
                {track.artist ?? "Unknown artist"}
                {track.album ? ` · ${track.album}` : ""}
              </div>
            </div>
          </>
        ) : (
          <div className="player-artist">Nothing playing</div>
        )}
      </div>

      <div className="player-center">
        <div className="transport">
          <button
            type="button"
            className={player.shuffle ? "t-btn is-active" : "t-btn"}
            onClick={() => player.setShuffle(!player.shuffle)}
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            disabled={!hasTrack}
          >
            ⤨
          </button>
          <button type="button" className="t-btn" onClick={player.prev} aria-label="Previous" disabled={!hasTrack}>
            ⏮
          </button>
          <button
            type="button"
            className="t-btn t-play"
            onClick={player.toggle}
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={!hasTrack}
          >
            {busy ? "…" : isPlaying ? "⏸" : "▶"}
          </button>
          <button type="button" className="t-btn" onClick={player.next} aria-label="Next" disabled={!hasTrack}>
            ⏭
          </button>
          <button
            type="button"
            className={player.repeat !== "off" ? "t-btn is-active" : "t-btn"}
            onClick={() => player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")}
            aria-label={`Repeat: ${player.repeat}`}
            disabled={!hasTrack}
          >
            {player.repeat === "one" ? "🔂" : "🔁"}
          </button>
        </div>

        <div className="scrubber">
          <span className="time">{formatTime(positionMs)}</span>
          <input
            type="range"
            min={0}
            max={durationMs && durationMs > 0 ? durationMs : 1}
            value={Math.min(positionMs, durationMs ?? positionMs)}
            onChange={(e) => player.seek(Number(e.target.value))}
            disabled={!hasTrack || !durationMs}
            aria-label="Seek"
          />
          <span className="time">{formatTime(durationMs)}</span>
        </div>
      </div>

      <div className="player-right">
        <SourceChip />
        <LikeButton />
        <button type="button" className="t-btn" onClick={toggleQueue} aria-label="Queue">
          ☰
        </button>
        <input
          className="volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}

/** Save the current track to the library (mockup's heart). */
function LikeButton() {
  const { track } = usePlayer();
  const { data: liked } = useIsLiked(track?.recordingId);
  const toggle = useToggleLike();
  if (!track) return null;
  return (
    <button
      type="button"
      className={liked ? "t-btn is-active" : "t-btn"}
      onClick={() => toggle.mutate({ track, liked: liked ?? false })}
      aria-label={liked ? "Remove from library" : "Save to library"}
      aria-pressed={liked ?? false}
    >
      {liked ? "♥" : "♡"}
    </button>
  );
}

/** Which addon/stream the scheduler resolved (§5, §8a table). */
function SourceChip() {
  const { item, status } = usePlayer();
  const resolution = item?.resolution;
  if (status === "resolving") return <div className="source-chip">Finding a source…</div>;
  if (resolution?.status !== "resolved") return <div className="source-chip" />;
  const stream = resolution.streams[resolution.chosenIdx];
  if (!stream) return <div className="source-chip" />;
  return (
    <div className="source-chip" title={stream.name ?? ""}>
      Source: <strong>{stream.name ?? "addon"}</strong>
    </div>
  );
}
