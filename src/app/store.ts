/**
 * Session/UI state (ARCHITECTURE §6 "Zustand"). Deliberately tiny: which view is
 * showing, the search query, whether the queue panel is open. The **engine
 * remains the source of truth** for queue and playback — this store never
 * duplicates it (§8a).
 */
import { create } from "zustand";

export type View = "home" | "search" | "library" | "addons" | "settings";

/** One level of drill-down over the current view. */
export interface Detail {
  kind: "album" | "artist";
  id: string;
  name: string;
}

interface UiState {
  view: View;
  /**
   * The drill-down stack over `view` — search → artist → album, library →
   * either. A stack rather than a router for now (§7), but it lives here beside
   * `view` so that switching primary view *atomically* drops it: keeping it in
   * the shell meant a frame where the new view rendered the old view's detail.
   */
  detail: Detail[];
  searchQuery: string;
  queueOpen: boolean;
  setView: (view: View) => void;
  openDetail: (detail: Detail) => void;
  closeDetail: () => void;
  setSearchQuery: (q: string) => void;
  toggleQueue: () => void;
}

export const useUi = create<UiState>((set) => ({
  view: "home",
  detail: [],
  searchQuery: "",
  queueOpen: false,
  setView: (view) => set({ view, detail: [] }),
  openDetail: (detail) => set((s) => ({ detail: [...s.detail, detail] })),
  closeDetail: () => set((s) => ({ detail: s.detail.slice(0, -1) })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
}));
