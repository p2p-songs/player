/**
 * Artist detail: the discography, so an artist search result leads somewhere.
 *
 * The list comes from the `byArtist` album catalog rather than the artist's
 * `meta`, and its rows are ordinary album previews — which is why opening one
 * reuses the existing album screen with no special casing.
 */
import { useArtistAlbums, isUnreachable } from "../viewmodels/useCatalog.js";
import { Artwork } from "../components/common.js";
import { Loading, Muted, PageTitle, Row, RowMain, RowTime, Rows, StateBlock } from "../components/primitives.js";
import { Button } from "@/components/ui/button";

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
    <div className="max-w-5xl p-8 pb-12">
      <Button size="sm" variant="outline" onClick={onBack} className="mb-5">
        ‹ Back
      </Button>

      <PageTitle className="mb-1">{artistName}</PageTitle>
      <div className="mb-5">
        <Muted>
          {albums.isLoading ? "Loading discography…" : `${rows.length} ${rows.length === 1 ? "release" : "releases"}`}
        </Muted>
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
            <Button size="sm" onClick={() => albums.refetch()}>
              Retry
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <StateBlock
          icon="◈"
          title="No releases found"
          message="No installed catalog addon lists any releases for this artist."
        />
      ) : (
        <Rows>
          {rows.map((album) => (
            <Row key={album.id} onClick={() => onOpenAlbum(album.id, album.name)}>
              <Artwork src={album.poster} alt={album.name} seed={album.id} size={38} />
              {/* The catalog puts the release year here — every row shares the artist. */}
              <RowMain title={album.name} sub={album.description ?? ""} />
              <RowTime>›</RowTime>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
