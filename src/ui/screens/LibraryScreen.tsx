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
import { ChevronRightIcon, XIcon } from "lucide-react";
import type { LibraryEntry } from "../../core/persistence/schema.js";
import { useLibrary, useRemoveSaved, savedToTrack } from "../viewmodels/useLibrary.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { Artwork, PlayableArtwork } from "../components/common.js";
import {
  Loading,
  PageTitle,
  Row,
  RowAction,
  RowMain,
  RowTime,
  Rows,
  StateBlock,
} from "../components/primitives.js";
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
    <div className="max-w-5xl p-4 pb-12 md:p-8">
      <PageTitle className="mb-6">Your Library</PageTitle>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        {/* Four tabs don't fit one phone-width row, so wrap them into a 2×2
            grid inside the same bordered card on mobile; the desktop pill keeps
            its natural single row. The card's height is pinned by a
            `group-data-horizontal` variant, so releasing it needs that same
            prefix — a plain `h-auto` leaves the card one row tall and the second
            row spills outside its border. */}
        <TabsList className="grid w-full grid-cols-2 gap-1 group-data-horizontal/tabs:h-auto md:inline-flex md:w-fit md:gap-0 md:group-data-horizontal/tabs:h-11">
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
                    <Row
                      key={entry.id}
                      onClick={() => open(entry)}
                      action={
                        <RowAction label={removeLabel(entry)} onClick={() => remove.mutate(entry.id)}>
                          <XIcon className="size-4" />
                        </RowAction>
                      }
                    >
                      {entry.kind === "track" ? (
                        // Plays: the badge lands under the pointer on hover.
                        <PlayableArtwork src={entry.poster} alt={entry.name} seed={entry.id} size={38} />
                      ) : (
                        // Opens: square for albums, circular for artists.
                        <Artwork
                          src={entry.poster}
                          alt={entry.name}
                          seed={entry.id}
                          size={38}
                          round={entry.kind === "artist"}
                        />
                      )}
                      <RowMain title={entry.name} sub={subtitle(entry)} />
                      {entry.kind === "track" ? null : (
                        <RowTime>
                          <ChevronRightIcon className="size-4" />
                        </RowTime>
                      )}
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

/**
 * One control, but the right *word* per kind. The app saves three ways — a heart
 * for songs, Save for albums, Follow for artists — so a single "Remove" would be
 * a fourth vocabulary. Naming the item too means the label still makes sense read
 * on its own out of a list of forty.
 */
function removeLabel(entry: LibraryEntry): string {
  if (entry.kind === "artist") return `Unfollow ${entry.name}`;
  if (entry.kind === "album") return `Remove ${entry.name} from your library`;
  return `Remove ${entry.name} from your liked songs`;
}
