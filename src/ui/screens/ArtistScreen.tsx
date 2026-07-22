/**
 * Artist detail: the discography, so an artist search result leads somewhere.
 *
 * The list comes from the `byArtist` album catalog rather than the artist's
 * `meta`, and its rows are ordinary album previews — which is why opening one
 * reuses the existing album screen with no special casing.
 */
import { useArtistAlbums, isUnreachable } from "../viewmodels/useCatalog.js";
import { Artwork, Loading, StateBlock } from "../components/common.js";

export function ArtistScreen({
  artistId,
  artistName,
  onBack,
  onOpenAlbum,
}: {
  artistId: string;
  artistName: string;
  onBack: () => void;
  onOpenAlbum: (id: string, name: string) => void;
}) {
  const albums = useArtistAlbums(artistId);
  const rows = albums.data ?? [];

  return (
    <div className="main-inner">
      <button type="button" className="btn btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>
        ‹ Back
      </button>

      <h1 className="page-title" style={{ marginBottom: 4 }}>
        {artistName}
      </h1>
      <div className="muted" style={{ marginBottom: 18 }}>
        {albums.isLoading ? "Loading discography…" : `${rows.length} ${rows.length === 1 ? "release" : "releases"}`}
      </div>

      {albums.isLoading ? (
        <Loading label="Loading discography…" />
      ) : albums.isError ? (
        <StateBlock
          icon="⚠"
          title={isUnreachable(albums.error) ? "Couldn't reach any addon" : "Couldn't load this artist"}
          message={
            isUnreachable(albums.error)
              ? "Every catalog addon was unreachable. Check they're running, then try again."
              : "No installed addon could provide this artist's releases."
          }
          action={
            <button type="button" className="btn btn-sm" onClick={() => albums.refetch()}>
              Retry
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <StateBlock
          icon="⧉"
          title="No releases found"
          message="No installed catalog addon lists any releases for this artist."
        />
      ) : (
        <div className="rows">
          {rows.map((album) => (
            <button
              key={album.id}
              type="button"
              className="row"
              onClick={() => onOpenAlbum(album.id, album.name)}
            >
              <Artwork src={album.poster} alt={album.name} size={38} />
              <span className="row-main">
                <span className="row-title">{album.name}</span>
                {/* The catalog puts the release year here — every row shares the artist. */}
                <span className="row-sub">{album.description ?? ""}</span>
              </span>
              <span className="row-time" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
