# PHONO (player) — static single-page app, built here and served by Caddy.
#
# IMPORTANT: build context is the **p2p-songs parent directory** that contains
# `addon-sdk/`, `addons/` and `player/`. The player depends on
# `@p2p-songs/protocol` (and, for its typecheck/e2e, the SDK + musicmeta +
# stream-legal) through unpublished `link:` paths to those siblings, so all three
# trees must be present and built before `vite build`:
#
#   docker build -f player/deploy/Dockerfile \
#     --build-arg VITE_DEFAULT_METADATA_ADDON_URL=https://<your-musicmeta>/manifest.json \
#     -t phono .
#
# The default **metadata** addon URL is baked in at build time (ARCHITECTURE §11):
# it seeds musicmeta through the ordinary install path, and the player still
# bundles no stream addon and no credentials. Leave the arg empty to seed nothing.
#
# A private deployment may ALSO pre-seed a **stream** addon (self-host operator
# override, §11) so a known audience gets a phono with e.g. Bitbop already wired
# in — pass VITE_DEFAULT_STREAM_ADDON_URL. That URL is CREDENTIAL-BEARING and is
# inlined into the JS bundle: only set it on an instance whose users you'd hand
# the install URL to anyway, and never bake it into a public image. Empty by
# default → the image bundles no stream addon (the neutral, shareable build).

# ---- build stage ----
FROM --platform=$BUILDPLATFORM node:22-slim AS build
ENV CI=1
RUN corepack enable
WORKDIR /app

# SDK first (protocol + sdk) so the player's link: deps resolve.
COPY addon-sdk/ ./addon-sdk/
RUN cd addon-sdk && pnpm install --frozen-lockfile && pnpm -r build

# The addons workspace, because the player link:s musicmeta + stream-legal for
# its typecheck / e2e (dev-only, but the build's `tsc` still resolves them).
COPY addons/ ./addons/
RUN cd addons && pnpm install --frozen-lockfile && pnpm -r build

# Then the player itself.
COPY player/ ./player/
# Vite inlines VITE_* at build time, so the default addon URLs must be present
# now. The stream default is empty unless a private build passes it (see above).
ARG VITE_DEFAULT_METADATA_ADDON_URL=""
ENV VITE_DEFAULT_METADATA_ADDON_URL=$VITE_DEFAULT_METADATA_ADDON_URL
ARG VITE_DEFAULT_STREAM_ADDON_URL=""
ENV VITE_DEFAULT_STREAM_ADDON_URL=$VITE_DEFAULT_STREAM_ADDON_URL
RUN cd player && pnpm install --frozen-lockfile && pnpm build

# ---- runtime stage: static files behind Caddy ----
FROM caddy:2-alpine AS runtime
COPY --from=build /app/player/dist /srv
COPY player/deploy/Caddyfile /etc/caddy/Caddyfile
# Railway injects PORT; the Caddyfile binds it. No EXPOSE needed (Railway maps it).
