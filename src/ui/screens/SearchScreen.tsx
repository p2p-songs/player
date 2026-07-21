/**
 * Search (mockup panel 3) — the core loop: query every installed catalog addon,
 * merge, click a song to play it. Failure is surfaced honestly: "no addons could
 * be reached" is a different state from "no results" (§6 fan-out semantics).
 */
import { useState } from "react";
import type { ContentType } from "@p2p-songs/protocol";
import { useUi } from "../../app/store.js";
import { useSearch, isUnreachable, previewToTrack } from "../viewmodels/useCatalog.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useInstalledAddons } from "../viewmodels/useAddons.js";
import { Artwork, Loading, StateBlock } from "../components/common.js";

const TABS: { type: ContentType; label: string }[] = [
  { type: "track", label: "Songs" },
  { type: "album", label: "Albums" },
];

export function SearchScreen({ onOpenAlbum }: { onOpenAlbum: (id: string, name: string) => void }) {
  const query = useUi((s) => s.searchQuery);
  const setQuery = useUi((s) => s.setSearchQuery);
  const [type, setType] = useState<ContentType>("track");
  const { data: addons } = useInstalledAddons();
  const { playTracks } = usePlayer();

  const hasCatalogAddon = (addons ?? []).some((a) => a.online && a.resources.includes("catalog"));
  const hasStreamAddon = (addons ?? []).some((a) => a.online && a.resources.includes("stream"));
  const search = useSearch(type, query, hasCatalogAddon);

  return (
    <div className="main-inner">
      <h1 className="page-title">Search</h1>

      <div className="field">
        <span aria-hidden="true" className="muted">
          ⌕
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs and albums"
          aria-label="Search"
          autoFocus
        />
        {query ? (
          <button type="button" className="t-btn" style={{ color: "var(--text-muted)" }} onClick={() => setQuery("")} aria-label="Clear">
            ✕
          </button>
        ) : null}
      </div>

      <div className="inline" style={{ margin: "14px 0 4px" }}>
        {TABS.map((tab) => (
          <button
            key={tab.type}
            type="button"
            className={type === tab.type ? "btn btn-sm btn-primary" : "btn btn-sm"}
            onClick={() => setType(tab.type)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {hasCatalogAddon && !hasStreamAddon ? (
        <div className="banner" role="status" style={{ marginTop: 14 }}>
          <span aria-hidden="true">⚠</span>
          <span>
            You can search, but nothing can play yet — no <strong>stream</strong> addon is installed.
          </span>
        </div>
      ) : null}

      {!hasCatalogAddon ? (
        <StateBlock
          icon="⧉"
          title="No catalog addon installed"
          message="Install an addon that provides a catalog to search for music."
        />
      ) : !query.trim() ? (
        <StateBlock
          icon="⌕"
          title="Search for music"
          message="Results come from every catalog addon you've installed. A catalog knows about far more music than any one stream addon can play, so try these known-good picks:"
          action={
            <div className="inline" style={{ flexWrap: "wrap", justifyContent: "center", marginTop: 6 }}>
              {["monkeys spinning monkeys", "fluffing a duck", "local forecast"].map((q) => (
                <button key={q} type="button" className="btn btn-sm" onClick={() => setQuery(q)}>
                  {q}
                </button>
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
            <button type="button" className="btn btn-sm" onClick={() => search.refetch()}>
              Retry
            </button>
          }
        />
      ) : (search.data ?? []).length === 0 ? (
        <StateBlock icon="⌕" title="No results found" message="Try different keywords." />
      ) : (
        <div className="rows" style={{ marginTop: 12 }}>
          {(search.data ?? []).map((item) =>
            type === "track" ? (
              <button key={item.id} type="button" className="row" onClick={() => playTracks([previewToTrack(item)])}>
                <Artwork src={item.poster} alt={item.name} size={38} />
                <span className="row-main">
                  <span className="row-title">{item.name}</span>
                  <span className="row-sub">{item.description ?? "Unknown artist"}</span>
                </span>
                <span className="row-time" aria-hidden="true">
                  ▶
                </span>
              </button>
            ) : (
              <button key={item.id} type="button" className="row" onClick={() => onOpenAlbum(item.id, item.name)}>
                <Artwork src={item.poster} alt={item.name} size={38} />
                <span className="row-main">
                  <span className="row-title">{item.name}</span>
                  <span className="row-sub">{item.description ?? "Unknown artist"}</span>
                </span>
                <span className="row-time" aria-hidden="true">
                  ›
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
