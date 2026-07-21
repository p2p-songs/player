/**
 * The app shell (mockup panel 2): sidebar + routed main + persistent player bar.
 * Navigation is local state rather than a router — deliberate for this first
 * slice; a typed router (§7) lands when deep links/history actually matter.
 */
import { useState } from "react";
import { useUi } from "../app/store.js";
import { Sidebar } from "./components/Sidebar.js";
import { PlayerBar } from "./components/PlayerBar.js";
import { PlaybackAlert } from "./components/PlaybackAlert.js";
import { QueueDrawer } from "./components/QueueDrawer.js";
import { HomeScreen } from "./screens/HomeScreen.js";
import { SearchScreen } from "./screens/SearchScreen.js";
import { AlbumScreen } from "./screens/AlbumScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { AddonsScreen } from "./screens/AddonsScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { usePersistSession } from "./viewmodels/usePersistSession.js";

export function AppShell() {
  const view = useUi((s) => s.view);
  const [albumId, setAlbumId] = useState<string | undefined>(undefined);

  // Durable session: hydrate the queue on boot, autosave it, record plays.
  usePersistSession();

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        {view === "home" ? (
          <HomeScreen />
        ) : view === "search" ? (
          albumId ? (
            <AlbumScreen albumId={albumId} onBack={() => setAlbumId(undefined)} />
          ) : (
            <SearchScreen onOpenAlbum={(id) => setAlbumId(id)} />
          )
        ) : view === "library" ? (
          <LibraryScreen />
        ) : view === "addons" ? (
          <AddonsScreen />
        ) : (
          <SettingsScreen />
        )}
      </main>
      <PlaybackAlert />
      <PlayerBar />
      <QueueDrawer />
    </div>
  );
}
