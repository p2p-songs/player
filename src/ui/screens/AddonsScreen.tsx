/**
 * Addon manager (mockup panel 7). The **only** way to add a source is pasting a
 * manifest URL — nothing is bundled or default-installed (§11). Stored URLs are
 * shown redacted because a configured one carries the user's credential (§6a).
 */
import { useState } from "react";
import { useInstalledAddons, useInstallAddon, useRemoveAddon } from "../viewmodels/useAddons.js";
import { Loading, StateBlock } from "../components/common.js";

export function AddonsScreen() {
  const { data: addons, isLoading } = useInstalledAddons();
  const install = useInstallAddon();
  const remove = useRemoveAddon();
  const [url, setUrl] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    install.mutate(url, { onSuccess: () => setUrl("") });
  };

  return (
    <div className="main-inner">
      <h1 className="page-title">Addons</h1>

      <div className="card">
        <div className="stack">
          <div>
            <strong>Install an addon</strong>
            <div className="muted text-md" style={{ marginTop: 2 }}>
              Paste a manifest URL. The player ships with no sources of its own — everything comes from addons you add.
            </div>
          </div>
          <form onSubmit={submit} className="inline">
            <div className="field" style={{ flex: 1 }}>
              <span aria-hidden="true" className="muted">
                ⧉
              </span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://addon.example/manifest.json"
                aria-label="Addon manifest URL"
                spellCheck={false}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={install.isPending || !url.trim()}>
              {install.isPending ? "Installing…" : "Install"}
            </button>
          </form>
          {install.isError ? (
            <div className="banner banner-danger" role="alert">
              <span aria-hidden="true">⚠</span>
              <span>
                Couldn&apos;t install that addon. Check the URL is a reachable <code>manifest.json</code>.
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <h2 className="section-title">Installed</h2>
      {isLoading ? (
        <Loading label="Loading addons…" />
      ) : !addons || addons.length === 0 ? (
        <StateBlock
          icon="⧉"
          title="No addons yet"
          message="Install one above to search and play music. Run a reference addon locally and paste its localhost URL to try it out."
        />
      ) : (
        <div className="rows">
          {addons.map((addon) => (
            <div key={addon.id} className="row" style={{ cursor: "default" }}>
              <span className="row-main">
                <span className="row-title">
                  {addon.name}{" "}
                  {addon.configured ? <span className="chip chip-accent">Configured</span> : null}
                  {!addon.online ? <span className="chip">Offline</span> : null}
                </span>
                <span className="row-sub">{addon.displayUrl}</span>
                <span className="inline" style={{ marginTop: 6, gap: 6 }}>
                  {addon.resources.map((r) => (
                    <span key={r} className="chip chip-alt">
                      {r}
                    </span>
                  ))}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => remove.mutate(addon.id)}
                disabled={remove.isPending}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
