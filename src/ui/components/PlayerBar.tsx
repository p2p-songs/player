/**
 * The persistent player bar. It renders engine state and issues commands — it
 * owns no playback logic (§8a). The "Source" readout shows which addon resolved
 * the current stream (§5).
 */
import { useEffect, useState, type ReactNode } from "react";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { useServices } from "../../app/providers.js";
import { useIsLiked, useToggleLike } from "../viewmodels/useLibrary.js";
import { Artwork, formatTime } from "./common.js";
import { cn } from "@/lib/utils";

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
    <div className="col-span-2 grid grid-cols-[minmax(180px,1fr)_minmax(320px,2fr)_minmax(180px,1fr)] items-center gap-4 border-t-2 border-border bg-chrome px-4 text-chrome-foreground">
      <div className="flex min-w-0 items-center gap-3">
        {hasTrack ? (
          <>
            <Artwork src={track.artwork} alt={track.title} seed={track.recordingId} size={44} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{track.title}</div>
              <div className="truncate text-xs text-chrome-muted">
                {track.artist ?? "Unknown artist"}
                {track.album ? ` · ${track.album}` : ""}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-chrome-muted">Nothing playing</div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-3.5">
          <TransportButton
            label="Shuffle"
            active={player.shuffle}
            pressed={player.shuffle}
            disabled={!hasTrack}
            onClick={() => player.setShuffle(!player.shuffle)}
          >
            ⤨
          </TransportButton>
          <TransportButton label="Previous" disabled={!hasTrack} onClick={player.prev}>
            ⏮
          </TransportButton>
          <button
            type="button"
            aria-label={isPlaying ? "Pause" : "Play"}
            onClick={player.toggle}
            disabled={!hasTrack}
            className="grid size-10 place-items-center border-2 border-border bg-primary text-primary-foreground shadow-sm transition-all hover:translate-y-0.5 hover:bg-primary-hover hover:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "…" : isPlaying ? "⏸" : "▶"}
          </button>
          <TransportButton label="Next" disabled={!hasTrack} onClick={player.next}>
            ⏭
          </TransportButton>
          <TransportButton
            label={`Repeat: ${player.repeat}`}
            active={player.repeat !== "off"}
            disabled={!hasTrack}
            onClick={() => player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")}
          >
            {player.repeat === "one" ? "🔂" : "🔁"}
          </TransportButton>
        </div>

        <div className="flex w-full items-center gap-2">
          <span className="min-w-9 text-center font-mono text-[11px] tabular-nums text-chrome-muted">
            {formatTime(positionMs)}
          </span>
          <input
            type="range"
            min={0}
            max={durationMs && durationMs > 0 ? durationMs : 1}
            value={Math.min(positionMs, durationMs ?? positionMs)}
            onChange={(e) => player.seek(Number(e.target.value))}
            disabled={!hasTrack || !durationMs}
            aria-label="Seek"
            className="h-1.5 min-w-16 flex-1 appearance-none bg-secondary-hover accent-primary"
          />
          <span className="min-w-9 text-center font-mono text-[11px] tabular-nums text-chrome-muted">
            {formatTime(durationMs)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2.5">
        <SourceChip />
        <LikeButton />
        <TransportButton label="Queue" onClick={toggleQueue}>
          ☰
        </TransportButton>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="h-1.5 w-20 shrink-0 appearance-none bg-secondary-hover accent-primary"
        />
      </div>
    </div>
  );
}

function TransportButton({
  children,
  label,
  onClick,
  disabled,
  active = false,
  pressed,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active ? "text-primary" : "text-chrome-foreground hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

/** Save the current track to the library. */
function LikeButton() {
  const { track } = usePlayer();
  const { data: liked } = useIsLiked(track?.recordingId);
  const toggle = useToggleLike();
  if (!track) return null;
  return (
    <button
      type="button"
      aria-label={liked ? "Remove from library" : "Save to library"}
      aria-pressed={liked ?? false}
      onClick={() => toggle.mutate({ track, liked: liked ?? false })}
      className={cn("p-1.5 transition-colors", liked ? "text-primary" : "text-chrome-foreground hover:text-primary")}
    >
      {liked ? "♥" : "♡"}
    </button>
  );
}

/** Which addon/stream the scheduler resolved (§5, §8a table). */
function SourceChip() {
  const { item, status } = usePlayer();
  const resolution = item?.resolution;
  const base = "max-w-48 truncate text-right text-[11px] leading-tight text-chrome-muted";
  if (status === "resolving") return <div className={base}>Finding a source…</div>;
  if (resolution?.status !== "resolved") return <div className={base} />;
  const stream = resolution.streams[resolution.chosenIdx];
  if (!stream) return <div className={base} />;
  return (
    <div className={base} title={stream.name ?? ""}>
      Source: <strong className="text-chrome-foreground">{stream.name ?? "addon"}</strong>
    </div>
  );
}
