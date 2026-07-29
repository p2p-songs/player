/**
 * The app shell (mockup panel 2): sidebar + routed main + persistent player bar.
 * Navigation is store state rather than a router — deliberate for this first
 * slice; a typed router (§7) lands when deep links/history actually matter.
 */
import { useUi } from "../app/store.js";
import { Sidebar } from "./components/Sidebar.js";
import { BottomNav } from "./components/BottomNav.js";
import { PlayerBar } from "./components/PlayerBar.js";
import { PlaybackAlert } from "./components/PlaybackAlert.js";
import { QueueDrawer } from "./components/QueueDrawer.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SearchScreen } from "./screens/SearchScreen.js";
import { AlbumScreen } from "./screens/AlbumScreen.js";
import { ArtistScreen } from "./screens/ArtistScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { AddonsScreen } from "./screens/AddonsScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { NowPlayingScreen } from "./screens/NowPlayingScreen.js";
import { usePersistSession } from "./viewmodels/usePersistSession.js";

export function AppShell() {
  const view = useUi((s) => s.view);
  const detail = useUi((s) => s.detail);
  const openDetail = useUi((s) => s.openDetail);
  const closeDetail = useUi((s) => s.closeDetail);

  // Durable session: hydrate the queue on boot, autosave it, record plays.
  usePersistSession();

  // The drill-down stack is shared by every view that can reach a detail
  // screen, so search → artist → album and library → artist → album are the
  // same code path and Back unwinds either one the way it came.
  const openAlbum = (id: string, name: string) => openDetail({ kind: "album", id, name });
  const openArtist = (id: string, name: string) => openDetail({ kind: "artist", id, name });
  const top = detail[detail.length - 1];

  return (
    // Mobile: a single column — scrolling content, then the compact player bar,
    // then the bottom nav. Desktop (md+): the original sidebar + content grid
    // with the player bar spanning the bottom row.
    <div className="flex h-full flex-col md:grid md:grid-cols-[13rem_1fr] md:grid-rows-[1fr_var(--player-bar-h)]">
      <Sidebar />
      <main className="min-h-0 flex-1 overflow-y-auto bg-background">
        {top?.kind === "album" ? (
          <AlbumScreen albumId={top.id} onBack={closeDetail} />
        ) : top?.kind === "artist" ? (
          <ArtistScreen
            artistId={top.id}
            artistName={top.name}
            onBack={closeDetail}
            onOpenAlbum={openAlbum}
          />
        ) : view === "home" ? (
          <HomeScreen />
        ) : view === "search" ? (
          <SearchScreen onOpenAlbum={openAlbum} onOpenArtist={openArtist} />
        ) : view === "library" ? (
          <LibraryScreen onOpenAlbum={openAlbum} onOpenArtist={openArtist} />
        ) : view === "addons" ? (
          <AddonsScreen />
        ) : (
          <SettingsScreen />
        )}
      </main>
      <PlaybackAlert />
      <PlayerBar />
      <BottomNav />
      <QueueDrawer />
      <NowPlayingScreen />
    </div>
  );
}
