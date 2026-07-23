/**
 * The one default-installed addon (ARCHITECTURE §11).
 *
 * Neutrality governs the **stream plane**: the player bundles no stream addon,
 * no credentials, and no source list — a stream addon is only ever installed by
 * a user pasting its manifest URL. A **metadata** addon is a different animal: a
 * MusicBrainz-backed catalogue is public reference data (entity-typed ids,
 * names, posters — no hashes, no sources), so it cannot steer anyone toward a
 * content source. Pre-installing one is therefore a convenience, not a breach of
 * neutrality — the player still ships with nothing that *plays* anything.
 *
 * Two properties keep this honest:
 *
 * 1. **It goes in through the ordinary install path.** The default is just a
 *    manifest URL handed to `AddonCollection.install`, the same call a pasted
 *    URL takes. The engine bakes in no search logic and holds no addon package
 *    at runtime; the player↔addon boundary is exactly as it is for any addon.
 * 2. **Seed once; removal sticks.** A persisted version marker records that the
 *    default was seeded. If the user removes it, the marker stays set and it is
 *    never forced back. A failed seed (the addon unreachable on this boot)
 *    leaves the marker unset, so it is retried next boot until it lands once.
 *
 * The URL itself is deployment configuration (`VITE_DEFAULT_METADATA_ADDON_URL`,
 * with a localhost default for dev in `.env.development`). Unset → no default is
 * seeded, and the player is back to bundling nothing at all.
 */
import type { AddonCollection } from "../core/addon/index.js";
import type { PlayerRepository } from "../core/persistence/index.js";

/** The default metadata addon's manifest URL, or `undefined` to seed nothing. */
export const DEFAULT_METADATA_ADDON_URL: string | undefined =
  import.meta.env.VITE_DEFAULT_METADATA_ADDON_URL?.trim() || undefined;

/** Settings key holding the last seed version applied (0 = never). */
export const DEFAULTS_SEED_KEY = "defaults.metadataAddon.seeded";

/**
 * Bump when the *identity* of the default changes (a new default addon), so it
 * re-seeds once. Do **not** bump for the same addon at a new URL — that would
 * re-add an addon the user may have deliberately removed.
 */
export const DEFAULTS_SEED_VERSION = 1;

/**
 * Install the default metadata addon exactly once, respecting a prior removal.
 * A no-op when already seeded. Pure and injectable — the collection and
 * repository are passed in — so it is tested with fakes, no env, no network.
 */
export async function seedDefaultMetadataAddon(
  collection: AddonCollection,
  repository: PlayerRepository,
  opts: { url: string; version?: number },
): Promise<void> {
  const version = opts.version ?? DEFAULTS_SEED_VERSION;
  const seeded = await repository.getSetting<number>(DEFAULTS_SEED_KEY, 0);
  if (seeded >= version) return; // already seeded, or seeded-then-removed — never force it back

  try {
    const client = await collection.install(opts.url);
    await repository.saveAddon({ id: client.id, manifestUrl: opts.url, name: client.manifest.name });
    await repository.setSetting(DEFAULTS_SEED_KEY, version);
  } catch {
    // Unreachable on this boot: leave the marker unset so we retry next boot.
    // (A user-installed addon that fails is kept as "offline"; a default that
    // never installed simply isn't there yet.)
  }
}
