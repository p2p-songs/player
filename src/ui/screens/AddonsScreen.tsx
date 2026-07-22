/**
 * Addon manager. The **only** way to add a source is pasting a manifest URL —
 * nothing is bundled or default-installed (§11). Stored URLs are shown redacted
 * because a configured one carries the user's credential (§6a).
 */
import { useState } from "react";
import { useInstalledAddons, useInstallAddon, useRemoveAddon } from "../viewmodels/useAddons.js";
import {
  Loading,
  Muted,
  PageTitle,
  PartialBanner,
  Row,
  Rows,
  SectionTitle,
  StateBlock,
} from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

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
    <div className="max-w-5xl p-8 pb-12">
      <PageTitle className="mb-6">Addons</PageTitle>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div>
            <strong className="font-head uppercase">Install an addon</strong>
            <div className="mt-1">
              <Muted>
                Paste a manifest URL. The player ships with no sources of its own — everything comes from addons you
                add.
              </Muted>
            </div>
          </div>
          <form onSubmit={submit} className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://addon.example/manifest.json"
              aria-label="Addon manifest URL"
              spellCheck={false}
              className="flex-1"
            />
            <Button type="submit" disabled={install.isPending || !url.trim()}>
              {install.isPending ? "Installing…" : "Install"}
            </Button>
          </form>
          {install.isError ? (
            <PartialBanner danger message="Couldn't install that addon. Check the URL is a reachable manifest.json." />
          ) : null}
        </CardContent>
      </Card>

      <SectionTitle>Installed</SectionTitle>
      {isLoading ? (
        <Loading label="Loading addons…" />
      ) : !addons || addons.length === 0 ? (
        <StateBlock
          icon="◈"
          title="No addons yet"
          message="Install one above to search and play music. Run a reference addon locally and paste its localhost URL to try it out."
        />
      ) : (
        <Rows>
          {addons.map((addon) => (
            <Row key={addon.id}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {addon.name}
                  {addon.configured ? <Badge>Configured</Badge> : null}
                  {!addon.online ? <Badge variant="outline">Offline</Badge> : null}
                </span>
                {/* Redacted by the viewmodel — a configured URL is a credential. */}
                <span className="block truncate text-sm text-muted-foreground">{addon.displayUrl}</span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {addon.resources.map((r) => (
                    <Badge key={r} variant="secondary">
                      {r}
                    </Badge>
                  ))}
                </span>
              </span>
              <Button
                size="xs"
                variant="destructive"
                onClick={() => remove.mutate(addon.id)}
                disabled={remove.isPending}
              >
                Remove
              </Button>
            </Row>
          ))}
        </Rows>
      )}
    </div>
  );
}
