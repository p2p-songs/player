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
- Never bundle, default-install, or hardcode any specific **stream** addon
  (including `stream-debrid`), and never bundle credentials — neutrality
  governs the *stream plane*. Stream addons are installed exclusively by the
  user pasting a manifest URL. **One exception:** a default *metadata* addon
  (MusicBrainz catalogue — public data, no sources) may be seeded, through the
  ordinary `install(manifestUrl)` path, once, with removal respected. See
  `app/default-addons.ts` and ARCHITECTURE §11. This is what keeps this repo as
  neutral as Stremio-the-app (which likewise bundles only Cinemeta).
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
  goes through it); `store.ts` is the tiny Zustand UI store;
  **`security/`** is the §6a browser threat model (below).
- **`src/app/security/` — the §6a gate (landed 2026-07-21, before the first
  credential-bearing addon, `bitbop`).** `csp.ts` builds the policy; a Vite
  `transformIndexHtml` plugin injects it as `<meta http-equiv>` so it applies on
  any static host. Prod is **`script-src 'self'`** (no inline, no eval) +
  `object-src`/`base-uri`/`frame-ancestors`/`form-action` `'none'` +
  `require-trusted-types-for 'script'`; dev relaxes script-src for HMR only.
  Vite's **modulepreload polyfill is off** — it's an inline `<script>`, and the
  build must emit none. **Verify against `dist/index.html`, not the source.**
  `redact.ts` masks a configured URL's config segment inside *arbitrary text*;
  `ErrorBoundary` logs only that, never the error object or React's `errorInfo`.
  **Known-honest limits:** `connect-src`/`img-src`/`media-src` allow arbitrary
  `https:` (addons are user-installed URLs on unknowable hosts), so CSP guards
  against *injected* code, not a trusted addon's host; and the Trusted Types
  `'default'` policy currently passes through with a redacted warning — a
  monitored escape hatch, to be tightened to a throw after a real-browser pass.
- **`src/ui/`** — `globals.css` (the whole visual definition), `viewmodels/`
  (headless hooks over the engine — components own no playback logic, §8a),
  `components/`, `screens/`. RetroUI's copied-in components live one level up in
  `src/components/ui/`.
- **Screens:** Addons (install by manifest URL only — nothing bundled, §11;
  URLs shown via `redactManifestUrl`, §6a), Search (one box, all types at once),
  Artist and Album detail, Home (recently played from history), Library,
  minimal Settings, plus the queue drawer and persistent player bar.
- **Library holds identity, not media (§6).** A saved album is an id plus what a
  row needs to draw — never a track listing, never a stream — so one save path
  covers all three kinds: the player-bar heart for a song, Save on the album
  screen, Follow on the artist screen. `useToggleSaved` takes a `SavedItem`
  rather than a `TrackRef` for exactly that reason. The screen tabs
  All/Songs/Albums/Artists over one collection sorted by save time, which is why
  **All** is the default — it's the only tab that answers "what did I just add?".
  Playlists are stored by the repository and filtered *out* of this screen: they
  have no detail screen yet, so they'd be rows that go nowhere.
- **Nav is a stack in the UI store, not local shell state.** `detail: Detail[]`
  sits beside `view`, and `setView` clears it in the same `set` — held in the
  shell instead, switching primary view rendered one frame of the *old* view's
  detail screen. One stack serves every view that can drill down, so
  search → artist → album and library → artist → album are the same code path.
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
- **Artists search + artist screen (2026-07-22).** A third search tab, and
  `ArtistScreen` showing the discography — because an artist result is only an
  id and a name, so without it finding an artist was a dead end. The list comes
  from a *catalog* (`byArtist` + `artistId`), not the artist's `meta`: a
  discography is a list of items, and the rows are ordinary album previews, so
  opening one reuses `AlbumScreen` unchanged. `AddonCollection.catalogById`
  generalises the search fan-out (same isolation/dedup/deadline rules) and
  selects the catalog **by id** — reusing search's "any catalog with a `search`
  extra" would have fired an unrelated argument-less search, since `album` now
  has two catalogs.
- **The look — RetroUI (2026-07-22).** **There is no theming.** One shipped
  design, not selectable or installable. Built on
  [RetroUI](https://retroui.dev/), a neobrutalist **shadcn registry**: components
  are copied into `src/components/ui/` (CLI-managed, we own the source) over
  Radix primitives — which is where the dialog/select/tabs accessibility we were
  otherwise hand-rolling comes from. Tailwind v4; `src/ui/globals.css` is the
  entire visual definition (PHONO palette: cream, ink, burnt orange, gold).
  **The signature is that `--border` is ink and shadows are hard offsets of it**
  (`4px 4px 0 var(--border)`, never a blur).
  **Don't regress — screens compose and lay out, they never carry visual utility
  classes.** Borders/shadows/colours live in `globals.css`,
  `src/components/ui/*`, or `src/ui/components/primitives.tsx`. Utilities
  scattered across screens is the same failure as hardcoded hex, and nothing can
  catch it. Local edits inside `src/components/ui/` are clobbered by
  `shadcn add --overwrite`; prefer changing tokens.
  **`globals.css`'s `@custom-variant` block is required, not decorative.** The
  registry's components are written against shorthand state variants
  (`data-active:`, `data-horizontal:`, `data-open:`) while Radix emits
  `data-state="active"`, `data-orientation="horizontal"`. Without the bridge
  Tailwind compiles `data-active:` to the literal `[data-active]`, which matches
  nothing — **no error, every state style silently inert.** That shipped: Tabs
  never became a column and never marked the selected tab, so the Library tab
  bar stretched to full height and grew with the list beside it.
  `src/ui/design-system.test.ts` now fails on any shorthand variant the CSS
  doesn't declare (and any declaration nothing uses); it needs `css: true` in
  `vitest.config.ts`, because Vitest otherwise stubs the `?raw` CSS read to an
  empty string and the test passes while checking nothing.
  `ProceduralArt.tsx` (deterministic per release id, pure CSS over tokens) is the
  one visual piece no registry provides. Superseded, with reasoning, in
  ARCHITECTURE §7a: component theming, then data-only installable themes — the
  second was secure but delivered no character, because the real gap was the
  component layer, not the styling layer.
- **Search is one box, debounced (2026-07-22).** No type tabs — people type
  "justin bieber baby", an artist *and* a song, so making them pick a category
  first asks a question they can't answer. `useUnifiedSearch` fans out to all
  three types and merges them into **one relevance-ordered list** (sectioning
  buried the obvious hit — a song-title query pushed the song below every album
  pressing sharing its name). The merge sorts by each hit's `rankingScore`
  (Meili relevance, forwarded by musicmeta as an optional `metaPreview` field);
  equal scores break **artist → track → album** (an artist tops the score only
  when the query names it; below that a search box wants to play). One type
  failing doesn't fail the search, only a clean sweep does. The merged list then
  **collapses duplicate rows** (one song exists as many recordings — single /
  album / deluxe / explicit — that would otherwise render as identical lines,
  keeping the highest-ranked) and makes each row's **kind legible** — woven into
  the subtitle ("Song · <artist>" / "Album · <artist>" / "Artist") where the eye
  already goes, plus an artwork shape cue (artist = circle, album = stacked
  square, song = square with a play badge) — so a mixed list reads at a glance
  without hunting a trailing badge.
  - **A song played from search carries album context (`releaseId`), not just its
    recording (2026-07-25).** `previewToTrack` threads the track hit's `releaseId`
    into the queued `TrackRef`, and the stream request forwards it — so a
    search-play resolves album-scoped, the same way `albumToTracks` makes an
    album-screen play work. Without it a bare recording is on dozens of releases
    and the stream addon searches artist+title alone: a new single-release song
    played from search but a much-pressed 2010 song didn't (it did from the album
    screen). musicmeta supplies `releaseId` on track previews (see its README).
  **`useDebounced` is load-bearing, not polish.** Search had no debounce and got
  away with it at one request per keystroke; three per keystroke turned an
  18-character phrase into **54 requests**, and against MusicBrainz's 1 req/sec
  limit the real search queued past the 15s provider deadline and reported
  "couldn't reach any addon" while every addon was healthy. Aborting does not
  help — the browser drops the socket but the addon's upstream queue keeps
  draining, so the only fix is not making the request.
- **Transport (2026-07-22) — `ui/components/transport.tsx`** is the vocabulary
  the player bar and the now-playing view both compose from.
  - **Icons are drawn, not typed.** They were emoji; `🔁` rendered in the
    platform's *colour* emoji font — a blue badge in a burnt-orange design.
    Lucide paths take `currentColor`.
  - **`Scrubber` commits on release.** Bound straight to `seek`, a drag issues a
    seek per pointer move — dozens of `currentTime` writes, each re-buffering,
    so the audio stutters through the drag and lands late. Radix's
    `onValueChange` (live) / `onValueCommit` (release) split is the fix; the
    dragged position is shown locally until commit. Dropping the local value on
    commit is safe *only because* `Engine.seek` dispatches its `POSITION`
    synchronously — otherwise the handle snaps back for a frame.
  - **`useVolume` persists** (`volume`/`muted` settings), also on commit, not on
    change: a write per pointer move would queue dozens of IndexedDB
    transactions for a number nobody has finished choosing.
- **Now playing (`screens/NowPlayingScreen.tsx`)** is an overlay over the whole
  shell, not a `View` — it covers the sidebar and bar and returns you to the
  screen you were on. Built on the **Radix dialog primitive** (not
  `components/ui/dialog`, whose content is a centred card): "covers everything"
  has to hold for the keyboard too — focus trap, Escape, focus restore, the rest
  inert. It deliberately omits the mockup's source *picker*, add-to-playlist and
  autoplay-radio: those features don't exist, and drawing their controls is how
  a UI starts lying. The source *readout* is real.
- **`--player-bar-h`** is one token because three places must agree on the bar's
  height (shell grid row, queue drawer `bottom`, playback alert `bottom`).
- **Row affordances are one vocabulary, applied everywhere (2026-07-22).**
  **A play badge on the artwork means the row plays; a chevron means it opens.**
  A trailing `▶` vs `›` did not work: they're a few pixels apart in meaning, sit
  in the corner of the eye, and say nothing until you've learned them. The badge
  appears under the pointer at the instant of the click and only on rows that
  play (`PlayableArtwork`; `RowIndex playable` for rows with a number instead of
  art). Artists are additionally **circular** — near-universal, and it separates
  an artist row from an album row before any text is read. Applies to library,
  search, home, queue, album and artist screens alike.
- **`Row`'s frame owns the background, not its button.** A row with a trailing
  `action` can't nest one button in another; a body button *beside* the action
  made the hover highlight stop short and split the row in two. The frame
  highlights, the body button is transparent and padded clear, the action layers
  over it. The frame is also the `group` the badges hang off.
- **`RowAction` reveals on hover/focus** — removing is infrequent and mildly
  destructive, and four `Remove` buttons in a column read as the page's primary
  action. Its `label` carries the whole meaning and uses the verb for the kind
  ("Unfollow Taylor Swift"), because the app already saves three ways (heart /
  Save / Follow) and a bare "Remove" would be a fourth vocabulary.
- **Chrome surfaces need `ChromeButton`, never RetroUI's `outline`/`ghost`.**
  Those variants are built for the cream canvas: `outline` sets `bg-background`
  and *no* text colour, so on chrome it inherits `--chrome-foreground` and
  renders cream on cream. Minimize/Like/Album shipped invisible that way. The
  same trap applies to any registry component dropped onto `bg-chrome`.
- **`PlaybackAlert` is dismissible, keyed by the problem text, in the UI store.**
  Keyed, because a boolean would silence every *later* failure too — the exact
  silent-failure bug the component exists to fix; leaving the error state clears
  the key. In the store, because it renders in two places (fixed above the bar,
  inline inside the now-playing overlay — pinned, it landed on the overlay's own
  transport), and component state resurrected a dismissed alert on minimise.
- **The vinyl pauses via `animation-play-state`, not by dropping the class.**
  Removing it resets `transform` to none, so the record snapped upright on pause
  and jumped on resume. It spins on `isPlaying` only — a failed resolve leaves it
  correctly still.
- **The tonearm's angles are solved, not eyeballed** (`vinyl-geometry.ts`, tested
  in `vinyl-geometry.test.ts`). Every dimension is a fraction of the record's
  diameter so the arm scales with `size`; the needle must land between the label
  (0.18) and the rim (0.50) when playing, and outside the rim when parked. Change
  `ARM_LENGTH` or the pivot and those have to be re-solved — the test is what
  says so, because a needle hovering over the label typechecks and builds fine.
  The assembly is one rotating element carrying counterweight, shaft and
  headshell: three animated in parallel drift apart at the edges of the easing.
  **The tracking wobble is a second nested element** — one element has one
  `transform`, and the lift/lower is a *transition* while the wobble is a looping
  *animation*, so they overwrite each other unless composed by nesting (shared
  `transform-origin` keeps both about the bearing). Its period is deliberately
  the same 6s as `disc`: an off-centre spindle hole swings the arm once per
  revolution, and a wobble on its own timing reads as a loose fitting instead.
- **Deliberately not built:** router (nav is a stack in the UI store — browser
  Back still exits the app), source-picker modal, Playlists tab,
  responsive/mobile layout.

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
