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
import { ArtistScreen } from "./screens/ArtistScreen.js";
import { LibraryScreen } from "./screens/LibraryScreen.js";
import { AddonsScreen } from "./screens/AddonsScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { usePersistSession } from "./viewmodels/usePersistSession.js";

export function AppShell() {
  const view = useUi((s) => s.view);
  // A two-level drill-down (search → artist → album) rather than a router:
  // going back from an album returns to the artist when we arrived via one.
  const [albumId, setAlbumId] = useState<string | undefined>(undefined);
  const [artist, setArtist] = useState<{ id: string; name: string } | undefined>(undefined);

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
          ) : artist ? (
            <ArtistScreen
              artistId={artist.id}
              artistName={artist.name}
              onBack={() => setArtist(undefined)}
              onOpenAlbum={(id) => setAlbumId(id)}
            />
          ) : (
            <SearchScreen
              onOpenAlbum={(id) => setAlbumId(id)}
              onOpenArtist={(id, name) => setArtist({ id, name })}
            />
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
