/**
 * Library — everything the user saved, in one place: songs, albums, artists.
 *
 * The store keeps mixed kinds in one collection ordered by when they were
 * saved, so **All** is the honest default view — it's the only one that answers
 * "what did I just add?". The per-kind tabs exist because the three are used
 * differently: a song plays, an album and an artist open. Counts sit in the tab
 * labels so an empty tab is visible before it's clicked.
 *
 * Playlists are a separate thing the repository already stores and no screen
 * builds yet; they are deliberately not folded in here.
 */
import { useState } from "react";
import type { LibraryEntry } from "../../core/persistence/schema.js";
import { useLibrary, useRemoveSaved, savedToTrack } from "../viewmodels/useLibrary.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { Artwork } from "../components/common.js";
import { Loading, PageTitle, Row, RowBody, RowMain, RowTime, Rows, StateBlock } from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Filter = "all" | "track" | "album" | "artist";

const TABS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "track", label: "Songs" },
  { value: "album", label: "Albums" },
  { value: "artist", label: "Artists" },
];

/** Each tab says what to do when it's empty — the action differs per kind. */
const EMPTY: Record<Filter, { icon: string; title: string; message: string }> = {
  all: {
    icon: "▣",
    title: "Your library is empty",
    message: "Songs, albums and artists you save show up here, newest first.",
  },
  track: {
    icon: "♡",
    title: "No liked songs yet",
    message: "Tap the heart in the player to save whatever you're listening to.",
  },
  album: {
    icon: "◉",
    title: "No saved albums",
    message: "Open an album and choose Save to keep it here.",
  },
  artist: {
    icon: "◈",
    title: "Not following anyone",
    message: "Open an artist and choose Follow to keep them here.",
  },
};

export function LibraryScreen({
  onOpenAlbum,
  onOpenArtist,
}: {
  onOpenAlbum: (id: string, name: string) => void;
  onOpenArtist: (id: string, name: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const library = useLibrary();
  const { playTracks } = usePlayer();
  const remove = useRemoveSaved();

  // Playlists live in the same collection but have no screen yet, so they'd
  // render as rows that go nowhere.
  const entries = (library.data ?? []).filter((e) => e.kind !== "playlist");
  const count = (f: Filter) => (f === "all" ? entries.length : entries.filter((e) => e.kind === f).length);

  const open = (entry: LibraryEntry) => {
    if (entry.kind === "track") playTracks([savedToTrack(entry)]);
    else if (entry.kind === "album") onOpenAlbum(entry.id, entry.name);
    else if (entry.kind === "artist") onOpenArtist(entry.id, entry.name);
  };

  return (
    <div className="max-w-5xl p-8 pb-12">
      <PageTitle className="mb-6">Your Library</PageTitle>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
              <span className="font-mono text-xs tabular-nums opacity-60">{count(tab.value)}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((tab) => {
          const rows = tab.value === "all" ? entries : entries.filter((e) => e.kind === tab.value);
          return (
            <TabsContent key={tab.value} value={tab.value} className="mt-5">
              {library.isLoading ? (
                <Loading />
              ) : rows.length === 0 ? (
                <StateBlock {...EMPTY[tab.value]} />
              ) : (
                <Rows>
                  {rows.map((entry) => (
                    <Row key={entry.id}>
                      <RowBody onClick={() => open(entry)}>
                        <Artwork src={entry.poster} alt={entry.name} seed={entry.id} size={38} />
                        <RowMain title={entry.name} sub={subtitle(entry)} />
                        <RowTime>{entry.kind === "track" ? "▶" : "›"}</RowTime>
                      </RowBody>
                      <Button
                        size="xs"
                        variant="outline"
                        aria-label={`Remove ${entry.name} from library`}
                        onClick={() => remove.mutate(entry.id)}
                      >
                        Remove
                      </Button>
                    </Row>
                  ))}
                </Rows>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

/**
 * Rows name their own kind even inside a per-kind tab. In **All** it's load
 * bearing — an album and a song otherwise look identical — and repeating it in
 * the filtered tabs keeps a row meaning the same thing wherever it appears.
 */
function subtitle(entry: LibraryEntry): string {
  if (entry.kind === "artist") return "Artist";
  const kind = entry.kind === "album" ? "Album" : "Song";
  return entry.artistName ? `${kind} · ${entry.artistName}` : kind;
}
