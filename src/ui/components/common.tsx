/** Small shared presentation pieces: artwork, the panel-9 states, time format. */
import type { ReactNode } from "react";

export function formatTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Cover art, falling back to a generated initial when an addon supplies none. */
export function Artwork({ src, alt, size = 40 }: { src?: string | undefined; alt: string; size?: number }) {
  if (src) {
    return <img className="art" src={src} alt="" width={size} height={size} aria-hidden="true" />;
  }
  return (
    <div className="art-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {alt.trim().charAt(0).toUpperCase() || "♪"}
    </div>
  );
}

/** The empty/loading/error states from mockup panel 9. */
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
    <div className="state">
      <div className="state-icon">{icon}</div>
      <div className="state-title">{title}</div>
      {message ? <div className="state-msg">{message}</div> : null}
      {action}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <StateBlock icon={<div className="spinner" />} title={label} />;
}

/** "Some addons didn't respond" — partial results are still worth showing. */
export function PartialBanner({ message, danger = false }: { message: string; danger?: boolean }) {
  return (
    <div className={danger ? "banner banner-danger" : "banner"} role="status">
      <span aria-hidden="true">{danger ? "⚠" : "☁"}</span>
      <span>{message}</span>
    </div>
  );
}
