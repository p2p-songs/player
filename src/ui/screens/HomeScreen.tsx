/**
 * Home: recently played, from the durable play history (§6). Doubles as the
 * first-run guide when nothing is installed yet.
 */
import { useQuery } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { useInstalledAddons } from "../viewmodels/useAddons.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { Artwork } from "../components/common.js";
import { Loading, Muted, PageTitle, Row, RowMain, RowTime, Rows, SectionTitle, StateBlock } from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function HomeScreen() {
  const { repository } = useServices();
  const { data: addons, isLoading: addonsLoading } = useInstalledAddons();
  const { playTracks } = usePlayer();
  const setView = useUi((s) => s.setView);

  const history = useQuery({
    queryKey: ["history"],
    queryFn: () => repository.listRecentPlays(12),
  });

  if (addonsLoading)
    return (
      <div className="max-w-5xl p-8">
        <Loading />
      </div>
    );

  const hasAddons = (addons ?? []).length > 0;

  return (
    <div className="max-w-5xl p-8 pb-12">
      <PageTitle className="mb-6">Home</PageTitle>

      {!hasAddons ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <strong className="font-head uppercase">Welcome to PHONO</strong>
            <Muted>
              This player has no music of its own — it plays whatever your addons provide. Add one to get started:
              install a catalog addon to search, and a stream addon to play.
            </Muted>
            <Button onClick={() => setView("addons")}>Add an addon</Button>
          </CardContent>
        </Card>
      ) : null}

      <SectionTitle>Recently played</SectionTitle>
      {history.isLoading ? (
        <Loading />
      ) : (history.data ?? []).length === 0 ? (
        <StateBlock icon="♪" title="Nothing played yet" message="Songs you play will show up here." />
      ) : (
        <Rows>
          {(history.data ?? []).map((event) => (
            <Row key={event.id} onClick={() => playTracks([event.track])}>
              <Artwork src={event.track.artwork} alt={event.track.title} seed={event.track.recordingId} size={38} />
              <RowMain title={event.track.title} sub={event.track.artist ?? "Unknown artist"} />
              <RowTime>▶</RowTime>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
