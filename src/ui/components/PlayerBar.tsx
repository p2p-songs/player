/**
 * The persistent player bar. It renders engine state and issues commands — it
 * owns no playback logic (§8a). The "Source" readout shows which addon resolved
 * the current stream (§5).
 *
 * The now-playing block on the left is a button: clicking the art or the title
 * opens the full view. That's the only affordance for it, so it carries a
 * visible hover and a real label rather than relying on people guessing.
 */
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { useIsSaved, useToggleSaved, trackToSaved } from "../viewmodels/useLibrary.js";
import { useVolume } from "../viewmodels/useVolume.js";
import { Artwork } from "./common.js";
import { PlayButton, PlayingBars, Scrubber, TransportButton } from "./transport.js";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  HeartIcon,
  ListMusicIcon,
  Repeat1Icon,
  RepeatIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function PlayerBar() {
  const player = usePlayer();
  const toggleQueue = useUi((s) => s.toggleQueue);
  const openNowPlaying = useUi((s) => s.openNowPlaying);

  const { track, status, isPlaying, positionMs, durationMs } = player;
  const busy = status === "resolving" || status === "buffering";
  const hasTrack = track !== undefined;

  return (
    <div className="col-span-2 grid grid-cols-[minmax(200px,1fr)_minmax(340px,2fr)_minmax(200px,1fr)] items-center gap-4 border-t-2 border-border bg-chrome px-4 text-chrome-foreground">
      {hasTrack ? (
        <button
          type="button"
          onClick={openNowPlaying}
          aria-label={`Open now playing: ${track.title}`}
          className="group flex min-w-0 items-center gap-3 py-2 text-left"
        >
          <Artwork src={track.artwork} alt={track.title} seed={track.recordingId} size={44} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium group-hover:text-accent">{track.title}</span>
            <span className="block truncate text-xs text-chrome-muted">
              {track.artist ?? "Unknown artist"}
              {track.album ? ` · ${track.album}` : ""}
            </span>
          </span>
        </button>
      ) : (
        <div className="text-xs text-chrome-muted">Nothing playing</div>
      )}

      <div className="flex flex-col items-center gap-1.5 py-2">
        <div className="flex items-center gap-3">
          <TransportButton
            label="Shuffle"
            active={player.shuffle}
            pressed={player.shuffle}
            disabled={!hasTrack}
            onClick={() => player.setShuffle(!player.shuffle)}
          >
            <ShuffleIcon className="size-4" />
          </TransportButton>
          <TransportButton label="Previous" disabled={!hasTrack} onClick={player.prev}>
            <SkipBackIcon className="size-5" fill="currentColor" />
          </TransportButton>
          <PlayButton isPlaying={isPlaying} busy={busy} disabled={!hasTrack} onClick={player.toggle} />
          <TransportButton label="Next" disabled={!hasTrack} onClick={player.next}>
            <SkipForwardIcon className="size-5" fill="currentColor" />
          </TransportButton>
          <TransportButton
            label={`Repeat: ${player.repeat}`}
            active={player.repeat !== "off"}
            disabled={!hasTrack}
            onClick={() => player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")}
          >
            {player.repeat === "one" ? <Repeat1Icon className="size-4" /> : <RepeatIcon className="size-4" />}
          </TransportButton>
        </div>

        <Scrubber
          positionMs={positionMs}
          durationMs={durationMs}
          onSeek={player.seek}
          disabled={!hasTrack}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        {isPlaying ? <PlayingBars className="mr-1" /> : null}
        <SourceChip />
        <LikeButton />
        <TransportButton label="Queue" onClick={toggleQueue}>
          <ListMusicIcon className="size-4" />
        </TransportButton>
        <VolumeControl />
      </div>
    </div>
  );
}

function VolumeControl() {
  const { volume, muted, setVolume, commit, toggleMuted } = useVolume();
  const Icon = muted || volume === 0 ? VolumeXIcon : volume < 0.5 ? Volume1Icon : Volume2Icon;

  return (
    <div className="flex items-center gap-1.5">
      <TransportButton label={muted ? "Unmute" : "Mute"} pressed={muted} active={muted} onClick={toggleMuted}>
        <Icon className="size-4" />
      </TransportButton>
      <SliderPrimitive.Root
        className="group relative flex h-4 w-20 shrink-0 touch-none items-center select-none"
        min={0}
        max={1}
        step={0.01}
        value={[muted ? 0 : volume]}
        onValueChange={([v]) => {
          if (v === undefined) return;
          if (muted) toggleMuted();
          setVolume(v);
        }}
        onValueCommit={commit}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden bg-chrome-track">
          <SliderPrimitive.Range className="absolute h-full bg-chrome-foreground" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Volume"
          className="block size-3.5 rounded-full border-2 border-border bg-chrome-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        />
      </SliderPrimitive.Root>
    </div>
  );
}

/** Save the current track to the library. */
function LikeButton() {
  const { track } = usePlayer();
  const { data: liked } = useIsSaved(track?.recordingId);
  const toggle = useToggleSaved();
  if (!track) return null;
  return (
    <TransportButton
      label={liked ? "Remove from library" : "Save to library"}
      pressed={liked ?? false}
      active={liked ?? false}
      onClick={() => toggle.mutate({ item: trackToSaved(track), saved: liked ?? false })}
    >
      <HeartIcon className={cn("size-4", liked && "fill-current")} />
    </TransportButton>
  );
}

/** Which addon/stream the scheduler resolved (§5, §8a table). */
function SourceChip() {
  const { item, status } = usePlayer();
  const resolution = item?.resolution;
  const base = "max-w-44 truncate text-right text-[11px] leading-tight text-chrome-muted";
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
