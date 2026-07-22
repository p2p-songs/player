/**
 * Session/UI state (ARCHITECTURE §6 "Zustand"). Deliberately tiny: which view is
 * showing, the search query, whether the queue panel is open. The **engine
 * remains the source of truth** for queue and playback — this store never
 * duplicates it (§8a).
 */
import { create } from "zustand";
import { DEFAULT_THEME_ID } from "../ui/theme/index.js";

export type View = "home" | "search" | "library" | "addons" | "settings";

interface UiState {
  view: View;
  searchQuery: string;
  queueOpen: boolean;
  /** Active theme id. Lives here (not in a query) so switching is synchronous —
   *  a theme that arrived a frame late would repaint the whole app. */
  themeId: string;
  setView: (view: View) => void;
  setSearchQuery: (q: string) => void;
  toggleQueue: () => void;
  setThemeId: (id: string) => void;
}

export const useUi = create<UiState>((set) => ({
  view: "home",
  searchQuery: "",
  queueOpen: false,
  themeId: DEFAULT_THEME_ID,
  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  setThemeId: (themeId) => set({ themeId }),
}));
