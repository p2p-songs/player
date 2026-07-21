/**
 * Home (mockup panel 2): recently played, from the durable play history (§6).
 * Doubles as the first-run guide when nothing is installed yet.
 */
import { useQuery } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { useInstalledAddons } from "../viewmodels/useAddons.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useUi } from "../../app/store.js";
import { Artwork, Loading, StateBlock } from "../components/common.js";

export function HomeScreen() {
  const { repository } = useServices();
  const { data: addons, isLoading: addonsLoading } = useInstalledAddons();
  const { playTracks } = usePlayer();
  const setView = useUi((s) => s.setView);

  const history = useQuery({
    queryKey: ["history"],
    queryFn: () => repository.listRecentPlays(12),
  });

  if (addonsLoading) return <div className="main-inner"><Loading /></div>;

  const hasAddons = (addons ?? []).length > 0;

  return (
    <div className="main-inner">
      <h1 className="page-title">Home</h1>

      {!hasAddons ? (
        <div className="card">
          <div className="stack">
            <strong>Welcome to PHONO</strong>
            <div className="muted" style={{ fontSize: 14 }}>
              This player has no music of its own — it plays whatever your addons provide. Add one to get started:
              install a catalog addon to search, and a stream addon to play.
            </div>
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setView("addons")}>
                Add an addon
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <h2 className="section-title">Recently played</h2>
      {history.isLoading ? (
        <Loading />
      ) : (history.data ?? []).length === 0 ? (
        <StateBlock icon="♪" title="Nothing played yet" message="Songs you play will show up here." />
      ) : (
        <div className="rows">
          {(history.data ?? []).map((event) => (
            <button key={event.id} type="button" className="row" onClick={() => playTracks([event.track])}>
              <Artwork src={event.track.artwork} alt={event.track.title} size={38} />
              <span className="row-main">
                <span className="row-title">{event.track.title}</span>
                <span className="row-sub">{event.track.artist ?? "Unknown artist"}</span>
              </span>
              <span className="row-time" aria-hidden="true">
                ▶
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
