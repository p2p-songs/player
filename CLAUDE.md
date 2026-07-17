# CLAUDE.md — player

## Scope
The p2p-songs player: the client app plus `music-core`, an Elm-style state
machine (`Msg -> Effects -> Model`) modeled on `stremio-core`'s runtime.
Owns addon collection, aggregated catalog/search, library, and player
state. Talks to addons only over the HTTP+JSON protocol defined in the
plan — never anything addon-specific.

Full architecture: [`p2p-songs/.github` — `docs/IMPLEMENTATION_PLAN.md`](https://github.com/p2p-songs/.github/blob/main/docs/IMPLEMENTATION_PLAN.md), §1, §5, §6, §7, §10 (Phases 4-5, and stretch Phase 6).

## Invariants this repo must hold (see `.github`'s `docs/REVIEW_CHECKLIST.md` §1, §7, §8)
- Never bundle, default-install, or hardcode any specific stream addon
  (including `stream-debrid`). Addon installation is exclusively "user
  pastes a manifest URL." This is what keeps this repo as neutral as
  Stremio-the-app.
- No debrid credentials, indexer config, or other addon-specific secrets
  ever live here — that config lives only inside an addon's own
  `/configure`-encoded URL, never in player state or committed files.
- `music-core` stays plain TypeScript, Elm-style. A Rust/WASM port is an
  explicit stretch phase (Phase 6) — don't reach for it before Phases 1-5
  elsewhere in the project are otherwise done; that sequencing was
  deliberate, not an oversight.

## Status
Scaffolding only (this file + README). No `music-core` or player-app code
yet. Next: Phase 4 (`music-core`, headless), then Phase 5 (player app UI).

## Being audited?
If you're the adversarial reviewer, not the implementer: start at
[`p2p-songs/.github` — `docs/ADVERSARIAL_REVIEW_CONTRACT.md`](https://github.com/p2p-songs/.github/blob/main/docs/ADVERSARIAL_REVIEW_CONTRACT.md),
not this file.
