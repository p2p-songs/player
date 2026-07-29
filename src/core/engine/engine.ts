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
import type { Resolving, Stream } from "@p2p-songs/protocol";
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
  /** Max re-resolve polls for a downloading source before giving up (default {@link MAX_DOWNLOAD_POLLS}). */
  maxDownloadPolls?: number;
  /** Consecutive polls a numeric download progress may sit still before we call it stalled (default {@link MAX_STALL_POLLS}). */
  maxStallPolls?: number;
}

export interface EngineState {
  queue: Queue;
  playback: PlaybackState;
}

type ResolvedResolution = Extract<ResolutionState, { status: "resolved" }>;

/**
 * Bounds on waiting for a `resolving` (downloading) source. A torrent that never
 * finishes must eventually fail rather than hold the track forever; at the floor
 * cadence this caps the wait around ~10 minutes.
 */
const MAX_DOWNLOAD_POLLS = 60;
const MIN_DOWNLOAD_RETRY_MS = 3_000;
/**
 * A download that reports numeric progress but never advances is a dead / too-
 * poorly-seeded torrent the provider will never finish (a thin swarm the debrid
 * side can't pull from — the indexer's seeder count is often stale). Failing it
 * after this many consecutive non-advancing polls turns a minutes-long "0%"
 * spinner into a quick, honest failure, while any real movement (even 0.1%)
 * resets the counter so a genuinely slow download is never cut off.
 */
const MAX_STALL_POLLS = 5;
/** Progress must climb by at least this fraction to count as "advancing". */
const PROGRESS_EPSILON = 0.001;

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
  private readonly maxDownloadPolls: number;
  private readonly maxStallPolls: number;
  private readonly now: () => number;
  private readonly unsubscribeAudio: () => void;

  /** token → stamp, so audio completions map back to the attempt that started them. */
  private readonly loadTokens = new Map<string, Stamp>();
  /**
   * Per-item id → the attemptId of the resolution operation currently allowed to
   * write that item's `resolution`. A superseded resolve that lands late fails
   * this check and commits nothing — the queue cache is stamp-gated, not just the
   * playback FSM (audit A-007). `attemptId` is a session-monotonic counter, so it
   * uniquely identifies an operation.
   */
  private readonly resolutionOp = new Map<QueueItemId, number>();
  /**
   * Pending re-resolve timers for items whose source is still downloading (a
   * stream addon returned `resolving`). Keyed by item id; cleared on supersede,
   * skip, and teardown so a timer can never re-resolve a stale item.
   */
  private readonly downloadTimers = new Map<QueueItemId, ReturnType<typeof setTimeout>>();
  /** How many times we've polled a still-downloading item — bounds the total wait. */
  private readonly downloadPolls = new Map<QueueItemId, number>();
  /**
   * Per still-downloading item: the best download fraction seen so far and how
   * many consecutive polls it has failed to advance. Lets a download that is
   * stuck at the same percent fail fast (stall detection) while a slow-but-moving
   * one keeps its full budget.
   */
  private readonly downloadProgress = new Map<QueueItemId, { best: number; stalls: number }>();
  /** Per-current-item fallback budget (reset when a new item starts). */
  private itemFallback = { reResolved: false };
  /** Consecutive across-item failures with no successful play in between. */
  private consecutiveFailures = 0;
  private readonly listeners = new Set<(state: EngineState) => void>();
  /** Memoized `getState()` result, invalidated when `queue`/`playback` change. */
  private cachedState: EngineState | undefined;

  constructor(resolver: Resolver, audio: AudioBackend, options: EngineOptions = {}) {
    this.scheduler = new Scheduler(resolver);
    this.audio = audio;
    this.idGen = options.idGen ?? counterIdGen();
    this.rng = options.rng ?? Math.random;
    this.prefetchCount = options.prefetchCount ?? 2;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 6;
    this.maxDownloadPolls = options.maxDownloadPolls ?? MAX_DOWNLOAD_POLLS;
    this.maxStallPolls = options.maxStallPolls ?? MAX_STALL_POLLS;
    this.now = options.now ?? Date.now;
    this.queue = { itemsById: {}, canonicalOrder: [], playOrder: [], currentItemId: null, repeat: "off", shuffle: false };
    this.playback = initialState(0);
    this.unsubscribeAudio = audio.subscribe((event) => this.onAudioEvent(event));
  }

  // --- public state ---

  /**
   * The current state. The returned object is **referentially stable** until
   * `queue` or `playback` actually changes — both are replaced immutably, so
   * identity comparison is exact. Returning a fresh object on every call would
   * make any snapshot-based subscriber (React's `useSyncExternalStore`, a memo,
   * a diffing store) believe the state changed constantly and re-render forever.
   */
  getState(): EngineState {
    const cached = this.cachedState;
    if (cached !== undefined && cached.queue === this.queue && cached.playback === this.playback) {
      return cached;
    }
    this.cachedState = { queue: this.queue, playback: this.playback };
    return this.cachedState;
  }

  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unsubscribeAudio();
    this.scheduler.cancelAll();
    this.cancelDownloadPolls();
    this.listeners.clear();
  }

  // --- commands ---

  /** Replace the queue. Does not auto-play; call `play()` to start. */
  setQueue(tracks: TrackRef[], options: CreateQueueOptions = {}): void {
    // A fresh shuffle-play (e.g. the album "Shuffle" button) should start on a
    // random track, not always track 1 with the rest shuffled behind it. Only
    // when the caller didn't pin a start itself.
    const startIndex =
      options.shuffle && options.startIndex === undefined && tracks.length > 0
        ? Math.floor(this.rng() * tracks.length)
        : options.startIndex;
    this.queue = createQueue(tracks, this.idGen, { rng: this.rng, ...options, ...(startIndex !== undefined ? { startIndex } : {}) });
    this.epoch += 1;
    this.scheduler.cancelAll();
    this.cancelDownloadPolls();
    this.loadTokens.clear();
    this.resetBreaker();
    this.dispatch({ type: "RESET", epoch: this.epoch });
  }

  /**
   * Restore a persisted queue (§6), preserving its **identity** — the stable
   * `QueueItemId`s, both orders, and the cursor — which is why persistence stores
   * ids rather than rebuilding them. Every item is forced to `resolution: idle`
   * regardless of what was handed in, so a restored session can never play from a
   * stale bearer URL; the JIT scheduler re-resolves the current/next items fresh.
   * Does not auto-play.
   */
  restoreQueue(queue: Queue): void {
    const itemsById: Record<QueueItemId, QueueItem> = {};
    for (const [id, item] of Object.entries(queue.itemsById)) {
      itemsById[id] = { ...item, resolution: { status: "idle" } };
    }
    this.queue = { ...queue, itemsById };
    this.epoch += 1;
    this.scheduler.cancelAll();
    this.cancelDownloadPolls();
    this.loadTokens.clear();
    this.resolutionOp.clear();
    this.resetBreaker();
    this.dispatch({ type: "RESET", epoch: this.epoch });
    this.notify();
  }

  play(): void {
    if (this.playback.status === "paused") {
      this.dispatch({ type: "PLAY" });
    } else if (this.playback.status === "idle") {
      // Fall back to the head of play order if there's no explicit cursor yet —
      // e.g. after appending the first item to an empty queue (audit A-007).
      const start = this.queue.currentItemId ?? this.queue.playOrder[0] ?? null;
      if (start) {
        this.resetBreaker();
        this.startItem(start);
      }
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
    this.cancelDownloadPolls();
    this.dispatch({ type: "RESET", epoch: this.epoch });
  }

  // --- orchestration ---

  private startItem(itemId: QueueItemId): void {
    if (!getItem(this.queue, itemId)) return;
    this.queue = setCurrent(this.queue, itemId);
    this.epoch += 1; // the current item changed
    this.itemFallback = { reResolved: false };
    const keep = this.nearCursorIds();
    this.scheduler.cancelExcept(keep);
    for (const id of this.downloadTimers.keys()) if (!keep.has(id)) this.forgetDownload(id);
    this.forgetDownload(itemId); // a fresh selection resets this item's download budget
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

  /** Record `stamp` as the operation now allowed to write `itemId`'s resolution. */
  private claimResolution(stamp: Stamp): void {
    this.resolutionOp.set(stamp.itemId, stamp.attemptId);
  }

  /** True only if `stamp` is still the current resolution operation for its item. */
  private ownsResolution(stamp: Stamp): boolean {
    return this.resolutionOp.get(stamp.itemId) === stamp.attemptId;
  }

  /** Kick off a fresh resolution for the current attempt and feed the result to the FSM. */
  private beginResolve(item: QueueItem, stamp: Stamp): void {
    this.claimResolution(stamp);
    this.clearDownloadTimer(stamp.itemId); // supersede a pending poll; keep its budget
    // A poll-driven re-resolve of a downloading item keeps showing "downloading"
    // — flipping it to "resolving" for each round-trip made the UI flicker between
    // the progress bar and "Finding a source…". A genuinely fresh resolve still
    // shows "resolving".
    if (getItem(this.queue, stamp.itemId)?.resolution.status !== "downloading") {
      this.queue = setResolution(this.queue, stamp.itemId, { status: "resolving" });
    }
    this.scheduler.resolve(item, stamp).then((outcome) => {
      // A superseded resolve that completes anyway must commit nothing (audit A-007).
      if (!this.ownsResolution(stamp)) return;
      if (outcome.ok) {
        this.forgetDownload(stamp.itemId); // terminal: reset the download budget
        const picked = pickPlayable(outcome.streams, 0);
        if (!picked) {
          this.queue = setResolution(this.queue, stamp.itemId, { status: "failed", reason: "no playable stream" });
          this.dispatch({ type: "RESOLVE_FAILED", stamp, reason: "no playable stream" });
        } else {
          this.queue = setResolution(this.queue, stamp.itemId, resolvedFrom(outcome.streams, picked.idx, picked.url));
          this.dispatch({ type: "RESOLVED", stamp, url: picked.url });
        }
      } else if ("resolving" in outcome) {
        // A source is being prepared (a debrid download). Show progress and hold
        // the track, re-resolving on the provider's cadence, instead of failing.
        this.onResolving(stamp, outcome.resolving);
      } else {
        this.forgetDownload(stamp.itemId); // terminal: reset the download budget
        this.queue = setResolution(this.queue, stamp.itemId, { status: "failed", ...(outcome.reason ? { reason: outcome.reason } : {}) });
        this.dispatch({ type: "RESOLVE_FAILED", stamp, ...(outcome.reason ? { reason: outcome.reason } : {}) });
      }
      this.notify();
    });
    this.notify();
  }

  /**
   * Handle a `resolving` outcome for the item owning `stamp`: record a
   * `downloading` resolution (progress for the UI) and schedule one re-resolve.
   * Bounded by {@link MAX_DOWNLOAD_POLLS} so a torrent that never finishes fails
   * instead of spinning forever.
   */
  private onResolving(stamp: Stamp, resolving: Resolving): void {
    const polls = (this.downloadPolls.get(stamp.itemId) ?? 0) + 1;
    if (polls > this.maxDownloadPolls) {
      this.forgetDownload(stamp.itemId);
      this.queue = setResolution(this.queue, stamp.itemId, { status: "failed", reason: "download timed out" });
      this.dispatch({ type: "RESOLVE_FAILED", stamp, reason: "download timed out" });
      return;
    }
    // Stall detection: when the provider reports a numeric progress that never
    // advances, the torrent is dead / too poorly seeded to finish. Fail fast with
    // an honest reason rather than spinning at the same percent to the poll cap.
    if (resolving.progress !== undefined) {
      const seen = this.downloadProgress.get(stamp.itemId);
      const best = seen?.best ?? -1;
      const advanced = resolving.progress > best + PROGRESS_EPSILON;
      const stalls = advanced ? 0 : (seen?.stalls ?? 0) + 1;
      this.downloadProgress.set(stamp.itemId, { best: Math.max(best, resolving.progress), stalls });
      if (stalls >= this.maxStallPolls) {
        this.forgetDownload(stamp.itemId);
        this.queue = setResolution(this.queue, stamp.itemId, { status: "failed", reason: "download isn't progressing" });
        this.dispatch({ type: "RESOLVE_FAILED", stamp, reason: "download isn't progressing" });
        return;
      }
    }
    this.downloadPolls.set(stamp.itemId, polls);
    this.queue = setResolution(this.queue, stamp.itemId, {
      status: "downloading",
      ...(resolving.progress !== undefined ? { progress: resolving.progress } : {}),
      ...(resolving.message ? { message: resolving.message } : {}),
    });
    const delayMs = Math.max(MIN_DOWNLOAD_RETRY_MS, (resolving.retryAfter ?? 10) * 1000);
    const timer = setTimeout(() => {
      this.downloadTimers.delete(stamp.itemId);
      if (!this.ownsResolution(stamp)) return; // superseded by a skip/reorder
      this.reResolve(stamp.itemId);
    }, delayMs);
    const prev = this.downloadTimers.get(stamp.itemId);
    if (prev) clearTimeout(prev);
    this.downloadTimers.set(stamp.itemId, timer);
  }

  /** Cancel a pending download re-resolve timer, **keeping** the poll count so the
   *  budget survives the re-resolve it triggers (a poll fires → re-resolve → new
   *  timer; the count must accumulate across that, not reset). */
  private clearDownloadTimer(itemId: QueueItemId): void {
    const timer = this.downloadTimers.get(itemId);
    if (timer) clearTimeout(timer);
    this.downloadTimers.delete(itemId);
  }

  /** Cancel the timer **and** forget the poll count — for a genuinely fresh start
   *  or a terminal (resolved/failed) outcome, where the budget should reset. */
  private forgetDownload(itemId: QueueItemId): void {
    this.clearDownloadTimer(itemId);
    this.downloadPolls.delete(itemId);
    this.downloadProgress.delete(itemId);
  }

  /** Cancel every pending download re-resolve (teardown / queue reset / epoch change). */
  private cancelDownloadPolls(): void {
    for (const timer of this.downloadTimers.values()) clearTimeout(timer);
    this.downloadTimers.clear();
    this.downloadPolls.clear();
    this.downloadProgress.clear();
  }

  /** Try a specific already-resolved stream (same item, new attempt) — the fallback walk. */
  private tryStream(itemId: QueueItemId, streams: Stream[], idx: number, expiresAt: string | undefined): void {
    const url = streams[idx]!.url!;
    const stamp: Stamp = { epoch: this.epoch, itemId, attemptId: ++this.attempt };
    this.claimResolution(stamp); // this synchronous commit now owns the item's resolution
    this.queue = setResolution(this.queue, itemId, resolvedFrom(streams, idx, url, expiresAt));
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
      this.claimResolution(stamp);
      this.queue = setResolution(this.queue, id, { status: "resolving" });
      this.scheduler.resolve(item, stamp).then((outcome) => {
        // Drop a prefetch result that a newer op for the same item has superseded (audit A-007).
        if (!getItem(this.queue, id) || !this.ownsResolution(stamp)) return;
        if (outcome.ok) {
          const picked = pickPlayable(outcome.streams, 0);
          if (picked) {
            this.queue = setResolution(this.queue, id, resolvedFrom(outcome.streams, picked.idx, picked.url));
            // Hand the *immediate* next item's URL to the idle audio element so the
            // browser buffers its opening while the current track plays (§5.2) —
            // this is what makes the dual-element swap gapless. One idle element,
            // so only the very next item is preloaded.
            if (upNext(this.queue)[0] === id) this.audio.preload(picked.url, stampKey(stamp));
          } else {
            this.queue = setResolution(this.queue, id, { status: "failed", reason: "no playable stream" });
          }
        } else if ("resolving" in outcome) {
          // A prefetch download has started; record it for the UI but don't poll
          // here — when this item becomes current, `startItem` re-resolves it and
          // `onResolving` takes over the wait. (Starting the download early still
          // warms it, so it may be ready by the time we arrive.)
          const r = outcome.resolving;
          this.queue = setResolution(this.queue, id, {
            status: "downloading",
            ...(r.progress !== undefined ? { progress: r.progress } : {}),
            ...(r.message ? { message: r.message } : {}),
          });
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
        if (stamp && this.isCurrentStamp(stamp)) {
          this.dispatch({ type: "POSITION", ms: event.ms, ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) });
        }
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
