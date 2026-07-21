# CLAUDE.md — player

## Scope
The p2p-songs player: a web-only client app plus a headless core engine
(queue model + playback state machine + resolution/prefetch scheduler +
addon client). Owns addon collection, aggregated catalog/search, library,
and playback. Talks to addons only over the HTTP+JSON protocol — never
anything addon-specific.

**Architecture is specified in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
in this repo — read it first.** It is a deliberate, web-native design, NOT a
port of stremio-core: no Elm/Rust, a scoped playback state machine
(hand-rolled discriminated-union reducer FSM — decided, §4b) for predictable
state, TanStack Query for metadata + a separate scheduler-owned command plane
for `/stream`, Dexie for the library, Zustand for session state,
dual-`<audio>` crossfade, MediaSession + PWA, and an **optional** accounts/sync
layer (self-hosted backend, §6b). It supersedes the "Elm-style `music-core`"
language in the master plan.

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
- **Accounts/sync is optional and additive (§6b):** the app works fully
  logged-out. Logged in, durable state (incl. configured addon URLs) syncs to
  the user's own self-hosted backend (`backend` repo) — the sync *adapter*
  lives in this repo. Syncing the configured URL (which carries the debrid key)
  is an accepted, server-readable model (Stremio's); resolved stream URLs never
  sync. No remote UI/theme code (same-origin credential threat). See §6b.

## Status
**P-1 headless engine — DONE (2026-07-20).** The package is set up (TS + vitest;
consumes `@p2p-songs/protocol` via `link:` to the sibling addon-sdk checkout).
All pure/headless, driven by a fake audio backend + fake resolver. **38 tests;
typecheck + build green.**
- **`src/core/queue`** (§4a) — stable-`QueueItemId` model; `canonicalOrder`/
  `playOrder`; non-destructive shuffle (current-first, injected rng); repeat
  off/one/all; up-next from play order (the shuffle-bug fix); insert/remove/move
  consistent; memory-only `resolution` + `resetResolutions` for hydration.
- **`src/core/playback`** (§4b) — hand-rolled discriminated-union FSM; pure/total
  `transition`; **stamp `{epoch,itemId,attemptId}` validation** drops stale async
  completions.
- **`src/core/scheduler`** (§5/§5a) — resolution command plane: dedup by
  operation-id stamp, no retry/refetch, supersede+abort, `cancelExcept`,
  memory-only. Behind a `Resolver` interface (fake for P-1).
- **`src/core/audio`** (§4c) — narrow `AudioBackend` interface + a controllable
  fake; load/preload carry a token so completions tie back to their attempt.
- **`src/core/engine`** — the orchestrator: JIT prefetch (next 1–2 on play),
  fallback (walk ranked streams → re-resolve once → skip-ahead), the **bounded
  failure circuit-breaker** (resets on a successful play), and the full
  engine-level **async-race matrix**. **Stamp-gating covers the queue-resolution
  cache, not just the FSM (audit A-007):** a per-item `resolutionOp` attemptId is
  checked before every `QueueItem.resolution` commit, so a superseded resolve
  can't poison the cache with a stale bearer URL. Adding the first item to an
  empty queue sets a cursor (+ `play()` falls back to `playOrder[0]`).

**A-007 (2026-07-20) reconciled.** consecutive-threshold vs sweep-set is a
deliberate simplification (still current). 46 tests at P-1.

**P-3 headless slice — DONE (2026-07-21); A-008 reconciled.** The real addon
client (**`src/core/addon/`**) — the player's HTTP+JSON consumer of installed
addons — now fills the `Resolver` seam the P-1 fake occupied. **97 tests;
typecheck + build + live-HTTP e2e green.**
- **`http.ts`** — narrow injectable transport + the **outage-vs-empty**
  classification everything else keys off: network/5xx/auth/malformed → provider
  down; 404/benign-4xx → "no answer" (not an outage).
- **`endpoints.ts`** — request-URL builder, the inverse of the SDK router's
  parser; `https`-only except a **loopback `http`** exception for local addons
  (§6a).
- **`client.ts`** — manifest-aware `AddonClient`: `supports`/`handlesType`/
  `handlesId` gating, and **validates every response against the
  `@p2p-songs/protocol` schema** before it reaches the engine (addons are
  untrusted input). No direct `zod` dep — a structural `Validator` interface.
- **`provider-health.ts` + `stream-resolver.ts`** — `AddonStreamResolver`
  (`implements Resolver`): fan `/stream` across stream addons, merge url-bearing
  streams, **provider-wide exponential backoff** (the P-3 half of "failure is
  bounded", §4b — distinguishes a down addon from a track that isn't there).
  **Each provider runs under its own bounded, abortable deadline
  (`providerTimeoutMs`) and results never reject (audit A-008)** — one hung addon
  can't wedge the resolve; a timeout → unreachable/backoff, an outer-signal skip →
  cancelled (no backoff). It stays a *plain* resolver; the command-plane
  semantics (§5a) remain the Scheduler's job.
- **`collection.ts`** — `AddonCollection`: install-by-URL (no bundled addon,
  §11), plane views (`streamProviders()`, `getMeta`). **`getMeta` isolates a
  down/malformed provider and falls through to the next capable addon (audit
  A-008)**, surfacing an aggregate error only when none was reachable.
- **`tests/e2e-addon.test.ts`** — boots the **real** `stream-legal` + `musicmeta`
  (built with the real SDK) over **real HTTP** with fixture-injected upstreams;
  drives `AddonCollection` + `AddonStreamResolver` + `Engine` end to end
  (metadata plane + resolve→buffer→play). Proves the wire grammar can't drift.
- **Metadata query-plane note:** the transport+validation is here; the TanStack
  Query *policy* wrapper lives with the `QueryClient` in the app/UI layer (P-5),
  not `src/core` (ARCHITECTURE §5a). The `addon-sdk`/`stream-legal`/`musicmeta`
  packages are **test-only** devDeps (link:) — no runtime addon dependency.

**P-2 real audio subsystem — DONE (2026-07-21).** The browser audio backend
(**`src/core/audio/`**) behind the existing `AudioBackend` interface. **121 tests;
typecheck + `vite build` green.**
- **`html-audio.ts`** — `HtmlAudioBackend` over **two ping-ponged media elements**:
  `preload` buffers the next URL on the idle element; `load` of a preloaded URL
  **swaps** to it (gapless) instead of reloading — **pausing the outgoing element**
  so both tracks never play at once (found via the harness smoke). Tokened events (`loaded`/`ended`/
  `error`/`position`) echo each element's token so late completions drop by
  identity (§4b); `ended`/`position` only from the active element; a rejected
  `play()` (autoplay policy) is swallowed. **`crossfadeTo`** ramps `element.volume`
  over an injectable ticker (never Web Audio — CORS, §4c).
- **`media-element.ts`** — the narrow `MediaElementLike` seam + `Ticker`, injected
  so the backend is **unit-tested in node** against fakes (`fake-media-element.ts`);
  real factory = `new Audio()`. No happy-dom/jsdom.
- **`media-session.ts`** — `bindMediaSession` mirrors current-track metadata +
  play/pause to `navigator.mediaSession` and routes its actions back to engine
  commands; no-op where unavailable; tested against a fake session.
- **Engine preload wiring (§5.2):** `prefetchUpcoming` calls `audio.preload` for
  the immediate-next resolved item, so the swap is live.
- **`harness/`** — throwaway Vite page (`pnpm harness`) driving the real backend
  with hardcoded direct URLs for the **manual audible smoke** (the one thing
  headless tests can't assert — see `harness/README.md`). `vite` is a devDep for
  this only.
- **Deferred:** the anticipatory crossfade *trigger* (start fade before track end)
  → position-timing work (§4b/§4c); the mechanism + gapless-swap default are done.

**Testing/tooling note:** run `./node_modules/.bin/tsc …` / `vitest` directly —
pnpm's pre-run auto-install re-prompts for the esbuild build script. Tests use a
dedicated `vitest.config.ts` (the harness `vite.config.ts` sets `root: harness`).
The addon devDeps are wired as `node_modules/@p2p-songs/*` symlinks (like
`protocol`).

**P-4 persistence + catalog fan-out — DONE (2026-07-21); A-009 reconciled.**
**166 tests; typecheck + build + built-output probes green.**
- **`src/core/persistence/`** (§6) — a **store port + adapters**, not a direct
  Dexie binding (§9 decision 2): `PlayerRepository` owns the rules and is tested
  against `MemoryStore`; `DexieStore` is the thin IndexedDB adapter, proven with
  `fake-indexeddb` (incl. surviving a fresh connection = reload, and a real
  v1→v2 schema upgrade). Covers library, playlists, installed addons, settings,
  **play history**, queue identity; every record has `updatedAt` for the P-7
  sync adapter.
- **Atomicity is a port primitive (A-009):** every read-modify-write goes through
  `PersistenceStore.update` (Dexie `rw` transaction / synchronous memory
  section). Never hand-roll `get`+`put` — two overlapping playlist edits would
  silently discard one.
- **Play history** — identity-only `PlayEvent { id, track, playedAt }` (a
  `TrackRef`, never the resolved stream), retention-capped (`historyLimit`, 500).
- **Two load-bearing rules, enforced + tested:** *persist identity, not resolved
  media* — `saveQueue` strips every `resolution`, `loadQueue` rebuilds each item
  `idle`, asserted down to "the bearer URL never reaches the store"; and
  *installed addons are secret-bearing* (§6a) — own table, `configured` flag,
  `redactManifestUrl()` the only sanctioned way to render one.
- **`AddonCollection.search`** (§6) — cross-addon catalog fan-out: parallel over
  every addon advertising a searchable catalog for the type, **merged + deduped
  by content id** (install-order priority).
- **`core/addon/fan-out.ts` — one bounded-fan-out helper.** `askBounded` backs the
  stream resolver, `getMeta`, and `search`. Folding `getMeta` onto it also closed
  a latent hung-provider stall in its sequential walk. Its deadline is a **hard**
  bound (A-009): it races the task against a timer it owns, so a transport that
  ignores its abort signal can't wedge a fan-out — aborting alone is only
  cooperative. Abandoned tasks are rejection-safe (no unhandled rejections).
- **Deferred:** wiring the repository to the engine (debounced autosave +
  hydrate-on-boot) belongs with the app shell in **P-5**; playlist item-grain
  modelling is a P-7 sync refinement (§6b).

**P-5 app (minimal e2e slice) — DONE (2026-07-21).** **172 tests; typecheck +
`vite build` green; verified by hand against live `musicmeta` + `stream-legal`.**
The app is a React/Vite shell at `index.html` → `src/app/main.tsx`.
- **`src/app/`** — composition root. `services.ts` picks the concrete browser
  implementations (`HtmlAudioBackend`, `DexieStore`, real `fetch`) so `src/core`
  stays platform-agnostic; `providers.tsx` holds the **TanStack Query client**,
  finally closing §5a's deferred metadata-plane policy (`/stream` still never
  goes through it); `store.ts` is the tiny Zustand UI store.
- **`src/ui/`** — `tokens.css` (the one reference theme, "Dark (Espresso)"),
  `viewmodels/` (headless hooks over the engine — components own no playback
  logic, §8a), `components/`, `screens/`.
- **Screens:** Addons (install by manifest URL only — nothing bundled, §11;
  URLs shown via `redactManifestUrl`, §6a), Search (cross-addon, Songs/Albums),
  Album detail, Home (recently played from history), Library (liked), minimal
  Settings, plus the queue drawer and persistent player bar.
- **`usePersistSession`** wires the repository to the engine — the P-4 deferral:
  hydrate the queue on boot, debounced autosave, record plays. Needed
  **`Engine.restoreQueue`** so a restored session keeps its *stable ids* instead
  of rebuilding them (and forces every item back to `idle`).
- **`SessionAutosave`** (`core/persistence`) owns the debounce; the hook only
  decides when to feed and flush it. Two rules, both A-010 fixes: **only a
  changed queue reschedules** (the engine notifies ~4×/s on position ticks, and
  a debounce reset by those never fires — the queue went unsaved for the whole
  of playback), and **a pending snapshot is flushed, not dropped**, on
  `visibilitychange`→hidden, `pagehide`, and teardown. A rejected write keeps
  the snapshot pending for the next edit or flush instead of leaving a stale
  durable copy — but never spins retrying.
- **`Engine.getState()` is now referentially stable** — it memoizes until
  `queue`/`playback` actually change. Returning a fresh object each call made
  `useSyncExternalStore` loop infinitely; snapshot stability is an engine
  contract, not a UI workaround. Regression-tested.
- **`HtmlAudioBackend.setVolume`** — master volume composed with the crossfade
  gain (`element.volume = master × gain`) so the two don't overwrite each other.
- **Failure is visible:** `PlaybackAlert` surfaces the resolver's actual reason
  ("no source has this track" vs "no stream addon installed" vs "addons
  unreachable"). Silent failure was the worst bug found in manual testing.
- **Deliberately not built:** router (nav is local state), theme *contract/
  registry* (only the token layer — one theme, so the seam isn't earned yet),
  source-picker modal, Artists/Playlists tabs.

Next: **P-6** (PWA) or **P-7** (accounts/sync), or fill the addon gap —
`stream-debrid` / `stream-ytmusic` are still unbuilt, and with only
`stream-legal` most searched tracks legitimately have no source. A small
**position-timing** follow-up would close three deferrals at once (a monitor over
the real `timeupdate` stream vs `track.durationMs`): the ~30 s re-prefetch net,
the anticipatory crossfade trigger (§4c), and precise `setPositionState`. Also
deferred: cross-provider stream ranking.
Build order: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) §10.

## Being audited?
If you're the adversarial reviewer, not the implementer: start at
[`p2p-songs/.github` — `docs/ADVERSARIAL_REVIEW_CONTRACT.md`](https://github.com/p2p-songs/.github/blob/main/docs/ADVERSARIAL_REVIEW_CONTRACT.md),
not this file.
