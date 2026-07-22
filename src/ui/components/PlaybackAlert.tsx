/**
 * Surfaces a failed playback attempt just above the player bar. Without this the
 * engine's terminal `error` state is invisible: the bar shows the track, the
 * progress sits at 0:00, and nothing explains why.
 */
import { usePlaybackProblem } from "../viewmodels/usePlaybackProblem.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { Button } from "@/components/ui/button";

export function PlaybackAlert() {
  const problem = usePlaybackProblem();
  const { item, selectItem } = usePlayer();
  const setView = useUi((s) => s.setView);
  if (!problem) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-(--player-bar-h) z-40 flex items-center gap-3 border-y-2 border-border border-b-primary bg-accent px-5 py-2.5 text-sm text-accent-foreground"
    >
      <span aria-hidden="true">⚠</span>
      <span className="min-w-0 flex-1">
        <strong className="font-head uppercase">{problem.title}</strong> — {problem.message}
      </span>
      {problem.addonsAction ? (
        <Button size="sm" variant="secondary" onClick={() => setView("addons")}>
          Manage addons
        </Button>
      ) : null}
      {item ? (
        <Button size="sm" onClick={() => selectItem(item.id)}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
