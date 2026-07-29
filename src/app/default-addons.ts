/**
 * The default-installed addons (ARCHITECTURE §11).
 *
 * Neutrality governs the **stream plane**: the *shipped* player bundles no
 * stream addon, no credentials, and no source list — a stream addon is only ever
 * installed by a user pasting its manifest URL. A **metadata** addon is a
 * different animal: a MusicBrainz-backed catalogue is public reference data
 * (entity-typed ids, names, posters — no hashes, no sources), so it cannot steer
 * anyone toward a content source. Pre-installing one is a convenience, not a
 * breach of neutrality — the player still ships with nothing that *plays*
 * anything.
 *
 * ### The stream default is a self-host operator override
 *
 * A private deployment may *also* pre-seed a **stream** addon via
 * `VITE_DEFAULT_STREAM_ADDON_URL`. This is deliberately **off by default** and
 * carries no value in the repo, so the shipped/public build still bundles
 * nothing — neutrality of the *distributed player* is intact. It exists for the
 * self-hoster who is standing up a private instance for known users with their
 * *own* credentials (e.g. a friend gets a phono that already has the operator's
 * Bitbop wired in), and the baked URL is credential-bearing: it lands in the JS
 * bundle, so only set it on an instance whose audience you'd hand the install
 * URL to anyway. It seeds through the same ordinary install path, so
 * `saveAddon` marks it `configured` and the UI redacts it (§6a) like any pasted
 * configured addon.
 *
 * Two properties keep both honest:
 *
 * 1. **They go in through the ordinary install path.** A default is just a
 *    manifest URL handed to `AddonCollection.install`, the same call a pasted
 *    URL takes. The engine bakes in no search logic and holds no addon package
 *    at runtime; the player↔addon boundary is exactly as it is for any addon.
 * 2. **Seed once; removal sticks.** A persisted version marker records that a
 *    default was seeded. If the user removes it, the marker stays set and it is
 *    never forced back. A failed seed (the addon unreachable on this boot)
 *    leaves the marker unset, so it is retried next boot until it lands once.
 *
 * The URLs are deployment configuration (`VITE_DEFAULT_METADATA_ADDON_URL` /
 * `VITE_DEFAULT_STREAM_ADDON_URL`). Unset → that default isn't seeded.
 */
import type { AddonCollection } from "../core/addon/index.js";
import type { PlayerRepository } from "../core/persistence/index.js";

/** The default metadata addon's manifest URL, or `undefined` to seed nothing. */
export const DEFAULT_METADATA_ADDON_URL: string | undefined =
  import.meta.env.VITE_DEFAULT_METADATA_ADDON_URL?.trim() || undefined;

/**
 * The default **stream** addon's manifest URL, or `undefined` to seed nothing.
 * Off unless a private deployment sets it (see the module header). The value is
 * credential-bearing when set — never commit a real one.
 */
export const DEFAULT_STREAM_ADDON_URL: string | undefined =
  import.meta.env.VITE_DEFAULT_STREAM_ADDON_URL?.trim() || undefined;

/** Settings key holding the metadata default's last seed version (0 = never). */
export const DEFAULTS_SEED_KEY = "defaults.metadataAddon.seeded";

/** Settings key holding the stream default's last seed version (0 = never). */
export const STREAM_DEFAULTS_SEED_KEY = "defaults.streamAddon.seeded";

/**
 * Bump when the *identity* of a default changes (a new default addon), so it
 * re-seeds once. Do **not** bump for the same addon at a new URL — that would
 * re-add an addon the user may have deliberately removed.
 */
export const DEFAULTS_SEED_VERSION = 1;

/**
 * Install a default addon exactly once, respecting a prior removal, keyed by its
 * own settings marker so each default (metadata, stream) tracks independently. A
 * no-op when already seeded. Pure and injectable — the collection and repository
 * are passed in — so it is tested with fakes, no env, no network.
 */
async function seedDefaultAddon(
  collection: AddonCollection,
  repository: PlayerRepository,
  opts: { url: string; settingsKey: string; version?: number },
): Promise<void> {
  const version = opts.version ?? DEFAULTS_SEED_VERSION;
  const seeded = await repository.getSetting<number>(opts.settingsKey, 0);
  if (seeded >= version) return; // already seeded, or seeded-then-removed — never force it back

  try {
    const client = await collection.install(opts.url);
    await repository.saveAddon({ id: client.id, manifestUrl: opts.url, name: client.manifest.name });
    await repository.setSetting(opts.settingsKey, version);
  } catch {
    // Unreachable on this boot: leave the marker unset so we retry next boot.
    // (A user-installed addon that fails is kept as "offline"; a default that
    // never installed simply isn't there yet.)
  }
}

/** Seed the default **metadata** addon once (see {@link seedDefaultAddon}). */
export function seedDefaultMetadataAddon(
  collection: AddonCollection,
  repository: PlayerRepository,
  opts: { url: string; version?: number },
): Promise<void> {
  return seedDefaultAddon(collection, repository, { ...opts, settingsKey: DEFAULTS_SEED_KEY });
}

/**
 * Seed the default **stream** addon once (self-host override; see the module
 * header). Same once-and-removal-sticks semantics as the metadata default, under
 * a separate marker.
 */
export function seedDefaultStreamAddon(
  collection: AddonCollection,
  repository: PlayerRepository,
  opts: { url: string; version?: number },
): Promise<void> {
  return seedDefaultAddon(collection, repository, { ...opts, settingsKey: STREAM_DEFAULTS_SEED_KEY });
}
