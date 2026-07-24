/**
 * Search — the core loop: query every installed catalog addon, merge, click a
 * song to play it. Failure is surfaced honestly: "no addons could be reached" is
 * a different state from "no results" (§6 fan-out semantics).
 *
 * **One box, no type filter.** People type "justin bieber baby" — an artist and
 * a song together — so making them pick a category first asks a question they
 * can't answer yet. Results are sectioned instead: artists and albums are few
 * and precise, so they come first and are capped; songs are many and follow in
 * full. That ordering is what makes both "taylor swift" (you want the artist)
 * and "bohemian rhapsody" (you want the song) land without a click.
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
  SectionTitle,
  StateBlock,
} from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Enough to recognise the right one, few enough not to bury the songs. */
const PRECISE_LIMIT = 4;

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
  const total = results ? results.artists.length + results.albums.length + results.tracks.length : 0;

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
        <>
          <ResultSection
            title="Artists"
            kind="artist"
            items={results!.artists.slice(0, PRECISE_LIMIT)}
            onOpen={(item) => onOpenArtist(item.id, item.name)}
            // An artist row is only an id and a name — a subtitle would be noise.
            showSub={false}
          />
          <ResultSection
            title="Albums"
            kind="album"
            items={results!.albums.slice(0, PRECISE_LIMIT)}
            onOpen={(item) => onOpenAlbum(item.id, item.name)}
          />
          <ResultSection
            title="Songs"
            kind="track"
            items={results!.tracks}
            onOpen={(item) => playTracks([previewToTrack(item)])}
          />
        </>
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

/**
 * `kind` decides the row's affordance, not just its icon: songs play, so their
 * artwork carries a play badge on hover; artists and albums open, so they get a
 * chevron, and artists are circular. See {@link PlayableArtwork}.
 */
function ResultSection({
  title,
  kind,
  items,
  onOpen,
  showSub = true,
}: {
  title: string;
  kind: "artist" | "album" | "track";
  items: MetaPreview[];
  onOpen: (item: MetaPreview) => void;
  showSub?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Rows>
        {items.map((item) => (
          <Row key={item.id} onClick={() => onOpen(item)}>
            {kind === "track" ? (
              <PlayableArtwork src={item.poster} alt={item.name} seed={item.id} size={38} />
            ) : (
              <Artwork
                src={item.poster}
                alt={item.name}
                seed={item.id}
                size={38}
                round={kind === "artist"}
              />
            )}
            <RowMain title={item.name} sub={showSub ? (item.description ?? "Unknown artist") : undefined} />
            {kind === "track" ? null : (
              <RowTime>
                <ChevronRightIcon className="size-4" />
              </RowTime>
            )}
          </Row>
        ))}
      </Rows>
    </>
  );
}
