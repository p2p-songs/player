# player

The p2p-songs web player: a single Vite app with a headless `src/core` engine
(queue · playback FSM · resolution scheduler · addon client · audio ·
persistence) and a themeable `src/ui`. Web-native by design — not an Elm/Rust
port of stremio-core.

**Authoritative design: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).**
Cross-project context (protocol, addons, legal posture): the
[implementation plan](https://github.com/p2p-songs/.github/blob/main/docs/IMPLEMENTATION_PLAN.md).
