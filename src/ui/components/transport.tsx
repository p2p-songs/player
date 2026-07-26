/**
 * Transport controls — the vocabulary the player bar and the now-playing view
 * both compose from, so the two surfaces can't drift apart.
 *
 * Two decisions worth keeping:
 *
 * **Icons are drawn, not typed.** These were emoji (`⤨ ⏮ 🔁`). The repeat glyph
 * rendered in the system's *colour* emoji font — a blue-and-white badge sitting
 * in a burnt-orange-and-ink design — and the rest inherited whatever weight the
 * platform felt like. Lucide paths take `currentColor` and a stroke width, so
 * they're part of the design rather than a guest in it.
 *
 * **The scrubber commits on release.** A slider bound straight to `seek` issues
 * a seek per pointer move: dozens of `currentTime` writes, each one re-buffering
 * the element, so the audio stutters through the drag and lands late. Radix
 * splits `onValueChange` (live, cheap) from `onValueCommit` (on release), which
 * is exactly the shape the fix wants.
 */
import { useState, type ReactNode } from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react";
import { formatTime } from "./common.js";
import { cn } from "@/lib/utils";

/** An icon button on chrome. `active` marks a latched mode (shuffle, repeat). */
export function TransportButton({
  children,
  label,
  onClick,
  disabled,
  active = false,
  pressed,
  className,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-8 place-items-center transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        active ? "text-accent" : "text-chrome-foreground hover:text-accent",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The one filled control. Round against a design that is otherwise all square
 * corners, which is most of why the eye lands on it first.
 */
export function PlayButton({
  isPlaying,
  busy = false,
  disabled = false,
  onClick,
  size = "md",
}: {
  isPlaying: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  size?: "md" | "lg";
}) {
  const Icon = busy ? LoaderCircleIcon : isPlaying ? PauseIcon : PlayIcon;
  return (
    <button
      type="button"
      aria-label={busy ? "Loading" : isPlaying ? "Pause" : "Play"}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border-2 border-border bg-accent text-accent-foreground shadow-chrome transition-all",
        "hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-chrome",
        size === "lg" ? "size-16" : "size-10",
      )}
    >
      <Icon
        className={cn(busy && "animate-spin", size === "lg" ? "size-7" : "size-5")}
        // Play reads as off-centre in a circle unless it's nudged right.
        style={!busy && !isPlaying ? { marginLeft: size === "lg" ? 3 : 2 } : undefined}
        fill={busy ? "none" : "currentColor"}
      />
    </button>
  );
}

/**
 * Position and duration around a draggable bar. The thumb only appears on hover
 * or focus — at rest this should read as a progress bar, which is what it is
 * 99% of the time.
 */
export function Scrubber({
  positionMs,
  durationMs,
  onSeek,
  disabled = false,
  size = "sm",
}: {
  positionMs: number;
  durationMs: number | undefined;
  onSeek: (ms: number) => void;
  disabled?: boolean;
  size?: "sm" | "lg";
}) {
  // While dragging, the handle follows the pointer and the clock shows where
  // you'd land. `engine.seek` dispatches its POSITION synchronously, so
  // dropping this on commit hands straight over with no snap-back.
  const [dragMs, setDragMs] = useState<number | undefined>(undefined);
  const max = durationMs && durationMs > 0 ? durationMs : 1;
  const shown = Math.min(dragMs ?? positionMs, max);
  const inert = disabled || !durationMs;

  return (
    <div className={cn("flex w-full items-center", size === "lg" ? "gap-4" : "gap-2.5")}>
      <Time size={size}>{formatTime(shown)}</Time>
      <SliderPrimitive.Root
        className="group relative flex h-4 flex-1 touch-none items-center select-none"
        min={0}
        max={max}
        step={1000}
        value={[shown]}
        disabled={inert}
        onValueChange={([v]) => setDragMs(v)}
        onValueCommit={([v]) => {
          setDragMs(undefined);
          if (v !== undefined) onSeek(v);
        }}
      >
        <SliderPrimitive.Track
          className={cn(
            "relative w-full grow overflow-hidden bg-chrome-track",
            size === "lg" ? "h-2.5" : "h-1.5",
          )}
        >
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Seek"
          className={cn(
            "block size-4 rounded-full border-2 border-border bg-accent opacity-0 transition-opacity",
            "group-hover:opacity-100 focus-visible:opacity-100",
            inert && "group-hover:opacity-0",
          )}
        />
      </SliderPrimitive.Root>
      <Time size={size}>{formatTime(durationMs)}</Time>
    </div>
  );
}

/**
 * Shown in the scrubber's place while a track's source is still being prepared
 * (a stream addon is fetching it). A determinate fill when we have progress, a
 * gentle pulse when we don't — either way it reads as "working, not stuck", which
 * a frozen 0:00 scrubber does not. Not interactive: there's nothing to seek yet.
 */
export function DownloadBar({ progress, size = "sm" }: { progress?: number; size?: "sm" | "lg" }) {
  const pct = progress !== undefined ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : undefined;
  return (
    <div className={cn("flex w-full items-center", size === "lg" ? "gap-4" : "gap-2.5")} role="status" aria-live="polite">
      <span className={cn("shrink-0 whitespace-nowrap text-chrome-muted", size === "lg" ? "text-sm" : "text-xs")}>
        Downloading{pct !== undefined ? `… ${pct}%` : "…"}
      </span>
      <div className={cn("relative w-full grow overflow-hidden bg-chrome-track", size === "lg" ? "h-2.5" : "h-1.5")}>
        {pct === undefined ? (
          <div className="absolute inset-y-0 left-0 w-1/3 animate-pulse bg-primary/70" />
        ) : (
          <div className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

function Time({ children, size }: { children: ReactNode; size: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "shrink-0 text-center font-mono tabular-nums text-chrome-muted",
        size === "lg" ? "min-w-12 text-sm" : "min-w-9 text-[11px]",
      )}
    >
      {children}
    </span>
  );
}

/** Bars that move while audio does. Decoration, and the cheapest "it's alive". */
export function PlayingBars({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-4 items-end gap-0.5", className)} aria-hidden="true">
      {[0, 150, 300, 450].map((delay, i) => (
        <span
          key={delay}
          className="w-1 origin-bottom bg-accent animate-vu"
          style={{ height: `${[10, 16, 12, 14][i]}px`, animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
