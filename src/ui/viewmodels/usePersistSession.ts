/**
 * The durable-session wiring (ARCHITECTURE §6) — the piece P-4 deliberately
 * deferred until there was an app lifecycle to hang it on:
 *
 * - **Hydrate on boot:** restore the persisted queue identity, every item forced
 *   to `resolution: idle` so nothing replays a stale bearer URL.
 * - **Debounced autosave:** persist queue *identity* as it changes — never the
 *   resolved media, which the repository strips anyway. {@link SessionAutosave}
 *   owns the debounce, the retry, and the flush; this hook only decides *when*
 *   to feed and flush it.
 * - **Flush on page lifecycle:** `visibilitychange`→hidden and `pagehide` are
 *   the last reliable moments to write. Without them, closing the tab within
 *   the debounce window silently discards the newest queue edit.
 * - **Record plays:** append to the durable history when a track starts playing.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SessionAutosave } from "../../core/persistence/session-autosave.js";
import { useServices } from "../../app/providers.js";

export function usePersistSession(): void {
  const { engine, repository } = useServices();
  const queryClient = useQueryClient();
  const hydrated = useRef(false);

  useEffect(() => {
    let disposed = false;
    let lastPlayed: string | undefined;
    const autosave = new SessionAutosave({ save: (queue) => repository.saveQueue(queue) });

    // --- hydrate once, and only over an untouched queue ---
    void (async () => {
      try {
        const saved = await repository.loadQueue();
        if (disposed || !saved) return;
        if (engine.getState().queue.canonicalOrder.length > 0) return; // user already started
        engine.restoreQueue(saved);
        autosave.markDurable(engine.getState().queue); // it came from the store; don't write it back
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

      // --- autosave queue identity (a no-op for the position ticks) ---
      if (!hydrated.current) return; // don't write before the restore lands
      autosave.schedule(state.queue);
    });

    const flush = (): void => autosave.flush();
    const flushIfHidden = (): void => {
      if (document.visibilityState === "hidden") autosave.flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushIfHidden);

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushIfHidden);
      unsubscribe();
      autosave.dispose();
    };
  }, [engine, repository, queryClient]);
}
