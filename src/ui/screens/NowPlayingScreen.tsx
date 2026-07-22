/**
 * The full now-playing view — the record, what's on it, and what's next.
 *
 * It is an **overlay over the whole shell**, not a `View`: it covers the sidebar
 * and the player bar, and closing it returns you to exactly the screen you were
 * on.
 *
 * Built on the Radix dialog primitive rather than a positioned `div`, because
 * "covers everything" is a claim that has to hold for the keyboard too — focus
 * trapping, Escape, restoring focus to the control that opened it, and marking
 * the rest of the app inert. A hand-rolled overlay gets the pixels right and
 * lets Tab walk straight out into a screen nobody can see. It's styled from the
 * primitive directly rather than `components/ui/dialog`, whose content is a
 * centred card and would have to be undone.
 *
 * What it deliberately does *not* have, because the mockup shows things this
 * player hasn't built: no source **picker** (the readout is real — it names the
 * addon the scheduler actually resolved from — but choosing between streams is
 * §5's deferred source-picker), no "add to playlist" (no playlist UI exists),
 * and no autoplay-radio section (the queue carries a `RadioSeed` but nothing
 * generates from it yet). Drawing controls for absent features is how a UI
 * starts lying about what it can do.
 */
import { Dialog as DialogPrimitive } from "radix-ui";
import { useUi } from "../../app/store.js";
import { usePlayer, useUpNext } from "../viewmodels/useEngineState.js";
import { useIsSaved, useToggleSaved, trackToSaved } from "../viewmodels/useLibrary.js";
import { Artwork, formatTime } from "../components/common.js";
import { Vinyl } from "../components/Vinyl.js";
import { PlayButton, Scrubber, TransportButton } from "../components/transport.js";
import { ChromeButton, Row, RowMain, RowTime, Rows, StateBlock } from "../components/primitives.js";
import { PlaybackAlert } from "../components/PlaybackAlert.js";
import {
  ChevronDownIcon,
  DiscAlbumIcon,
  HeartIcon,
  Repeat1Icon,
  RepeatIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function NowPlayingScreen() {
  const open = useUi((s) => s.nowPlayingOpen);
  const close = useUi((s) => s.closeNowPlaying);
  const openDetail = useUi((s) => s.openDetail);
  const player = usePlayer();
  const upNext = useUpNext(20);
  const { track, item, status, isPlaying, positionMs, durationMs } = player;
  const { data: liked } = useIsSaved(track?.recordingId);
  const toggleSaved = useToggleSaved();

  // Nothing playing means nothing to show — and the bar can't open it anyway.
  if (!open || !track) return null;

  const busy = status === "resolving" || status === "buffering";
  const resolution = item?.resolution;
  const source =
    resolution?.status === "resolved" ? (resolution.streams[resolution.chosenIdx]?.name ?? "addon") : undefined;

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-30 grid grid-cols-[1fr_22rem] bg-chrome text-chrome-foreground outline-none"
        >
          <div className="flex min-w-0 flex-col p-8">
            <div className="flex items-start justify-between gap-4">
              {/* Not `Dialog.Close asChild`: Slot would have to merge a ref
                  into a plain function component for no gain — `close()` is the
                  same thing the dialog would call. */}
              <ChromeButton onClick={close} className="px-3 py-1.5 text-xs">
                <ChevronDownIcon className="size-4" />
                Minimize
              </ChromeButton>
              {source ? (
                <div className="border-2 border-accent px-3 py-1.5 font-head text-[11px] uppercase tracking-[0.14em] text-accent">
                  Streaming from: {source}
                </div>
              ) : busy ? (
                <div className="font-head text-[11px] uppercase tracking-[0.14em] text-chrome-muted">
                  Finding a source…
                </div>
              ) : null}
            </div>

            <div className="flex min-h-0 flex-1 items-center justify-center gap-12 py-8">
              <Vinyl
                seed={track.recordingId}
                artwork={track.artwork}
                spinning={isPlaying}
                size={360}
              />

              <div className="flex min-w-0 max-w-md flex-col gap-3">
                <div className="font-head text-[11px] uppercase tracking-[0.2em] text-chrome-muted">Now spinning</div>
                {/* Doubles as the dialog's accessible name — the track *is* the
                    title of this view, so there is nothing to duplicate. */}
                <DialogPrimitive.Title asChild>
                  <h1 className="font-head text-5xl leading-[1.05] tracking-tight break-words">{track.title}</h1>
                </DialogPrimitive.Title>
                <div className="text-lg text-accent">
                  {track.artist ?? "Unknown artist"}
                  {track.album ? ` · ${track.album}` : ""}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <ChromeButton
                    pressed={liked ?? false}
                    active={liked ?? false}
                    onClick={() => toggleSaved.mutate({ item: trackToSaved(track), saved: liked ?? false })}
                  >
                    <HeartIcon className={cn("size-4", liked && "fill-current")} />
                    {liked ? "Liked" : "Like"}
                  </ChromeButton>
                  {track.releaseId && track.album ? (
                    <ChromeButton
                      // Pushes onto whatever stack the shell already has, so Back
                      // returns to the screen the overlay was opened from.
                      onClick={() => {
                        close();
                        openDetail({ kind: "album", id: track.releaseId!, name: track.album! });
                      }}
                    >
                      <DiscAlbumIcon className="size-4" />
                      Album
                    </ChromeButton>
                  ) : null}
                </div>
              </div>
            </div>

            <PlaybackAlert inline />

            <div className="flex flex-col items-center gap-4 pt-4">
              <Scrubber
                positionMs={positionMs}
                durationMs={durationMs}
                onSeek={player.seek}
                size="lg"
              />
              <div className="flex items-center gap-6">
                <TransportButton
                  label="Shuffle"
                  active={player.shuffle}
                  pressed={player.shuffle}
                  onClick={() => player.setShuffle(!player.shuffle)}
                >
                  <ShuffleIcon className="size-5" />
                </TransportButton>
                <TransportButton label="Previous" onClick={player.prev}>
                  <SkipBackIcon className="size-6" fill="currentColor" />
                </TransportButton>
                <PlayButton isPlaying={isPlaying} busy={busy} onClick={player.toggle} size="lg" />
                <TransportButton label="Next" onClick={player.next}>
                  <SkipForwardIcon className="size-6" fill="currentColor" />
                </TransportButton>
                <TransportButton
                  label={`Repeat: ${player.repeat}`}
                  active={player.repeat !== "off"}
                  onClick={() =>
                    player.setRepeat(player.repeat === "off" ? "all" : player.repeat === "all" ? "one" : "off")
                  }
                >
                  {player.repeat === "one" ? <Repeat1Icon className="size-5" /> : <RepeatIcon className="size-5" />}
                </TransportButton>
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col border-l-2 border-border bg-background text-foreground">
            <div className="border-b-2 border-border px-4 py-3 font-head text-xs uppercase tracking-[0.14em]">
              Up next
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {upNext.length === 0 ? (
                <StateBlock icon="♪" title="Nothing up next" message="This is the last track in the queue." />
              ) : (
                <Rows flush>
                  {upNext.map((next) => (
                    <Row key={next.id} onClick={() => player.selectItem(next.id)}>
                      <Artwork
                        src={next.track.artwork}
                        alt={next.track.title}
                        seed={next.track.recordingId}
                        size={34}
                      />
                      <RowMain title={next.track.title} sub={next.track.artist ?? "Unknown artist"} />
                      <RowTime>{formatTime(next.track.durationMs)}</RowTime>
                    </Row>
                  ))}
                </Rows>
              )}
            </div>
          </aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
