/**
 * Debounced, flushable autosave for the durable queue snapshot (ARCHITECTURE §6).
 *
 * Two rules make this correct, and both were bugs in the first cut:
 *
 * - **Only queue changes reschedule.** The engine notifies on every position
 *   tick (~4×/s while playing). A debounce keyed on *any* notification is reset
 *   faster than it can ever fire, so the queue was never saved during playback.
 *   `schedule` is a no-op unless the snapshot differs from the durable one —
 *   `Engine.getState()` is referentially stable, so identity is the whole test.
 * - **A pending snapshot survives.** Clearing the timer on teardown drops the
 *   newest edit; `flush()` writes it out instead. A rejected write keeps the
 *   snapshot pending so the next edit or flush retries it, rather than silently
 *   leaving a stale durable copy behind.
 *
 * `flush()` is best-effort by nature: it starts an async store write during page
 * lifecycle events, and a hard kill can still cut it short. Firing on
 * `visibilitychange`→hidden (not just `pagehide`) is what makes that rare.
 */
import type { Queue } from "../queue/types.js";

export const AUTOSAVE_DEBOUNCE_MS = 800;

export interface SessionAutosaveOptions {
  /** Durable write — normally `repository.saveQueue`. */
  save: (queue: Queue) => Promise<void>;
  debounceMs?: number;
  /** Called when a write rejects. The snapshot stays pending regardless. */
  onError?: (error: unknown) => void;
}

export class SessionAutosave {
  private readonly save: (queue: Queue) => Promise<void>;
  private readonly debounceMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;

  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Newest snapshot not yet durably written. */
  private pending: Queue | undefined;
  /** Newest snapshot known to be durably written. */
  private durable: Queue | undefined;
  private writing = false;
  private disposed = false;

  constructor(options: SessionAutosaveOptions) {
    this.save = options.save;
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.onError = options.onError;
  }

  /**
   * Adopt an already-durable snapshot (the one just hydrated from the store)
   * so restoring a session doesn't immediately write it straight back.
   */
  markDurable(queue: Queue): void {
    this.durable = queue;
  }

  /** Note a new queue snapshot; writes it once the debounce goes quiet. */
  schedule(queue: Queue): void {
    if (this.disposed || queue === this.durable) return;
    this.pending = queue;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.write();
    }, this.debounceMs);
  }

  /** Write the pending snapshot now, skipping the remaining debounce. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    void this.write();
  }

  /** Flush whatever is outstanding, then stop accepting work. */
  dispose(): void {
    this.flush();
    this.disposed = true;
  }

  private async write(): Promise<void> {
    const snapshot = this.pending;
    if (snapshot === undefined || this.writing) return; // a running write picks up the newer snapshot
    this.writing = true;
    try {
      await this.save(snapshot);
      this.durable = snapshot;
      if (this.pending === snapshot) this.pending = undefined;
    } catch (error) {
      this.onError?.(error); // `pending` stays set — retried on the next edit or flush
    } finally {
      this.writing = false;
      // Only chase a *newer* snapshot; a failed write must not spin here.
      if (this.pending !== undefined && this.pending !== snapshot) void this.write();
    }
  }
}
