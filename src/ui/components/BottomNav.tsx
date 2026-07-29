/**
 * Primary navigation on narrow screens — a bottom tab bar, the phone-native
 * shape. Hidden at `md` and up, where the {@link Sidebar} rail takes over. Same
 * NAV list and store wiring as the rail, so the two never drift.
 */
import { useUi } from "../../app/store.js";
import { NAV } from "./Sidebar.js";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);

  return (
    <nav
      aria-label="Primary"
      className="flex items-stretch border-t-2 border-border bg-chrome text-chrome-foreground md:hidden"
    >
      {NAV.map((item) => {
        const active = view === item.view;
        return (
          <button
            key={item.view}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => setView(item.view)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] tracking-wide uppercase transition-colors",
              active ? "text-accent" : "text-chrome-muted hover:text-chrome-foreground",
            )}
          >
            <span className="text-base leading-none" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
