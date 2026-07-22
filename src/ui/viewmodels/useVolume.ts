/**
 * Volume, remembered.
 *
 * It used to be `useState(1)` in the player bar, so every reload came back at
 * full — which for a player that restores its queue and position is a jarring
 * inconsistency, and at 2am an actively bad one.
 *
 * Persisting is deliberately **on commit, not on change**: dragging the slider
 * fires continuously, and writing IndexedDB per pointer move would queue dozens
 * of transactions to store a number nobody has finished choosing yet. The live
 * value still goes to the audio element on every change, so the drag is audible.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServices } from "../../app/providers.js";

const VOLUME_KEY = "volume";
const MUTED_KEY = "muted";

export function useVolume() {
  const { audio, repository } = useServices();
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Until the stored value has been read, don't write one back — otherwise the
  // default 1 races the hydration and overwrites what was saved.
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([repository.getSetting(VOLUME_KEY, 1), repository.getSetting(MUTED_KEY, false)]).then(
      ([storedVolume, storedMuted]) => {
        if (cancelled) return;
        if (typeof storedVolume === "number" && storedVolume >= 0 && storedVolume <= 1) setVolume(storedVolume);
        setMuted(storedMuted === true);
        hydrated.current = true;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    audio.setVolume(muted ? 0 : volume);
  }, [audio, volume, muted]);

  const commit = useCallback(() => {
    if (!hydrated.current) return;
    void repository.setSetting(VOLUME_KEY, volume);
  }, [repository, volume]);

  const toggleMuted = useCallback(() => {
    setMuted((was) => {
      const now = !was;
      if (hydrated.current) void repository.setSetting(MUTED_KEY, now);
      return now;
    });
  }, [repository]);

  return { volume, muted, setVolume, commit, toggleMuted };
}
