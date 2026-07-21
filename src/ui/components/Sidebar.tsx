/** Primary navigation (mockup panel 1/2). Pure presentation over the UI store. */
import { useUi, type View } from "../../app/store.js";

const NAV: { view: View; icon: string; label: string }[] = [
  { view: "home", icon: "⌂", label: "Home" },
  { view: "search", icon: "⌕", label: "Search" },
  { view: "library", icon: "▤", label: "Library" },
  { view: "addons", icon: "⧉", label: "Addons" },
  { view: "settings", icon: "⚙", label: "Settings" },
];

export function Sidebar() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);

  return (
    <nav className="sidebar" aria-label="Primary">
      <div className="brand">PHONO</div>
      <div className="nav">
        {NAV.map((item) => (
          <button
            key={item.view}
            type="button"
            className="nav-item"
            aria-current={view === item.view ? "page" : undefined}
            onClick={() => setView(item.view)}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
