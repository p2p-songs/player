/**
 * Settings (mockup panel 10), minimal: the playback preferences that are actually
 * wired to the engine, plus local-data controls. Options with nothing behind them
 * yet are deliberately absent rather than shown as dead switches.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { useThemePicker } from "../viewmodels/useTheme.js";
import { BUNDLED_THEMES } from "../theme/index.js";

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

      <h2 className="section-title">Appearance</h2>
      <ThemePicker />

      <h2 className="section-title">Local data</h2>
      <div className="card">
        <div className="stack">
          <div className="muted text-md">
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
      <div className="card muted text-md">
        PHONO — a p2p-songs player. Music comes from the addons you install; the player bundles no sources of its own.
      </div>
    </div>
  );
}

/**
 * Theme selection. Each option previews the theme's *own* palette rather than
 * a label, because the difference between these is the point — and a preview
 * built from the theme's tokens keeps working unchanged when themes stop being
 * bundled and start being installed.
 */
function ThemePicker() {
  const { themes, current, select } = useThemePicker();
  return (
    <div className="card">
      <div className="theme-list">
        {themes.map((theme) => {
          const tokens = BUNDLED_THEMES.find((t) => t.id === theme.id)?.tokens;
          return (
            <button
              key={theme.id}
              type="button"
              className="theme-option"
              onClick={() => select(theme.id)}
              aria-pressed={current === theme.id}
            >
              <span className="theme-option-name">{theme.name}</span>
              <span className="muted text-sm">{theme.description}</span>
              {tokens ? (
                <span className="theme-swatches" aria-hidden="true">
                  {(["--bg", "--surface-sunken", "--accent", "--accent-2", "--chrome-bg"] as const).map((token) => (
                    <span key={token} className="theme-swatch" style={{ background: tokens[token] }} />
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
