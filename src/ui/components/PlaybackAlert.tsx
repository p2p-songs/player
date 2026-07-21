/**
 * Surfaces a failed playback attempt just above the player bar. Without this the
 * engine's terminal `error` state is invisible: the bar shows the track, the
 * progress sits at 0:00, and nothing explains why (mockup panel 9).
 */
import { usePlaybackProblem } from "../viewmodels/usePlaybackProblem.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";

export function PlaybackAlert() {
  const problem = usePlaybackProblem();
  const { item, selectItem } = usePlayer();
  const setView = useUi((s) => s.setView);
  if (!problem) return null;

  return (
    <div className="playback-alert" role="alert">
      <span aria-hidden="true">⚠</span>
      <span className="playback-alert-text">
        <strong>{problem.title}</strong>
        <span className="muted"> — {problem.message}</span>
      </span>
      {problem.addonsAction ? (
        <button type="button" className="btn btn-sm" onClick={() => setView("addons")}>
          Manage addons
        </button>
      ) : null}
      {item ? (
        <button type="button" className="btn btn-sm" onClick={() => selectItem(item.id)}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
