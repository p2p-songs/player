/**
 * Surfaces a failed playback attempt. Without this the engine's terminal `error`
 * state is invisible: the bar shows the track, the progress sits at 0:00, and
 * nothing explains why.
 *
 * **Dismissal is keyed to the problem, not a boolean**, and lives in the UI
 * store. Dismissing hides *this* failure; the moment the engine leaves the error
 * state the key goes away, so the next failure — including the same track
 * failing again after Retry — announces itself. A plain `dismissed` flag would
 * silence every later failure too, which is the same silent-failure bug this
 * component exists to fix. It's in the store rather than component state because
 * two instances render it, and local state would resurrect a dismissed alert as
 * soon as you minimised the overlay.
 *
 * It renders **inline** inside the now-playing overlay and **fixed** above the
 * player bar otherwise. One instance, two placements: pinned above the bar it
 * landed on top of the overlay's own transport controls.
 */
import { useEffect } from "react";
import { usePlaybackProblem } from "../viewmodels/usePlaybackProblem.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlaybackAlert({ inline = false }: { inline?: boolean }) {
  const problem = usePlaybackProblem();
  const { item, selectItem } = usePlayer();
  const setView = useUi((s) => s.setView);
  const nowPlayingOpen = useUi((s) => s.nowPlayingOpen);
  const closeNowPlaying = useUi((s) => s.closeNowPlaying);

  const key = problem ? `${problem.title}|${problem.message}` : undefined;
  const dismissedKey = useUi((s) => s.dismissedAlert);
  const setDismissedKey = useUi((s) => s.setDismissedAlert);

  useEffect(() => {
    if (key === undefined) setDismissedKey(undefined);
  }, [key, setDismissedKey]);

  if (!problem || key === dismissedKey) return null;
  // The overlay renders its own inline copy, so the fixed one stands down.
  if (inline !== nowPlayingOpen) return null;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 border-y-2 border-border border-b-primary bg-accent px-5 py-2.5 text-sm text-accent-foreground",
        inline ? "w-full" : "fixed inset-x-0 bottom-(--player-bar-h) z-40",
      )}
    >
      <span aria-hidden="true">⚠</span>
      <span className="min-w-0 flex-1">
        <strong className="font-head uppercase">{problem.title}</strong> — {problem.message}
      </span>
      {problem.addonsAction ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            closeNowPlaying();
            setView("addons");
          }}
        >
          Manage addons
        </Button>
      ) : null}
      {item ? (
        <Button size="sm" onClick={() => selectItem(item.id)}>
          Retry
        </Button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissedKey(key)}
        className="ml-1 grid size-7 shrink-0 place-items-center border-2 border-transparent transition-colors hover:border-border"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
