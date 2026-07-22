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
import { useUnifiedSearch, isUnreachable, previewToTrack } from "../viewmodels/useCatalog.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useInstalledAddons } from "../viewmodels/useAddons.js";
import { Artwork } from "../components/common.js";
import {
  Loading,
  PageTitle,
  PartialBanner,
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
  const search = useUnifiedSearch(query, hasCatalogAddon);

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
      ) : search.isLoading ? (
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
            items={results!.artists.slice(0, PRECISE_LIMIT)}
            onOpen={(item) => onOpenArtist(item.id, item.name)}
            // An artist row is only an id and a name — a subtitle would be noise.
            showSub={false}
            chevron="›"
          />
          <ResultSection
            title="Albums"
            items={results!.albums.slice(0, PRECISE_LIMIT)}
            onOpen={(item) => onOpenAlbum(item.id, item.name)}
            chevron="›"
          />
          <ResultSection
            title="Songs"
            items={results!.tracks}
            onOpen={(item) => playTracks([previewToTrack(item)])}
            chevron="▶"
          />
        </>
      )}
    </div>
  );
}

function ResultSection({
  title,
  items,
  onOpen,
  chevron,
  showSub = true,
}: {
  title: string;
  items: MetaPreview[];
  onOpen: (item: MetaPreview) => void;
  chevron: string;
  showSub?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Rows>
        {items.map((item) => (
          <Row key={item.id} onClick={() => onOpen(item)}>
            <Artwork src={item.poster} alt={item.name} seed={item.id} size={38} />
            <RowMain title={item.name} sub={showSub ? (item.description ?? "Unknown artist") : undefined} />
            <RowTime>{chevron}</RowTime>
          </Row>
        ))}
      </Rows>
    </>
  );
}
