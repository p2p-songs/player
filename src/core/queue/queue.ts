/**
 * Pure queue operations (ARCHITECTURE §4a). Every function returns a new `Queue`;
 * none mutate their input. The mutation invariants:
 * - Position is `currentItemId`; next/prev step along **`playOrder`**.
 * - Shuffle is **non-destructive**: it only recomputes `playOrder`, keeping
 *   `currentItemId` first; `canonicalOrder` and `itemsById` are untouched.
 * - Insert/remove/reorder operate on ids and keep `itemsById`, `canonicalOrder`,
 *   and `playOrder` mutually consistent — no stale index outlives a mutation.
 * - The same track may appear twice (distinct `QueueItemId`s).
 */
import type { IdGen, Queue, QueueItem, QueueItemId, RepeatMode, Rng, TrackRef, ResolutionState } from "./types.js";

export function emptyQueue(repeat: RepeatMode = "off"): Queue {
  return { itemsById: {}, canonicalOrder: [], playOrder: [], currentItemId: null, repeat, shuffle: false };
}

function makeItem(track: TrackRef, idGen: IdGen): QueueItem {
  return { id: idGen(), track, resolution: { status: "idle" } };
}

/** Fisher-Yates shuffle of a copy of `ids`, using the injected rng. */
function shuffled(ids: QueueItemId[], rng: Rng): QueueItemId[] {
  const out = ids.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Derive `playOrder` from `canonicalOrder`: identity when shuffle off; current-first shuffle when on. */
function derivePlayOrder(canonicalOrder: QueueItemId[], currentItemId: QueueItemId | null, shuffle: boolean, rng: Rng): QueueItemId[] {
  if (!shuffle) return canonicalOrder.slice();
  const rest = canonicalOrder.filter((id) => id !== currentItemId);
  const shuffledRest = shuffled(rest, rng);
  return currentItemId && canonicalOrder.includes(currentItemId) ? [currentItemId, ...shuffledRest] : shuffledRest;
}

export interface CreateQueueOptions {
  repeat?: RepeatMode;
  shuffle?: boolean;
  rng?: Rng;
  /** Which track index to start on (default 0). */
  startIndex?: number;
}

export function createQueue(tracks: TrackRef[], idGen: IdGen, options: CreateQueueOptions = {}): Queue {
  const rng = options.rng ?? Math.random;
  const items = tracks.map((t) => makeItem(t, idGen));
  const itemsById: Record<QueueItemId, QueueItem> = {};
  for (const it of items) itemsById[it.id] = it;
  const canonicalOrder = items.map((it) => it.id);
  const currentItemId = canonicalOrder[options.startIndex ?? 0] ?? null;
  const shuffle = options.shuffle ?? false;
  return {
    itemsById,
    canonicalOrder,
    playOrder: derivePlayOrder(canonicalOrder, currentItemId, shuffle, rng),
    currentItemId,
    repeat: options.repeat ?? "off",
    shuffle,
  };
}

export function getItem(queue: Queue, id: QueueItemId | null): QueueItem | undefined {
  return id ? queue.itemsById[id] : undefined;
}

export function currentItem(queue: Queue): QueueItem | undefined {
  return getItem(queue, queue.currentItemId);
}

/**
 * The id to play next. `auto` = triggered by a track ending (honors `repeat:"one"`);
 * a manual skip passes `auto:false` and always advances to the next distinct item.
 * Returns `null` at the end when not repeating.
 */
export function nextId(queue: Queue, options: { auto?: boolean } = {}): QueueItemId | null {
  const { playOrder, currentItemId, repeat } = queue;
  if (!currentItemId) return playOrder[0] ?? null;
  if (options.auto && repeat === "one") return currentItemId;
  const i = playOrder.indexOf(currentItemId);
  if (i === -1) return playOrder[0] ?? null;
  if (i + 1 < playOrder.length) return playOrder[i + 1]!;
  return repeat === "all" ? playOrder[0] ?? null : null;
}

/** The id to play on "previous". Wraps under `repeat:"all"`, else clamps to null before the first. */
export function prevId(queue: Queue): QueueItemId | null {
  const { playOrder, currentItemId, repeat } = queue;
  if (!currentItemId) return null;
  const i = playOrder.indexOf(currentItemId);
  if (i <= 0) return repeat === "all" ? playOrder[playOrder.length - 1] ?? null : null;
  return playOrder[i - 1]!;
}

/** The ids after the current one in **play** order — the correct "up next" (right under shuffle). */
export function upNext(queue: Queue): QueueItemId[] {
  if (!queue.currentItemId) return queue.playOrder.slice();
  const i = queue.playOrder.indexOf(queue.currentItemId);
  return i === -1 ? [] : queue.playOrder.slice(i + 1);
}

/** Set the current item (id must exist). No-op if the id is unknown. */
export function setCurrent(queue: Queue, id: QueueItemId): Queue {
  if (!queue.itemsById[id]) return queue;
  return { ...queue, currentItemId: id };
}

export function setRepeat(queue: Queue, repeat: RepeatMode): Queue {
  return { ...queue, repeat };
}

/** Toggle shuffle non-destructively — only `playOrder` (and `shuffle`) change. */
export function setShuffle(queue: Queue, on: boolean, rng: Rng = Math.random): Queue {
  if (on === queue.shuffle) return queue;
  return { ...queue, shuffle: on, playOrder: derivePlayOrder(queue.canonicalOrder, queue.currentItemId, on, rng) };
}

/** Append tracks to the end of the queue (both orders). */
export function append(queue: Queue, tracks: TrackRef[], idGen: IdGen): Queue {
  const items = tracks.map((t) => makeItem(t, idGen));
  if (items.length === 0) return queue;
  const itemsById = { ...queue.itemsById };
  for (const it of items) itemsById[it.id] = it;
  const newIds = items.map((it) => it.id);
  return {
    ...queue,
    itemsById,
    canonicalOrder: [...queue.canonicalOrder, ...newIds],
    // Appending after the current run of play is the least-surprising placement,
    // in both shuffle modes.
    playOrder: [...queue.playOrder, ...newIds],
  };
}

/** Insert tracks into `canonicalOrder` right after `afterId` (or at the front when null). */
export function insertAfter(queue: Queue, afterId: QueueItemId | null, tracks: TrackRef[], idGen: IdGen): Queue {
  const items = tracks.map((t) => makeItem(t, idGen));
  if (items.length === 0) return queue;
  const itemsById = { ...queue.itemsById };
  for (const it of items) itemsById[it.id] = it;
  const newIds = items.map((it) => it.id);

  const canonicalOrder = queue.canonicalOrder.slice();
  const cAt = afterId ? canonicalOrder.indexOf(afterId) : -1;
  canonicalOrder.splice(cAt + 1, 0, ...newIds);

  // In play order, insert right after the same anchor if present, else append.
  const playOrder = queue.playOrder.slice();
  const pAt = afterId ? playOrder.indexOf(afterId) : -1;
  if (afterId && pAt !== -1) playOrder.splice(pAt + 1, 0, ...newIds);
  else playOrder.push(...newIds);

  return { ...queue, itemsById, canonicalOrder, playOrder };
}

/** Remove an item by id, keeping every structure consistent. If it was current, advance first. */
export function removeItem(queue: Queue, id: QueueItemId): Queue {
  if (!queue.itemsById[id]) return queue;

  let currentItemId = queue.currentItemId;
  if (currentItemId === id) {
    // Advance along play order before dropping; fall back to the previous, then null.
    const i = queue.playOrder.indexOf(id);
    const after = queue.playOrder[i + 1];
    const before = queue.playOrder[i - 1];
    currentItemId = after ?? before ?? null;
  }

  const itemsById = { ...queue.itemsById };
  delete itemsById[id];
  return {
    ...queue,
    itemsById,
    canonicalOrder: queue.canonicalOrder.filter((x) => x !== id),
    playOrder: queue.playOrder.filter((x) => x !== id),
    currentItemId,
  };
}

/**
 * Move an item to a new index in `canonicalOrder` (user reorder). When shuffle is
 * off, `playOrder` follows canonical; when on, the shuffled `playOrder` is left
 * intact (reordering the user's canonical list shouldn't reshuffle playback).
 */
export function moveItem(queue: Queue, id: QueueItemId, toIndex: number): Queue {
  const from = queue.canonicalOrder.indexOf(id);
  if (from === -1) return queue;
  const canonicalOrder = queue.canonicalOrder.slice();
  canonicalOrder.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, canonicalOrder.length));
  canonicalOrder.splice(clamped, 0, id);
  return { ...queue, canonicalOrder, playOrder: queue.shuffle ? queue.playOrder : canonicalOrder.slice() };
}

/** Set an item's resolution state (memory-only; §6). No-op if the id is unknown. */
export function setResolution(queue: Queue, id: QueueItemId, resolution: ResolutionState): Queue {
  const item = queue.itemsById[id];
  if (!item) return queue;
  return { ...queue, itemsById: { ...queue.itemsById, [id]: { ...item, resolution } } };
}

/** Force every item back to `resolution: idle` — used on hydration (§6). */
export function resetResolutions(queue: Queue): Queue {
  const itemsById: Record<QueueItemId, QueueItem> = {};
  for (const [id, item] of Object.entries(queue.itemsById)) {
    itemsById[id] = item.resolution.status === "idle" ? item : { ...item, resolution: { status: "idle" } };
  }
  return { ...queue, itemsById };
}
