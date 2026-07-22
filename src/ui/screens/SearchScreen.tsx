/**
 * Search — the core loop: query every installed catalog addon, merge, click a
 * song to play it. Failure is surfaced honestly: "no addons could be reached" is
 * a different state from "no results" (§6 fan-out semantics).
 */
import { useState } from "react";
import type { ContentType } from "@p2p-songs/protocol";
import { useUi } from "../../app/store.js";
import { useSearch, isUnreachable, previewToTrack } from "../viewmodels/useCatalog.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useInstalledAddons } from "../viewmodels/useAddons.js";
import { Artwork } from "../components/common.js";
import { Loading, PageTitle, PartialBanner, Row, RowMain, RowTime, Rows, StateBlock } from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS: { type: ContentType; label: string }[] = [
  { type: "track", label: "Songs" },
  { type: "album", label: "Albums" },
  { type: "artist", label: "Artists" },
];

export function SearchScreen({
  onOpenAlbum,
  onOpenArtist,
}: {
  onOpenAlbum: (id: string, name: string) => void;
  onOpenArtist: (id: string, name: string) => void;
}) {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearchQuery);
  const [type, setType] = useState<ContentType>("track");
  const { data: addons } = useInstalledAddons();
  const { playTracks } = usePlayer();

  const hasCatalogAddon = (addons ?? []).some((a) => a.online && a.resources.includes("catalog"));
  const hasStreamAddon = (addons ?? []).some((a) => a.online && a.resources.includes("stream"));
  const search = useSearch(type, query, hasCatalogAddon);

  return (
    <div className="max-w-5xl p-8 pb-12">
      <PageTitle className="mb-6">Search</PageTitle>

      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs, albums and artists"
          aria-label="Search"
          autoFocus
          className="flex-1"
        />
        {query ? (
          <Button variant="outline" aria-label="Clear" onClick={() => setQuery("")}>
            ✕
          </Button>
        ) : null}
      </div>

      <Tabs value={type} onValueChange={(v) => setType(v as ContentType)} className="mt-4">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.type} value={tab.type}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {hasCatalogAddon && !hasStreamAddon ? (
        <div className="mt-4">
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
          message="Results come from every catalog addon you've installed. A catalog knows about far more music than any one stream addon can play, so try these known-good picks:"
          action={
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {["monkeys spinning monkeys", "fluffing a duck", "local forecast"].map((q) => (
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
      ) : (search.data ?? []).length === 0 ? (
        <StateBlock icon="◎" title="No results found" message="Try different keywords." />
      ) : (
        <div className="mt-4">
          <Rows>
            {(search.data ?? []).map((item) => {
              // A track plays immediately; an album or artist opens a screen.
              const open =
                type === "track"
                  ? () => playTracks([previewToTrack(item)])
                  : type === "album"
                    ? () => onOpenAlbum(item.id, item.name)
                    : () => onOpenArtist(item.id, item.name);
              return (
                <Row key={item.id} onClick={open}>
                  <Artwork src={item.poster} alt={item.name} seed={item.id} size={38} />
                  {/* Artist rows carry no secondary line — the name is the whole item. */}
                  <RowMain title={item.name} sub={type === "artist" ? undefined : (item.description ?? "Unknown artist")} />
                  <RowTime>{type === "track" ? "▶" : "›"}</RowTime>
                </Row>
              );
            })}
          </Rows>
        </div>
      )}
    </div>
  );
}
