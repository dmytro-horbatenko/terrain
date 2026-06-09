# syntax=docker/dockerfile:1
#
# Production image for @terrain/api. Build from the REPO ROOT so the build
# stage can see the sibling workspace packages (@terrain/sr-engine,
# @terrain/types) that the api depends on:
#
#   docker build -f apps/api/Dockerfile -t terrain-api .

FROM node:24-bookworm-slim AS base
RUN corepack enable
# Without this, Prisma can't detect the libssl version and warns on every
# invocation, defaulting to a guessed engine target.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# ---- build: full install (incl. devDeps) + compile + generate Prisma client ----
FROM base AS build
COPY . .
RUN yarn install --immutable
# .yarnrc.yml sets enableScripts: false (supply-chain hardening — no arbitrary
# postinstall scripts run), so the Prisma client has to be generated explicitly.
# `generate` never connects to a database, but prisma.config.ts eagerly
# resolves DATABASE_URL via env() and throws if it's unset — a build-time
# placeholder satisfies that; the real URL is injected at container runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN yarn workspace @terrain/api exec prisma generate
RUN yarn workspace @terrain/sr-engine build \
 && yarn workspace @terrain/types build \
 && yarn workspace @terrain/api build
# Prune devDependencies out of node_modules, keeping workspace linking intact.
RUN yarn workspaces focus @terrain/api --production

# ---- runtime: only what's needed to run the compiled server ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /workspace/package.json /workspace/yarn.lock ./
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma

# Base image ships an unprivileged `node` user (uid 1000) — drop root before
# the process starts (OWASP Docker Security Cheat Sheet).
USER node
WORKDIR /workspace/apps/api

EXPOSE 3000
CMD ["node", "dist/src/main"]
