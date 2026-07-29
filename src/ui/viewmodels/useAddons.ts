/**
 * Addon collection view-models. **Stream** addons are installed exclusively by a
 * user pasting a manifest URL — the *shipped* player bundles no stream source
 * and no credentials (§11 neutrality). Two defaults may be seeded through this
 * same install path (`app/default-addons.ts`), both off unless a deployment sets
 * their URL: a **metadata** addon (public catalogue data, no sources — doesn't
 * touch neutrality) and, as a self-host operator override, a **stream** addon
 * (credential-bearing; the distributed build still carries none). Saved addons
 * are re-installed into the in-memory collection on boot; a configured URL is
 * credential-bearing, so the UI only ever renders it through `redactManifestUrl`
 * (§6a).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServices } from "../../app/providers.js";
import { redactManifestUrl } from "../../core/persistence/index.js";
import {
  DEFAULT_METADATA_ADDON_URL,
  DEFAULT_STREAM_ADDON_URL,
  seedDefaultMetadataAddon,
  seedDefaultStreamAddon,
} from "../../app/default-addons.js";
import type { Resource } from "@p2p-songs/protocol";

export interface InstalledAddonView {
  id: string;
  name: string;
  /** Redacted for display — never the raw configured URL (§6a). */
  displayUrl: string;
  configured: boolean;
  resources: Resource[];
  /** False when the addon couldn't be reached on this boot. */
  online: boolean;
}

export const ADDONS_KEY = ["addons", "installed"] as const;

/**
 * The installed addons, rehydrating the in-memory collection from the durable
 * record on first read. An addon that can't be reached is still listed (marked
 * offline) rather than silently dropped — the user installed it deliberately.
 */
export function useInstalledAddons() {
  const { collection, repository } = useServices();
  return useQuery({
    queryKey: ADDONS_KEY,
    queryFn: async (): Promise<InstalledAddonView[]> => {
      // Seed the defaults once (no-op after the first success, or if the user
      // has removed them) before listing, so they appear on first boot. The
      // stream default is off unless a private deployment set its URL (§11).
      if (DEFAULT_METADATA_ADDON_URL) {
        await seedDefaultMetadataAddon(collection, repository, { url: DEFAULT_METADATA_ADDON_URL });
      }
      if (DEFAULT_STREAM_ADDON_URL) {
        await seedDefaultStreamAddon(collection, repository, { url: DEFAULT_STREAM_ADDON_URL });
      }
      const saved = await repository.listAddons();
      const views: InstalledAddonView[] = [];
      for (const record of saved) {
        let client = collection.list().find((c) => c.id === record.id);
        if (!client) {
          try {
            client = await collection.install(record.manifestUrl);
          } catch {
            client = undefined; // unreachable right now; keep it listed as offline
          }
        }
        views.push({
          id: record.id,
          name: client?.manifest.name ?? record.name,
          displayUrl: redactManifestUrl(record.manifestUrl),
          configured: record.configured,
          resources: client?.manifest.resources ?? [],
          online: client !== undefined,
        });
      }
      return views;
    },
    staleTime: 0,
  });
}

/** Install by manifest URL, then persist it so it survives a reload. */
export function useInstallAddon() {
  const { collection, repository } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (manifestUrl: string) => {
      const url = manifestUrl.trim();
      const client = await collection.install(url);
      await repository.saveAddon({ id: client.id, manifestUrl: url, name: client.manifest.name });
      return client.manifest.name;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["addons"] }),
  });
}

/** Remove an addon: drop it from the collection and purge its stored URL (§6a). */
export function useRemoveAddon() {
  const { collection, repository } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (addonId: string) => {
      collection.remove(addonId);
      await repository.removeAddon(addonId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["addons"] }),
  });
}
