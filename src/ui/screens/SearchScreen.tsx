/**
 * Search — the core loop: query every installed catalog addon, merge, click a
 * song to play it. Failure is surfaced honestly: "no addons could be reached" is
 * a different state from "no results" (§6 fan-out semantics).
 *
 * **One box, no type filter.** People type "justin bieber baby" — an artist and
 * a song together — so making them pick a category first asks a question they
 * can't answer yet. Results are merged into one relevance-ordered list (see
 * `mergeByRelevance`) so the single best hit leads whatever its type; each row
 * carries a type label so a song, an album, and an artist still read apart at a
 * glance. That's what makes both "taylor swift" (you want the artist) and
 * "bohemian rhapsody" (you want the song) land without a click.
 */
import type { MetaPreview } from "@p2p-songs/protocol";
import { useUi } from "../../app/store.js";
import { useUnifiedSearch, useCatalogStats, isUnreachable, previewToTrack } from "../viewmodels/useCatalog.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useInstalledAddons } from "../viewmodels/useAddons.js";
import { useDebounced } from "../viewmodels/useDebounced.js";
import { ChevronRightIcon } from "lucide-react";
import { Artwork, PlayableArtwork } from "../components/common.js";
import {
  Loading,
  PageTitle,
  PartialBanner,
  Muted,
  Row,
  RowMain,
  RowTime,
  Rows,
  StateBlock,
} from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const EXAMPLES = ["taylor swift", "you seem sad for a girl in love", "bohemian rhapsody"];

export function SearchScreen({
  onOpenAlbum,
  onOpenArtist,
}: {
  onOpenAlbum: (id: string, name: string) => void;
  onOpenArtist: (id: string, name: string) => void;
}) {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearchQuery);
  const { data: addons } = useInstalledAddons();
  const { playTracks } = usePlayer();

  const hasCatalogAddon = (addons ?? []).some((a) => a.online && a.resources.includes("catalog"));
  const hasStreamAddon = (addons ?? []).some((a) => a.online && a.resources.includes("stream"));

  // The input stays instant; only the *query* waits. Without this every
  // keystroke fired three searches, and a typed phrase buried the real one
  // under its own backlog until it hit the provider deadline.
  const settledQuery = useDebounced(query, 350);
  const search = useUnifiedSearch(settledQuery, hasCatalogAddon);
  const settling = query.trim() !== settledQuery.trim();

  const results = search.data;
  const total = results?.length ?? 0;

  return (
    <div className="p-8 pb-12">
      <PageTitle className="mb-6">Search</PageTitle>

      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artists, albums and songs — all at once"
          aria-label="Search"
          autoFocus
          className="h-14 flex-1 text-lg"
        />
        {query ? (
          <Button variant="outline" size="lg" aria-label="Clear" onClick={() => setQuery("")}>
            ✕
          </Button>
        ) : null}
      </div>

      <CatalogSize enabled={hasCatalogAddon} />

      {hasCatalogAddon && !hasStreamAddon ? (
        <div className="mt-5">
          <PartialBanner message="You can search, but nothing can play yet — no stream addon is installed." />
        </div>
      ) : null}

      {!hasCatalogAddon ? (
        <StateBlock
          icon="◈"
          title="No catalog addon installed"
          message="Install an addon that provides a catalog to search for music."
        />
      ) : !query.trim() ? (
        <StateBlock
          icon="◎"
          title="Search for music"
          message="One box for artists, albums and songs — type whatever you remember. Results come from every catalog addon you've installed, which knows about far more music than any one stream addon can play."
          action={
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((q) => (
                <Button key={q} size="sm" variant="outline" onClick={() => setQuery(q)}>
                  {q}
                </Button>
              ))}
            </div>
          }
        />
      ) : settling || search.isLoading ? (
        <Loading label="Searching…" />
      ) : search.isError ? (
        <StateBlock
          icon="⚠"
          title={isUnreachable(search.error) ? "Couldn't reach any addon" : "Search failed"}
          message={
            isUnreachable(search.error)
              ? "Every catalog addon was unreachable. Check they're running, then try again."
              : "Something went wrong running that search."
          }
          action={
            <Button size="sm" onClick={() => search.refetch()}>
              Retry
            </Button>
          }
        />
      ) : total === 0 ? (
        <StateBlock icon="◎" title="No results found" message="Try different keywords." />
      ) : (
        <div className="mt-6">
          <Rows>
            {results!.map((item) => (
              <ResultRow
                key={item.id}
                item={item}
                onOpenArtist={onOpenArtist}
                onOpenAlbum={onOpenAlbum}
                onPlay={(track) => playTracks([previewToTrack(track)])}
              />
            ))}
          </Rows>
        </div>
      )}
    </div>
  );
}

/**
 * The searchable catalogue's size — "X songs · Y albums · Z artists indexed".
 * The default catalogue is curated (popular/official), not all of recorded
 * music, so stating its size up front sets the right expectation instead of
 * letting a missing niche track read as a bug. Renders nothing until (and unless)
 * a catalog addon reports counts, so it never shows a misleading zero or a
 * flash of "0 songs" while loading.
 */
function CatalogSize({ enabled }: { enabled: boolean }) {
  const { data: stats } = useCatalogStats(enabled);
  if (!stats || stats.total === 0) return null;
  const n = (v: number) => v.toLocaleString();
  return (
    <div className="mt-3">
      <Muted>
        {n(stats.tracks)} songs · {n(stats.albums)} albums · {n(stats.artists)} artists indexed
      </Muted>
    </div>
  );
}

/** Human label for a result's content type — the badge every row wears. */
const TYPE_LABEL: Record<string, string> = { track: "Song", album: "Album", artist: "Artist", playlist: "Playlist" };

/**
 * One row in the merged, relevance-ordered results. Because the list mixes types,
 * each row wears a **type label** (Song / Album / Artist) so its kind is legible
 * without hovering — the affordances still reinforce it (a song plays, its artwork
 * carrying a play badge on hover; an artist or album opens, with a chevron and, for
 * an artist, circular artwork), but the label is what makes a mixed list readable
 * at a glance and tells apart same-named results of different kinds.
 */
function ResultRow({
  item,
  onOpenArtist,
  onOpenAlbum,
  onPlay,
}: {
  item: MetaPreview;
  onOpenArtist: (id: string, name: string) => void;
  onOpenAlbum: (id: string, name: string) => void;
  onPlay: (item: MetaPreview) => void;
}) {
  const isTrack = item.type === "track";
  const isArtist = item.type === "artist";
  const onClick = isTrack
    ? () => onPlay(item)
    : isArtist
      ? () => onOpenArtist(item.id, item.name)
      : () => onOpenAlbum(item.id, item.name);
  return (
    <Row onClick={onClick}>
      {isTrack ? (
        <PlayableArtwork src={item.poster} alt={item.name} seed={item.id} size={38} />
      ) : (
        <Artwork src={item.poster} alt={item.name} seed={item.id} size={38} round={isArtist} />
      )}
      {/* An artist row is only an id and a name — a subtitle would be noise. */}
      <RowMain title={item.name} sub={isArtist ? undefined : (item.description ?? "Unknown artist")} />
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="secondary">{TYPE_LABEL[item.type] ?? item.type}</Badge>
        {isTrack ? null : (
          <RowTime>
            <ChevronRightIcon className="size-4" />
          </RowTime>
        )}
      </div>
    </Row>
  );
}
