/** Primary navigation. Pure presentation over the UI store. */
import { HomeIcon, SearchIcon, LibraryIcon, PuzzleIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { useUi, type View } from "../../app/store.js";
import { cn } from "@/lib/utils";

/** Shared by the desktop rail ({@link Sidebar}) and the mobile bar (`BottomNav`). */
export const NAV: { view: View; icon: LucideIcon; label: string }[] = [
  { view: "home", icon: HomeIcon, label: "Home" },
  { view: "search", icon: SearchIcon, label: "Search" },
  { view: "library", icon: LibraryIcon, label: "Library" },
  { view: "addons", icon: PuzzleIcon, label: "Addons" },
  { view: "settings", icon: SettingsIcon, label: "Settings" },
];

/** The left rail — desktop only (the mobile shell swaps in `BottomNav`). */
export function Sidebar() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);

  return (
    <nav
      aria-label="Primary"
      className="hidden flex-col gap-6 overflow-y-auto border-r-2 border-border bg-chrome py-5 text-chrome-foreground md:flex"
    >
      <div className="px-5 font-head text-2xl tracking-[0.18em] text-primary">PHONO</div>
      <div className="flex flex-col">
        {NAV.map((item) => {
          const active = view === item.view;
          return (
            <button
              key={item.view}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setView(item.view)}
              className={cn(
                // Full-bleed selection rather than an inset pill — the block
                // running edge to edge is what makes the chrome read as printed.
                "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors",
                active
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-chrome-muted hover:bg-secondary-hover hover:text-chrome-foreground",
              )}
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
