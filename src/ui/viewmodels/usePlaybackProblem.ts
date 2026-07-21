/**
 * Turns a failed playback attempt into something actionable (mockup panel 9:
 * "Track unavailable" / "All sources failed"). Playback failing silently is the
 * worst outcome — the engine knows *why* it couldn't play (the resolver's reason
 * is on the item's resolution), so the UI must say so and offer the next step.
 */
import { useEngineState } from "./useEngineState.js";

export interface PlaybackProblem {
  title: string;
  message: string;
  /** Point the user at the addon manager rather than a plain retry. */
  addonsAction: boolean;
}

export function usePlaybackProblem(): PlaybackProblem | undefined {
  const state = useEngineState();
  const { playback, queue } = state;
  if (playback.status !== "error" && playback.status !== "failed") return undefined;

  const currentId = queue.currentItemId;
  const item = currentId ? queue.itemsById[currentId] : undefined;
  const resolution = item?.resolution;
  const reason = (resolution?.status === "failed" ? resolution.reason : undefined) ?? playback.reason ?? "";
  const title = item ? `Can’t play “${item.track.title}”` : "Playback failed";

  if (reason.includes("no stream addon")) {
    return {
      title,
      message: "No installed addon can provide streams for this track. Install a stream addon to play music.",
      addonsAction: true,
    };
  }
  if (reason.includes("unavailable") || reason.includes("backing off")) {
    return {
      title,
      message: "Your stream addons couldn’t be reached. Check they’re running, then try again.",
      addonsAction: true,
    };
  }
  return {
    title,
    message: "This track isn’t available from any installed source. Try another track or add another stream addon.",
    addonsAction: false,
  };
}
