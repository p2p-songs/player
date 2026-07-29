/**
 * App-level visual primitives, layered over the RetroUI set in
 * `src/components/ui/`.
 *
 * The rule this file exists to enforce: **screens compose and lay out; they do
 * not carry visual utility classes.** Every border, shadow, colour and type
 * decision lives here or in `components/ui/*`. That discipline is what keeps
 * the look swappable — Tailwind otherwise scatters styling across every call
 * site, and a thousand `border-2 border-black shadow-md` in screens is the same
 * failure as a thousand hardcoded hex values, with nothing able to catch it.
 */
import type { ReactNode } from "react";
import { PlayIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cn("font-head text-3xl tracking-tight uppercase", className)}>{children}</h1>;
}

/** The shouted micro-label above each block — a lot of this design's voice. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("font-head text-xs uppercase tracking-[0.14em] text-muted-foreground mt-7 mb-3", className)}>
      {children}
    </h2>
  );
}

export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-muted-foreground", className)}>{children}</span>;
}

/** A bordered list container. `flush` drops the frame when a panel already has one. */
export function Rows({
  children,
  flush = false,
  className,
}: {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden bg-card", flush ? "" : "border-2 border-border shadow-md", className)}>
      {children}
    </div>
  );
}

/**
 * One row. Always a real button so it is focusable and keyboard-operable.
 *
 * **The frame owns the background, not the button.** A row can carry its own
 * trailing `action`, and a button may not nest one; the obvious fix — a body
 * button beside the action — made the hover highlight stop short of the action
 * and split the row visibly in two. So the frame is what highlights, the body
 * button is transparent and padded clear of the action, and the action layers
 * over the frame. One row, one hover surface.
 *
 * The frame is also the `group`, which is how a row's contents (a play badge on
 * artwork, a reveal-on-hover action) can respond to the row being hovered.
 */
export function Row({
  children,
  onClick,
  action,
  current = false,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** A control rendered at the trailing edge, outside the row's own button. */
  action?: ReactNode;
  current?: boolean;
  className?: string;
}) {
  const body = cn(
    "flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left",
    action ? "pr-12" : "pr-4",
  );
  return (
    <div
      className={cn(
        "group relative flex w-full items-center border-b-2 border-border transition-colors last:border-b-0",
        // The current track: a steady tint plus an inset accent bar down its
        // leading edge (inset shadow, so it adds no width and rows stay aligned).
        // Non-current rows tint only on hover — so the playing row always stands
        // apart, not just under the pointer.
        current
          ? "bg-muted shadow-[inset_4px_0_0_0_var(--accent)]"
          : onClick
            ? "hover:bg-muted"
            : undefined,
        className,
      )}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className={body}>
          {children}
        </button>
      ) : (
        <div className={body}>{children}</div>
      )}
      {action ? <div className="absolute inset-y-0 right-2 flex items-center">{action}</div> : null}
    </div>
  );
}

/**
 * A row's trailing control, revealed on hover or focus.
 *
 * Removing something is infrequent and mildly destructive, so it should not be
 * the loudest, most-repeated element on a screen — four `Remove` buttons in a
 * column read as the page's primary action, which they are the opposite of. It
 * appears the moment the pointer is on the row, which is the moment anyone looks
 * for it, and `focus-visible` keeps it reachable by keyboard.
 *
 * `label` carries the whole meaning, so it should name the item and the actual
 * verb for its kind ("Unfollow Taylor Swift", not "Remove").
 */
export function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center border-2 border-transparent text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:border-border hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100"
    >
      {children}
    </button>
  );
}

/**
 * A track number. Where the row plays, it swaps for a play badge on hover — the
 * artwork-badge affordance for rows that have no artwork to put it on.
 */
/**
 * A tiny equalizer that marks the track a list is *currently* playing — the
 * persistent "this one is playing" cue the hover play-badge could never be
 * (it looks identical on every row the pointer touches). Animated while playing,
 * held still when paused. `currentColor`, so it reads on a highlighted row too.
 */
export function NowPlayingBars({ animated = true, className }: { animated?: boolean; className?: string }) {
  return (
    <span className={cn("flex h-3.5 items-end justify-center gap-[2px]", className)} aria-hidden="true">
      {[0, 200, 400].map((delay, i) => (
        <span
          key={delay}
          className={cn("w-[3px] origin-bottom bg-current", animated && "animate-vu")}
          style={{ height: `${[9, 14, 7][i]}px`, animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function RowIndex({
  children,
  playable = false,
  state,
}: {
  children: ReactNode;
  playable?: boolean;
  /** When this row is the current track: show the equalizer instead of the number. */
  state?: "playing" | "paused";
}) {
  const base = "w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground";
  if (state) {
    return (
      <span className={cn(base, "grid place-items-center text-accent")}>
        <NowPlayingBars animated={state === "playing"} />
      </span>
    );
  }
  if (!playable) return <span className={base}>{children}</span>;
  return (
    <span className={cn(base, "relative grid place-items-center")}>
      <span className="transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">{children}</span>
      <PlayIcon
        className="absolute size-3.5 text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        fill="currentColor"
        aria-hidden="true"
      />
    </span>
  );
}

/** Title over subtitle, both truncating — the shape of nearly every row. */
export function RowMain({ title, sub, current = false }: { title: ReactNode; sub?: ReactNode; current?: boolean }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn("block truncate font-medium", current && "text-accent")}>{title}</span>
      {sub ? <span className="block truncate text-sm text-muted-foreground">{sub}</span> : null}
    </span>
  );
}

export function RowTime({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{children}</span>;
}

/**
 * A button on a **chrome** surface (the player bar, the now-playing view).
 *
 * RetroUI's `outline` variant is built for the cream canvas: it sets
 * `bg-background` and no text colour, so on chrome it inherits
 * `--chrome-foreground` and renders cream on cream — invisible, which is exactly
 * what Minimize/Like/Album did. Chrome needs its own foreground/background
 * pairing rather than a canvas button with patches on it.
 */
export function ChromeButton({
  children,
  onClick,
  label,
  pressed,
  active = false,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  label?: string;
  pressed?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        "inline-flex items-center gap-2 border-2 px-4 py-2 text-sm font-medium transition-colors",
        active
          ? "border-accent bg-accent text-accent-foreground"
          : "border-chrome-muted text-chrome-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Empty / loading / error blocks. */
export function StateBlock({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-11 text-center">
      <div className="text-3xl opacity-50" aria-hidden="true">
        {icon}
      </div>
      <div className="font-head uppercase">{title}</div>
      {message ? <p className="max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <StateBlock
      icon={<div className="size-6 animate-spin border-2 border-border border-t-primary" />}
      title={label}
    />
  );
}

/** "Some addons didn't respond" — partial results are still worth showing. */
export function PartialBanner({ message, danger = false }: { message: string; danger?: boolean }) {
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-center gap-3 border-2 border-border bg-card px-4 py-2.5 text-sm shadow-sm",
        danger ? "border-l-8 border-l-destructive" : "border-l-8 border-l-accent",
      )}
    >
      <span aria-hidden="true">{danger ? "⚠" : "☁"}</span>
      <span>{message}</span>
    </div>
  );
}
