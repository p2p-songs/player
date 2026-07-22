/**
 * Settings, minimal: the playback preferences that are actually wired to the
 * engine, plus local-data controls. Options with nothing behind them yet are
 * deliberately absent rather than shown as dead switches.
 *
 * No appearance section — the look ships with the app and is not user-selectable
 * (ARCHITECTURE §7a).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { usePlayer } from "../viewmodels/useEngineState.js";
import { Muted, PageTitle, SectionTitle } from "../components/primitives.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
    <div className="max-w-5xl p-8 pb-12">
      <PageTitle className="mb-6">Settings</PageTitle>

      <SectionTitle>Playback</SectionTitle>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="shuffle">Shuffle</Label>
            <Switch id="shuffle" checked={player.shuffle} onCheckedChange={(v) => player.setShuffle(v)} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="repeat">Repeat</Label>
            <Select value={player.repeat} onValueChange={(v) => player.setRepeat(v as "off" | "one" | "all")}>
              <SelectTrigger id="repeat" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="one">One</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <SectionTitle>Local data</SectionTitle>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <Muted>
            Everything is stored on this device. Resolved stream links are never saved — they&apos;re re-fetched each
            time you play.
          </Muted>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {counts.data
                ? `${counts.data.addons} addons · ${counts.data.library} saved · ${counts.data.history} plays`
                : "…"}
            </span>
            <Button size="sm" variant="outline" onClick={clearHistory}>
              Clear play history
            </Button>
          </div>
        </CardContent>
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card>
        <CardContent>
          <Muted>
            PHONO — a p2p-songs player. Music comes from the addons you install; the player bundles no sources of its
            own.
          </Muted>
        </CardContent>
      </Card>
    </div>
  );
}
