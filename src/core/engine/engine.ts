/**
 * The engine (ARCHITECTURE §3/§4/§5) — the orchestrator that ties the pure parts
 * together: the queue model (§4a), the playback FSM (§4b), the resolution+prefetch
 * scheduler (§5), and an audio backend (§4c). It owns policy; the parts stay pure.
 *
 * Responsibilities:
 * - JIT **prefetch** of the next 1–2 items on play (never the whole queue).
 * - **Fallback** on failure: walk the item's ranked stream list → re-resolve the
 *   item once → skip-ahead — all within a **bounded failure circuit-breaker** so a
 *   provider outage can never become an infinite resolve→fail→skip loop.
 * - **Stale-completion safety**: every attempt is stamped `{epoch,itemId,attemptId}`;
 *   the FSM drops events whose stamp doesn't match, and audio completions are tied
 *   back to their attempt by token. Cancellation is an optimization, identity is
 *   the guarantee.
 */
import { stampKey, transition, initialState, type PlaybackEvent, type PlaybackState, type Stamp } from "../playback/machine.js";
import {
  append,
  createQueue,
  getItem,
  insertAfter,
  moveItem,
  nextId,
  prevId,
  removeItem,
  setCurrent,
  setRepeat,
  setResolution,
  setShuffle,
  upNext,
  type CreateQueueOptions,
} from "../queue/queue.js";
import { counterIdGen, type IdGen, type Queue, type QueueItem, type QueueItemId, type RepeatMode, type ResolutionState, type Rng, type TrackRef } from "../queue/types.js";
import type { Stream } from "@p2p-songs/protocol";
import { Scheduler } from "../scheduler/scheduler.js";
import type { Resolver } from "../scheduler/resolver.js";
import type { AudioBackend, AudioEvent } from "../audio/backend.js";

export interface EngineOptions {
  idGen?: IdGen;
  rng?: Rng;
  /** How many upcoming items to prefetch on play (default 2). */
  prefetchCount?: number;
  /** Consecutive failures across items before the breaker trips to `error` (default 6). */
  maxConsecutiveFailures?: number;
  /** Clock for expiry-hint checks (default Date.now). */
  now?: () => number;
}

export interface EngineState {
  queue: Queue;
  playback: PlaybackState;
}

type ResolvedResolution = Extract<ResolutionState, { status: "resolved" }>;

export class Engine {
  private queue: Queue;
  private playback: PlaybackState;
  private epoch = 0;
  private attempt = 0;
  private readonly scheduler: Scheduler;
  private readonly audio: AudioBackend;
  private readonly idGen: IdGen;
  private readonly rng: Rng;
  private readonly prefetchCount: number;
  private readonly maxConsecutiveFailures: number;
  private readonly now: () => number;
  private readonly unsubscribeAudio: () => void;

  /** token → stamp, so audio completions map back to the attempt that started them. */
  private readonly loadTokens = new Map<string, Stamp>();
  /** Per-current-item fallback budget (reset when a new item starts). */
  private itemFallback = { reResolved: false };
  /** Consecutive across-item failures with no successful play in between. */
  private consecutiveFailures = 0;
  private readonly listeners = new Set<(state: EngineState) => void>();

  constructor(resolver: Resolver, audio: AudioBackend, options: EngineOptions = {}) {
    this.scheduler = new Scheduler(resolver);
    this.audio = audio;
    this.idGen = options.idGen ?? counterIdGen();
    this.rng = options.rng ?? Math.random;
    this.prefetchCount = options.prefetchCount ?? 2;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 6;
    this.now = options.now ?? Date.now;
    this.queue = { itemsById: {}, canonicalOrder: [], playOrder: [], currentItemId: null, repeat: "off", shuffle: false };
    this.playback = initialState(0);
    this.unsubscribeAudio = audio.subscribe((event) => this.onAudioEvent(event));
  }

  // --- public state ---

  getState(): EngineState {
    return { queue: this.queue, playback: this.playback };
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unsubscribeAudio();
    this.scheduler.cancelAll();
    this.listeners.clear();
  }

  // --- commands ---

  /** Replace the queue. Does not auto-play; call `play()` to start. */
  setQueue(tracks: TrackRef[], options: CreateQueueOptions = {}): void {
    this.queue = createQueue(tracks, this.idGen, { rng: this.rng, ...options });
    this.epoch += 1;
    this.scheduler.cancelAll();
    this.loadTokens.clear();
    this.resetBreaker();
    this.dispatch({ type: "RESET", epoch: this.epoch });
  }

  play(): void {
    if (this.playback.status === "paused") {
      this.dispatch({ type: "PLAY" });
    } else if (this.playback.status === "idle" && this.queue.currentItemId) {
      this.resetBreaker();
      this.startItem(this.queue.currentItemId);
    }
  }

  pause(): void {
    this.dispatch({ type: "PAUSE" });
  }

  next(): void {
    this.resetBreaker();
    const n = nextId(this.queue, { auto: false });
    if (n) this.startItem(n);
    else this.stop();
  }

  prev(): void {
    this.resetBreaker();
    const p = prevId(this.queue);
    if (p) this.startItem(p);
    else if (this.queue.currentItemId) this.startItem(this.queue.currentItemId);
  }

  selectItem(itemId: QueueItemId): void {
    if (!getItem(this.queue, itemId)) return;
    this.resetBreaker();
    this.startItem(itemId);
  }

  seek(ms: number): void {
    this.audio.seek(ms);
    this.dispatch({ type: "POSITION", ms });
  }

  setShuffle(on: boolean): void {
    this.queue = setShuffle(this.queue, on, this.rng);
    this.notify();
  }

  setRepeat(mode: RepeatMode): void {
    this.queue = setRepeat(this.queue, mode);
    this.notify();
  }

  append(tracks: TrackRef[]): void {
    this.queue = append(this.queue, tracks, this.idGen);
    this.notify();
  }

  insertAfter(afterId: QueueItemId | null, tracks: TrackRef[]): void {
    this.queue = insertAfter(this.queue, afterId, tracks, this.idGen);
    this.notify();
  }

  /** Reorder an item in canonical order (does not disturb an in-flight resolution — ids are stable). */
  move(itemId: QueueItemId, toIndex: number): void {
    this.queue = moveItem(this.queue, itemId, toIndex);
    this.notify();
  }

  remove(itemId: QueueItemId): void {
    const wasCurrent = this.queue.currentItemId === itemId;
    this.queue = removeItem(this.queue, itemId);
    if (wasCurrent) {
      const c = this.queue.currentItemId;
      if (c) this.startItem(c);
      else this.stop();
    } else {
      this.notify();
    }
  }

  stop(): void {
    this.epoch += 1;
    this.scheduler.cancelAll();
    this.dispatch({ type: "RESET", epoch: this.epoch });
  }

  // --- orchestration ---

  private startItem(itemId: QueueItemId): void {
    if (!getItem(this.queue, itemId)) return;
    this.queue = setCurrent(this.queue, itemId);
    this.epoch += 1; // the current item changed
    this.itemFallback = { reResolved: false };
    this.scheduler.cancelExcept(this.nearCursorIds());
    const stamp: Stamp = { epoch: this.epoch, itemId, attemptId: ++this.attempt };
    this.dispatch({ type: "SELECT", epoch: stamp.epoch, itemId, attemptId: stamp.attemptId });

    const item = getItem(this.queue, itemId)!;
    if (this.isResolvedFresh(item)) {
      const res = item.resolution as ResolvedResolution;
      this.dispatch({ type: "RESOLVED", stamp, url: res.url });
    } else {
      this.beginResolve(item, stamp);
    }
  }

  /** Kick off a fresh resolution for the current attempt and feed the result to the FSM. */
  private beginResolve(item: QueueItem, stamp: Stamp): void {
    this.queue = setResolution(this.queue, stamp.itemId, { status: "resolving" });
    this.scheduler.resolve(item, stamp).then((outcome) => {
      if (outcome.ok) {
        const picked = pickPlayable(outcome.streams, 0);
        if (!picked) {
          this.queue = setResolution(this.queue, stamp.itemId, { status: "failed", reason: "no playable stream" });
          this.dispatch({ type: "RESOLVE_FAILED", stamp, reason: "no playable stream" });
        } else {
          this.queue = setResolution(this.queue, stamp.itemId, resolvedFrom(outcome.streams, picked.idx, picked.url));
          this.dispatch({ type: "RESOLVED", stamp, url: picked.url });
        }
      } else {
        this.queue = setResolution(this.queue, stamp.itemId, { status: "failed", ...(outcome.reason ? { reason: outcome.reason } : {}) });
        this.dispatch({ type: "RESOLVE_FAILED", stamp, ...(outcome.reason ? { reason: outcome.reason } : {}) });
      }
      this.notify();
    });
    this.notify();
  }

  /** Try a specific already-resolved stream (same item, new attempt) — the fallback walk. */
  private tryStream(itemId: QueueItemId, streams: Stream[], idx: number, expiresAt: string | undefined): void {
    const url = streams[idx]!.url!;
    this.queue = setResolution(this.queue, itemId, resolvedFrom(streams, idx, url, expiresAt));
    const stamp: Stamp = { epoch: this.epoch, itemId, attemptId: ++this.attempt };
    this.dispatch({ type: "SELECT", epoch: stamp.epoch, itemId, attemptId: stamp.attemptId });
    this.dispatch({ type: "RESOLVED", stamp, url });
  }

  /** Re-resolve the current item fresh (same item, new attempt). */
  private reResolve(itemId: QueueItemId): void {
    const item = getItem(this.queue, itemId);
    if (!item) return;
    const stamp: Stamp = { epoch: this.epoch, itemId, attemptId: ++this.attempt };
    this.dispatch({ type: "SELECT", epoch: stamp.epoch, itemId, attemptId: stamp.attemptId });
    this.beginResolve(item, stamp);
  }

  private prefetchUpcoming(): void {
    const near = upNext(this.queue).slice(0, this.prefetchCount);
    for (const id of near) {
      const item = getItem(this.queue, id);
      if (!item || item.resolution.status !== "idle") continue;
      const stamp: Stamp = { epoch: this.epoch, itemId: id, attemptId: ++this.attempt };
      this.queue = setResolution(this.queue, id, { status: "resolving" });
      this.scheduler.resolve(item, stamp).then((outcome) => {
        if (!getItem(this.queue, id)) return;
        if (outcome.ok) {
          const picked = pickPlayable(outcome.streams, 0);
          this.queue = picked
            ? setResolution(this.queue, id, resolvedFrom(outcome.streams, picked.idx, picked.url))
            : setResolution(this.queue, id, { status: "failed", reason: "no playable stream" });
        } else {
          this.queue = setResolution(this.queue, id, { status: "failed", ...(outcome.reason ? { reason: outcome.reason } : {}) });
        }
        this.notify();
      });
    }
    this.notify();
  }

  // --- FSM dispatch + effects ---

  private dispatch(event: PlaybackEvent): void {
    const prev = this.playback;
    const next = transition(prev, event);
    if (next === prev) return; // no-op or dropped stale event
    this.playback = next;
    this.reactToEntry(prev, next);
    this.notify();
  }

  private reactToEntry(prev: PlaybackState, next: PlaybackState): void {
    switch (next.status) {
      case "buffering": {
        const token = this.registerToken({ epoch: next.epoch, itemId: next.itemId, attemptId: next.attemptId });
        this.audio.load(next.url, token);
        break;
      }
      case "playing": {
        this.audio.play();
        if (prev.status === "buffering") {
          // A successful start clears the breaker and the item's fallback budget.
          this.consecutiveFailures = 0;
          this.itemFallback = { reResolved: false };
          this.prefetchUpcoming();
        }
        break;
      }
      case "paused":
        this.audio.pause();
        break;
      case "ended":
        this.onEnded();
        break;
      case "failed":
        this.onFailure(next.itemId);
        break;
      case "error":
      case "idle":
        this.audio.stop();
        break;
      case "resolving":
        break; // resolution is kicked off explicitly by the caller
    }
  }

  private onEnded(): void {
    const n = nextId(this.queue, { auto: true });
    if (n) this.startItem(n); // auto-advance: does NOT reset the breaker
    else this.stop();
  }

  private onFailure(itemId: QueueItemId): void {
    const item = getItem(this.queue, itemId);
    // 1) Walk the ranked fallback list.
    if (item && item.resolution.status === "resolved") {
      const res = item.resolution;
      const nextIdx = pickPlayable(res.streams, res.chosenIdx + 1);
      if (nextIdx) {
        this.tryStream(itemId, res.streams, nextIdx.idx, res.expiresAt);
        return;
      }
    }
    // 2) Re-resolve the item fresh, once.
    if (!this.itemFallback.reResolved) {
      this.itemFallback.reResolved = true;
      this.reResolve(itemId);
      return;
    }
    // 3) Skip-ahead — bounded by the circuit breaker.
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.dispatch({ type: "TERMINATE", reason: "playback failed repeatedly" });
      return;
    }
    const n = nextId(this.queue, { auto: false });
    if (n && n !== itemId) this.startItem(n);
    else this.dispatch({ type: "TERMINATE", reason: "no playable track" });
  }

  // --- audio events ---

  private onAudioEvent(event: AudioEvent): void {
    const stamp = this.loadTokens.get(event.token);
    switch (event.type) {
      case "loaded":
        if (stamp) this.dispatch({ type: "LOADED", stamp });
        break;
      case "error":
        if (stamp) this.dispatch({ type: "LOAD_FAILED", stamp, ...(event.reason ? { reason: event.reason } : {}) });
        break;
      case "ended":
        if (stamp && this.isCurrentStamp(stamp)) this.dispatch({ type: "ENDED" });
        break;
      case "position":
        if (stamp && this.isCurrentStamp(stamp)) this.dispatch({ type: "POSITION", ms: event.ms });
        break;
    }
  }

  // --- helpers ---

  private registerToken(stamp: Stamp): string {
    const token = stampKey(stamp);
    this.loadTokens.set(token, stamp);
    return token;
  }

  private isCurrentStamp(stamp: Stamp): boolean {
    const s = this.playback;
    if (s.status === "playing" || s.status === "paused" || s.status === "buffering") {
      return s.epoch === stamp.epoch && s.itemId === stamp.itemId && s.attemptId === stamp.attemptId;
    }
    return false;
  }

  private isResolvedFresh(item: QueueItem): boolean {
    if (item.resolution.status !== "resolved") return false;
    const { expiresAt } = item.resolution;
    if (!expiresAt) return true;
    const t = Date.parse(expiresAt);
    return Number.isNaN(t) || t > this.now();
  }

  private nearCursorIds(): Set<QueueItemId> {
    const ids = new Set<QueueItemId>();
    if (this.queue.currentItemId) ids.add(this.queue.currentItemId);
    for (const id of upNext(this.queue).slice(0, this.prefetchCount)) ids.add(id);
    return ids;
  }

  private resetBreaker(): void {
    this.consecutiveFailures = 0;
    this.itemFallback = { reResolved: false };
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

// --- pure helpers ---

/** First index at/after `from` whose stream has a playable `url`. */
function pickPlayable(streams: Stream[], from: number): { idx: number; url: string } | undefined {
  for (let i = Math.max(0, from); i < streams.length; i++) {
    const url = streams[i]!.url;
    if (typeof url === "string") return { idx: i, url };
  }
  return undefined;
}

function resolvedFrom(streams: Stream[], idx: number, url: string, expiresAt?: string): ResolvedResolution {
  const hintExpiry = streams[idx]!.behaviorHints?.expiresAt;
  const exp = expiresAt ?? hintExpiry;
  return { status: "resolved", streams, chosenIdx: idx, url, ...(exp ? { expiresAt: exp } : {}) };
}
