/**
 * Headless view-models (ARCHITECTURE §7a): pure adapters over the engine that
 * return data + bound commands. Components consume these and render — they never
 * own playback or queue logic, which is what keeps the visual layer swappable
 * and the engine the single source of truth (§8a).
 */
import { useSyncExternalStore, useMemo } from "react";
import { useServices } from "../../app/providers.js";
import type { EngineState } from "../../core/engine/engine.js";
import type { QueueItem, QueueItemId, TrackRef } from "../../core/queue/types.js";

/** Subscribe to the engine's state. Re-renders only when the engine notifies. */
export function useEngineState(): EngineState {
  const { engine } = useServices();
  return useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.getState(),
  );
}

export interface NowPlaying {
  item: QueueItem | undefined;
  track: TrackRef | undefined;
  status: EngineState["playback"]["status"];
  isPlaying: boolean;
  positionMs: number;
  durationMs: number | undefined;
  /** The resolved URL currently loaded, if any (never persisted — §6). */
  url: string | undefined;
}

/** Everything a now-playing surface needs, plus the transport commands. */
export function usePlayer() {
  const { engine } = useServices();
  const state = useEngineState();

  const nowPlaying = useMemo<NowPlaying>(() => {
    const id = state.queue.currentItemId;
    const item = id ? state.queue.itemsById[id] : undefined;
    const playback = state.playback;
    const positionMs = "positionMs" in playback ? (playback.positionMs ?? 0) : 0;
    const resolution = item?.resolution;
    return {
      item,
      track: item?.track,
      status: playback.status,
      isPlaying: playback.status === "playing",
      positionMs,
      durationMs: item?.track.durationMs,
      url: resolution?.status === "resolved" ? resolution.url : undefined,
    };
  }, [state]);

  return {
    ...nowPlaying,
    queue: state.queue,
    repeat: state.queue.repeat,
    shuffle: state.queue.shuffle,
    play: () => engine.play(),
    pause: () => engine.pause(),
    toggle: () => (state.playback.status === "playing" ? engine.pause() : engine.play()),
    next: () => engine.next(),
    prev: () => engine.prev(),
    seek: (ms: number) => engine.seek(ms),
    setShuffle: (on: boolean) => engine.setShuffle(on),
    setRepeat: engine.setRepeat.bind(engine),
    selectItem: (id: QueueItemId) => engine.selectItem(id),
    playTracks: (tracks: TrackRef[]) => {
      engine.setQueue(tracks);
      engine.play();
    },
  };
}

/** The up-next list, read from **play order** so it stays correct under shuffle (§4a). */
export function useUpNext(limit = 50): QueueItem[] {
  const state = useEngineState();
  return useMemo(() => {
    const { playOrder, currentItemId, itemsById } = state.queue;
    const from = currentItemId ? playOrder.indexOf(currentItemId) + 1 : 0;
    return playOrder
      .slice(from, from + limit)
      .map((id) => itemsById[id])
      .filter((i): i is QueueItem => i !== undefined);
  }, [state, limit]);
}
