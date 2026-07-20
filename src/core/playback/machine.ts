/**
 * Playback state machine (ARCHITECTURE §4b): a hand-rolled discriminated-union
 * FSM. State is a union on `status`; `transition` is a pure, total
 * `(state, event) => state`. Impossible states are unrepresentable (you cannot be
 * `playing` without a stamped path through `buffering`), and the genuinely hard
 * async (resolve → buffer, cancellation, TTL, fallback) lives in the scheduler
 * (§5), not here — this machine just reacts to `ended`/`error`/`resolved`/etc.
 *
 * **Stale-completion safety.** Async resolves/loads race with skips and reorders.
 * Cancellation (AbortController, in the engine) is an optimization; **identity
 * validation is the correctness mechanism.** Every attempt carries an immutable
 * `{ epoch, itemId, attemptId }` stamp, and the reducer **ignores any stamped
 * event whose stamp doesn't match current state** — a resolve that lands after
 * you've skipped away is simply dropped.
 */
import type { QueueItemId } from "../queue/types.js";

/** Immutable identity of one resolve/load attempt. */
export interface Stamp {
  /** Bumps when the queue is replaced or the current item changes. */
  epoch: number;
  itemId: QueueItemId;
  /** Distinguishes retries of the same item. */
  attemptId: number;
}

export type PlaybackState =
  | { status: "idle"; epoch: number }
  | { status: "resolving"; epoch: number; itemId: QueueItemId; attemptId: number }
  | { status: "buffering"; epoch: number; itemId: QueueItemId; attemptId: number; url: string }
  | { status: "playing"; epoch: number; itemId: QueueItemId; attemptId: number; url: string; positionMs: number }
  | { status: "paused"; epoch: number; itemId: QueueItemId; attemptId: number; url: string; positionMs: number }
  | { status: "ended"; epoch: number; itemId: QueueItemId }
  | { status: "failed"; epoch: number; itemId: QueueItemId; reason?: string }
  | { status: "error"; epoch: number; reason?: string };

export type PlaybackEvent =
  /** Engine command: begin an attempt for `itemId` (defines a new stamp). */
  | { type: "SELECT"; epoch: number; itemId: QueueItemId; attemptId: number }
  /** Scheduler: the current attempt resolved to a playable url. */
  | { type: "RESOLVED"; stamp: Stamp; url: string }
  /** Scheduler: the current attempt could not be resolved. */
  | { type: "RESOLVE_FAILED"; stamp: Stamp; reason?: string }
  /** Audio: buffered enough to start. */
  | { type: "LOADED"; stamp: Stamp }
  /** Audio: the url failed to load / died mid-play. */
  | { type: "LOAD_FAILED"; stamp: Stamp; reason?: string }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "POSITION"; ms: number }
  | { type: "ENDED" }
  /** Engine: circuit breaker tripped — terminal, actionable error (§4b). */
  | { type: "TERMINATE"; reason?: string }
  /** Engine: stop/clear to idle at a new epoch. */
  | { type: "RESET"; epoch: number };

export function initialState(epoch = 0): PlaybackState {
  return { status: "idle", epoch };
}

/** The current attempt's stamp, if the state has one. */
function stampOf(state: PlaybackState): Stamp | undefined {
  switch (state.status) {
    case "resolving":
    case "buffering":
    case "playing":
    case "paused":
      return { epoch: state.epoch, itemId: state.itemId, attemptId: state.attemptId };
    default:
      return undefined;
  }
}

function matches(state: PlaybackState, stamp: Stamp): boolean {
  const s = stampOf(state);
  return !!s && s.epoch === stamp.epoch && s.itemId === stamp.itemId && s.attemptId === stamp.attemptId;
}

/** Pure, total transition. Unknown/stale events return the state unchanged. */
export function transition(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case "SELECT":
      // A command — always accepted; defines the new current stamp.
      return { status: "resolving", epoch: event.epoch, itemId: event.itemId, attemptId: event.attemptId };

    case "RESOLVED":
      if (state.status === "resolving" && matches(state, event.stamp)) {
        return { status: "buffering", epoch: state.epoch, itemId: state.itemId, attemptId: state.attemptId, url: event.url };
      }
      return state;

    case "RESOLVE_FAILED":
      if (state.status === "resolving" && matches(state, event.stamp)) {
        return { status: "failed", epoch: state.epoch, itemId: state.itemId, ...(event.reason ? { reason: event.reason } : {}) };
      }
      return state;

    case "LOADED":
      if (state.status === "buffering" && matches(state, event.stamp)) {
        return { status: "playing", epoch: state.epoch, itemId: state.itemId, attemptId: state.attemptId, url: state.url, positionMs: 0 };
      }
      return state;

    case "LOAD_FAILED":
      if ((state.status === "buffering" || state.status === "playing" || state.status === "paused") && matches(state, event.stamp)) {
        return { status: "failed", epoch: state.epoch, itemId: state.itemId, ...(event.reason ? { reason: event.reason } : {}) };
      }
      return state;

    case "PLAY":
      if (state.status === "paused") {
        return { status: "playing", epoch: state.epoch, itemId: state.itemId, attemptId: state.attemptId, url: state.url, positionMs: state.positionMs };
      }
      return state;

    case "PAUSE":
      if (state.status === "playing") {
        return { status: "paused", epoch: state.epoch, itemId: state.itemId, attemptId: state.attemptId, url: state.url, positionMs: state.positionMs };
      }
      return state;

    case "POSITION":
      if (state.status === "playing" || state.status === "paused") {
        return { ...state, positionMs: event.ms };
      }
      return state;

    case "ENDED":
      if (state.status === "playing" || state.status === "paused") {
        return { status: "ended", epoch: state.epoch, itemId: state.itemId };
      }
      return state;

    case "TERMINATE":
      return { status: "error", epoch: state.epoch, ...(event.reason ? { reason: event.reason } : {}) };

    case "RESET":
      return { status: "idle", epoch: event.epoch };
  }
}
