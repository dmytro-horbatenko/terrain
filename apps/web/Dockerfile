# syntax=docker/dockerfile:1
#
# Production image for @terrain/web: builds the Vite SPA, then serves it (and
# reverse-proxies /api) through Caddy for automatic HTTPS. Build from the
# REPO ROOT so the build stage can see sibling workspace packages:
#
#   docker build -f apps/web/Dockerfile -t terrain-web .

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS build
COPY . .
RUN yarn install --immutable
RUN yarn workspace @terrain/sr-engine build \
 && yarn workspace @terrain/types build \
 && yarn workspace @terrain/web build

FROM caddy:2-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /workspace/apps/web/dist /srv/web
EXPOSE 80 443
