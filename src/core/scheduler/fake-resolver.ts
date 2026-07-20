/**
 * A scriptable fake resolver for headless tests (ARCHITECTURE §5: "a fake
 * resolver that simulates latency, expiry, failure, and duplicate/late
 * completion"). Per-recording behavior; a `manual` mode returns a promise the
 * test resolves by hand, so async races are deterministic without real timers.
 */
import type { Stream } from "@p2p-songs/protocol";
import type { TrackRef } from "../queue/types.js";
import type { Resolver, ResolveOutcome } from "./resolver.js";

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Build a minimal resolved-url stream. */
export function urlStream(url: string, over: Partial<Stream> = {}): Stream {
  return { url, name: "test", ...over };
}

type Behavior = (track: TrackRef, signal: AbortSignal) => Promise<ResolveOutcome>;

export class FakeResolver implements Resolver {
  private readonly scripts = new Map<string, Behavior>();
  /** recordingIds resolve() was called with, in order. */
  readonly calls: string[] = [];
  /** How many resolutions were aborted via their signal. */
  aborts = 0;

  /** Script a recording id with a behavior (or a static outcome). */
  script(recordingId: string, behavior: Behavior | ResolveOutcome): this {
    const fn: Behavior = typeof behavior === "function" ? behavior : async () => behavior;
    this.scripts.set(recordingId, fn);
    return this;
  }

  /** Script a recording id to resolve manually; returns the Deferred to control it. */
  manual(recordingId: string): Deferred<ResolveOutcome> {
    const d = deferred<ResolveOutcome>();
    this.scripts.set(recordingId, () => d.promise);
    return d;
  }

  resolve(track: TrackRef, signal: AbortSignal): Promise<ResolveOutcome> {
    this.calls.push(track.recordingId);
    if (signal.aborted) this.aborts++;
    else signal.addEventListener("abort", () => this.aborts++, { once: true });
    const behavior = this.scripts.get(track.recordingId);
    if (behavior) return behavior(track, signal);
    // Default: resolve to a single synthetic https url.
    return Promise.resolve({ ok: true, streams: [urlStream(`https://cdn.test/${track.recordingId}.flac`)] });
  }
}
