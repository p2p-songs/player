/**
 * Session/UI state (ARCHITECTURE §6 "Zustand"). Deliberately tiny: which view is
 * showing, the search query, whether the queue panel is open. The **engine
 * remains the source of truth** for queue and playback — this store never
 * duplicates it (§8a).
 */
import { create } from "zustand";

export type View = "home" | "search" | "library" | "addons" | "settings";

interface UiState {
  view: View;
  searchQuery: string;
  queueOpen: boolean;
  setView: (view: View) => void;
  setSearchQuery: (q: string) => void;
  toggleQueue: () => void;
}

export const useUi = create<UiState>((set) => ({
  view: "home",
  searchQuery: "",
  queueOpen: false,
  setView: (view) => set({ view }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
}));
