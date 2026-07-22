import { useEffect, useState } from "react";

/**
 * Hold a rapidly-changing value still until it settles.
 *
 * Search needs this and did not have it. Typing drove a fetch per keystroke,
 * which stayed just under water while search asked for one content type at a
 * time; unified search asks for three, and 18 characters became **54 requests**.
 * MusicBrainz allows one request per second and `musicmeta` queues against that,
 * so the backlog outlived the 15s per-provider deadline and the real search
 * timed out — surfacing as "couldn't reach any addon" when every addon was
 * healthy.
 *
 * Aborting is not enough on its own: the browser drops the socket, but the
 * addon has already accepted the request and its upstream queue keeps draining.
 * The only fix that removes the load is not making the request.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, settled, delayMs]);

  return settled;
}
