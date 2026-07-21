/**
 * Settings (mockup panel 10), minimal: the playback preferences that are actually
 * wired to the engine, plus local-data controls. Options with nothing behind them
 * yet are deliberately absent rather than shown as dead switches.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { usePlayer } from "../viewmodels/useEngineState.js";

export function SettingsScreen() {
  const { repository } = useServices();
  const player = usePlayer();
  const queryClient = useQueryClient();

  const counts = useQuery({
    queryKey: ["storage-counts"],
    queryFn: async () => ({
      library: (await repository.listLibrary()).length,
      history: (await repository.listRecentPlays(1000)).length,
      addons: (await repository.listAddons()).length,
    }),
  });

  const clearHistory = async () => {
    await repository.clearHistory();
    await queryClient.invalidateQueries();
  };

  return (
    <div className="main-inner">
      <h1 className="page-title">Settings</h1>

      <h2 className="section-title">Playback</h2>
      <div className="card">
        <div className="stack">
          <label className="spread">
            <span>Shuffle</span>
            <input type="checkbox" checked={player.shuffle} onChange={(e) => player.setShuffle(e.target.checked)} />
          </label>
          <label className="spread">
            <span>Repeat</span>
            <select
              value={player.repeat}
              onChange={(e) => player.setRepeat(e.target.value as "off" | "one" | "all")}
            >
              <option value="off">Off</option>
              <option value="one">One</option>
              <option value="all">All</option>
            </select>
          </label>
        </div>
      </div>

      <h2 className="section-title">Local data</h2>
      <div className="card">
        <div className="stack">
          <div className="muted" style={{ fontSize: 13 }}>
            Everything is stored on this device. Resolved stream links are never saved — they&apos;re re-fetched each
            time you play.
          </div>
          <div className="spread">
            <span>
              {counts.data ? `${counts.data.addons} addons · ${counts.data.library} saved · ${counts.data.history} plays` : "…"}
            </span>
            <button type="button" className="btn btn-sm" onClick={clearHistory}>
              Clear play history
            </button>
          </div>
        </div>
      </div>

      <h2 className="section-title">About</h2>
      <div className="card muted" style={{ fontSize: 13 }}>
        PHONO — a p2p-songs player. Music comes from the addons you install; the player bundles no sources of its own.
      </div>
    </div>
  );
}
