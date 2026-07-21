/**
 * The durable-session wiring (ARCHITECTURE §6) — the piece P-4 deliberately
 * deferred until there was an app lifecycle to hang it on:
 *
 * - **Hydrate on boot:** restore the persisted queue identity, every item forced
 *   to `resolution: idle` so nothing replays a stale bearer URL.
 * - **Debounced autosave:** persist queue *identity* as it changes — never the
 *   resolved media, which the repository strips anyway.
 * - **Record plays:** append to the durable history when a track starts playing.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function usePersistSession(): void {
  const { engine, repository } = useServices();
  const queryClient = useQueryClient();
  const hydrated = useRef(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPlayed: string | undefined;

    // --- hydrate once, and only over an untouched queue ---
    void (async () => {
      try {
        const saved = await repository.loadQueue();
        if (disposed || !saved) return;
        if (engine.getState().queue.canonicalOrder.length > 0) return; // user already started
        engine.restoreQueue(saved);
      } finally {
        hydrated.current = true;
      }
    })();

    const unsubscribe = engine.subscribe((state) => {
      // --- record a play when a new item actually starts ---
      const currentId = state.queue.currentItemId;
      if (state.playback.status === "playing" && currentId && currentId !== lastPlayed) {
        lastPlayed = currentId;
        const item = state.queue.itemsById[currentId];
        if (item) {
          void repository
            .recordPlay(item.track)
            .then(() => queryClient.invalidateQueries({ queryKey: ["history"] }));
        }
      }

      // --- debounced autosave of queue identity ---
      if (!hydrated.current) return; // don't write before the restore lands
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void repository.saveQueue(engine.getState().queue);
      }, AUTOSAVE_DEBOUNCE_MS);
    });

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [engine, repository, queryClient]);
}
