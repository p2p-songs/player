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
  /**
   * The full now-playing view. A *mode* over the whole shell rather than a
   * `View`, because it covers the sidebar and the bar too and returns you to
   * exactly where you were — nothing about which screen you were on changes.
   */
  nowPlayingOpen: boolean;
  /**
   * The playback problem the user dismissed, keyed by its text. It lives here
   * rather than in `PlaybackAlert` because the alert renders in two places (the
   * shell and the now-playing overlay) and component state would let a dismissal
   * come back the moment you minimised. Keyed rather than boolean so the *next*
   * failure still announces itself — see the component.
   */
  dismissedAlert: string | undefined;
  setDismissedAlert: (key: string | undefined) => void;
  setView: (view: View) => void;
  openDetail: (detail: Detail) => void;
  closeDetail: () => void;
  setSearchQuery: (q: string) => void;
  toggleQueue: () => void;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
}

export const useUi = create<UiState>((set) => ({
  view: "home",
  detail: [],
  searchQuery: "",
  queueOpen: false,
  nowPlayingOpen: false,
  dismissedAlert: undefined,
  setDismissedAlert: (dismissedAlert) => set({ dismissedAlert }),
  setView: (view) => set({ view, detail: [] }),
  openDetail: (detail) => set((s) => ({ detail: [...s.detail, detail] })),
  closeDetail: () => set((s) => ({ detail: s.detail.slice(0, -1) })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  openNowPlaying: () => set({ nowPlayingOpen: true }),
  closeNowPlaying: () => set({ nowPlayingOpen: false }),
}));
