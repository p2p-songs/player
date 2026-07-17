# CLAUDE.md — player

## Scope
The p2p-songs player: a web-only client app plus a headless core engine
(queue model + playback state machine + resolution/prefetch scheduler +
addon client). Owns addon collection, aggregated catalog/search, library,
and playback. Talks to addons only over the HTTP+JSON protocol — never
anything addon-specific.

**Architecture is specified in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
in this repo — read it first.** It is a deliberate, web-native design, NOT a
port of stremio-core: no Elm/Rust, a scoped playback state machine (XState
or reducer) for predictable state, TanStack Query for addon HTTP, Dexie for
the library, Zustand for session state, dual-`<audio>` crossfade, MediaSession
+ PWA. It supersedes the "Elm-style `music-core`" language in the master plan.

Master plan (protocol/addons/legal context, unchanged): [`p2p-songs/.github` — `docs/IMPLEMENTATION_PLAN.md`](https://github.com/p2p-songs/.github/blob/main/docs/IMPLEMENTATION_PLAN.md).

## Before implementation
Read `../.github/docs/audits/README.md` and its first (latest) report before
starting work. The registry owns current sign-off and supersession; do not rely
only on issue notifications.

## Invariants this repo must hold (see `.github`'s `docs/REVIEW_CHECKLIST.md` §1, §7, §8 and `docs/ARCHITECTURE.md` §11)
- Never bundle, default-install, or hardcode any specific stream addon
  (including `stream-debrid`). Addon installation is exclusively "user
  pastes a manifest URL." This is what keeps this repo as neutral as
  Stremio-the-app.
- The player never has its own debrid account and never bundles credentials.
  BUT a *configured* addon's manifest URL contains the user's debrid key, and
  the player necessarily holds it — so configured URLs are treated as secrets
  (stored as credential material, never logged/exported, redacted in UI, not
  SW-cached). See ARCHITECTURE §6a. (Do not repeat the old, false "no keys in
  the player" claim.)
- Resolved stream URLs / `QueueItem.resolution` and the `/stream` query cache
  are memory-only — never persisted; queue items hydrate to `resolution: idle`.
  See ARCHITECTURE §6.
- `src/core` imports nothing from `src/ui` (lint-enforced). The engine
  stays headless-testable.
- Stream resolution is just-in-time for the next 1-2 queue items, never
  whole-queue-upfront (debrid links expire; don't hammer debrid APIs).

## Status
Scaffolding + architecture plan only. No engine or UI code yet. Build order
is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §10: P-1 headless
engine (fakes) → P-2 audio subsystem → P-3 addon client → P-4 persistence →
P-5 UI → P-6 PWA. P-1/P-2 have no cross-repo dependency and can start now.

## Being audited?
If you're the adversarial reviewer, not the implementer: start at
[`p2p-songs/.github` — `docs/ADVERSARIAL_REVIEW_CONTRACT.md`](https://github.com/p2p-songs/.github/blob/main/docs/ADVERSARIAL_REVIEW_CONTRACT.md),
not this file.
