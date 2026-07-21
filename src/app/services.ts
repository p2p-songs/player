/**
 * The app's composition root (ARCHITECTURE §3/§8): it constructs the engine and
 * its collaborators once and hands them to the UI. This is the only place the
 * concrete browser implementations are chosen — `HtmlAudioBackend`, `DexieStore`,
 * the real `fetch` transport — so `src/core` stays platform-agnostic and the UI
 * only ever talks to interfaces.
 */
import { AddonCollection, AddonStreamResolver } from "../core/addon/index.js";
import { HtmlAudioBackend } from "../core/audio/html-audio.js";
import { bindMediaSession } from "../core/audio/media-session.js";
import { Engine } from "../core/engine/engine.js";
import { DexieStore, PlayerRepository } from "../core/persistence/index.js";

export interface Services {
  engine: Engine;
  collection: AddonCollection;
  repository: PlayerRepository;
  audio: HtmlAudioBackend;
  /** Tear down side-effectful bindings (MediaSession, audio listeners). */
  dispose: () => void;
}

export function createServices(): Services {
  const collection = new AddonCollection();
  const resolver = new AddonStreamResolver({ providers: () => collection.streamProviders() });
  const audio = new HtmlAudioBackend();
  const engine = new Engine(resolver, audio);
  const repository = new PlayerRepository(new DexieStore());

  // OS media keys / lock screen → engine commands (§4c).
  const unbindMediaSession = bindMediaSession(engine);

  return {
    engine,
    collection,
    repository,
    audio,
    dispose: () => {
      unbindMediaSession();
      engine.destroy();
      audio.destroy();
    },
  };
}
