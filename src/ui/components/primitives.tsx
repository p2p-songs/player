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

/** One row. Always a real button so it is focusable and keyboard-operable. */
export function Row({
  children,
  onClick,
  current = false,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  current?: boolean;
  className?: string;
}) {
  const shared = "flex w-full items-center gap-3 border-b-2 border-border px-4 py-2.5 text-left last:border-b-0";
  if (!onClick) return <div className={cn(shared, current && "bg-accent", className)}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(shared, "transition-colors hover:bg-muted", current && "bg-accent hover:bg-accent", className)}
    >
      {children}
    </button>
  );
}

/**
 * The clickable body of a row that also carries its own trailing actions.
 *
 * `Row` is itself a button, and a button may not nest one — so a row with a
 * Remove control makes its *main area* the button instead. The negative margins
 * pull the hit area back out to the row's full height, so it still behaves like
 * one target rather than a link floating inside a box.
 */
export function RowBody({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-4 -my-2.5 flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted"
    >
      {children}
    </button>
  );
}

export function RowIndex({ children }: { children: ReactNode }) {
  return <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{children}</span>;
}

/** Title over subtitle, both truncating — the shape of nearly every row. */
export function RowMain({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{title}</span>
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
