# Terrain — agent & contributor guide

**Terrain** is a personal **Learning OS**: spaced-repetition (SM-2) + a living
knowledge graph. Codex.ai is the AI layer; this app is a context store,
scheduler, and progress mirror. Multi-user, JWT cookie auth (see
`docs/superpowers/specs/2026-07-01-terrain-multi-user-auth-design.md`).

Design specs live in `docs/superpowers/specs/`. Build history / decisions are in
`.superpowers/sdd/progress.md`.

---

## Monorepo layout (Yarn 4 workspaces, Node 24)

```
packages/sr-engine   Pure SM-2 engine + escalation predicate (zero deps, vitest)
packages/types       Shared TS types + the `learning-os` Zod contract (vitest)
apps/api             NestJS 11 + Prisma 7 (Postgres). Topics, Reviews, Metrics,
                     Streak/cron, Sessions/export, Import, Settings, TopicTypes
apps/web             React 19 + Vite 8 + TanStack Router + react-query + recharts
                     + @xyflow/react. SPA client of the API (no SSR).
```

The monorepo is **CommonJS** for `apps/api` + `packages/*` (no `"type":"module"`,
extensionless imports) to avoid Nest↔package interop friction. `apps/web` is ESM.

---

## Commands

All from the repo root unless noted. `tsc` resolves per-workspace (each lists
`typescript`), so no `PATH=` prefix is needed.

```bash
yarn install                 # install
yarn build                   # build every workspace (topological)
yarn test                    # run every workspace's tests
yarn lint                    # oxlint (whole tree)
yarn lint:fix                # oxlint --fix
yarn format                  # oxfmt --write .
yarn format:check            # oxfmt --check .

# API (apps/api)
yarn workspace @terrain/api build           # nest build
yarn workspace @terrain/api test            # jest (173 tests)
yarn workspace @terrain/api start           # nest start (dev)

# Web (apps/web)
yarn workspace @terrain/web dev             # vite dev server (port 5180)
yarn workspace @terrain/web build           # tsc --noEmit + vite build

# Packages
yarn workspace @terrain/sr-engine test      # vitest (7)
yarn workspace @terrain/types test          # vitest (4)
```

### Database (Prisma 7)

Postgres runs in Docker (OrbStack) on **host port 5433** (local Postgres owns
5432). Connection string is in `apps/api/.env`.

```bash
docker compose up -d                                          # start Postgres
yarn workspace @terrain/api exec prisma migrate status        # check migrations
yarn workspace @terrain/api exec prisma migrate deploy        # apply migrations
yarn workspace @terrain/api exec prisma generate              # regen client
yarn workspace @terrain/api exec tsx prisma/seed.ts           # idempotent seed
```

**Prisma 7 specifics (don't regress these):**
- No bundled query engine — the client connects through a **driver adapter**.
  `PrismaService` and `prisma/seed.ts` build `new PrismaClient({ adapter })` with
  `@prisma/adapter-pg` over `DATABASE_URL`.
- The DB URL is **not** in `schema.prisma` (the datasource block has only
  `provider`). It lives in **`prisma.config.ts`** (for the CLI/Migrate) and is read
  from `process.env` by the adapter at runtime — hence `import 'dotenv/config'` is
  the **first** import in `apps/api/src/main.ts` and `prisma/seed.ts`.
- `@prisma/client` import path is unchanged (the `prisma-client-js` generator still
  emits to `node_modules/@prisma/client`).

---

## Tooling & conventions

- **Lint/format:** oxlint (`.oxlintrc.json`) + oxfmt (`.oxfmtrc.json`, single
  quotes + trailing commas). No eslint/prettier. `docs/**` and `*.md` are not
  formatted.
- **TypeScript 6** everywhere. `moduleResolution: node10` is kept via
  `ignoreDeprecations: "6.0"` (migrate to `node16` before TS 7). `apps/api`
  needs explicit `types: ["node","jest"]` (TS 6 no longer auto-includes them).
- **recharts** needs an explicit `react-is` dep in `apps/web` — the prod Rolldown
  bundler won't resolve recharts' transitive `react-is` (dev esbuild does, so a
  passing `vite build` is the real check, not just `yarn dev`).
- **No git commits** by default during this build — work stays uncommitted in the
  working tree unless you're explicitly asked to commit. Confirm before committing.

---

## Running & verifying the app

See `docs/ops/local-dev.md` for the full stack-up + UI smoke runbook. Quick path:

```bash
docker compose up -d
yarn build
yarn workspace @terrain/api start &              # API on :3000
yarn workspace @terrain/web dev &                # web on :5180 (proxies /api → :3000)
```

**Stopping the dev API:** `pkill -f "nest start"` does **not** work — `nest start`
spawns the real server as a child `node .../dist/src/main`. Kill it with
`kill -9 $(lsof -ti:3000)`. A leftover zombie holds :3000 and a fresh `start`
fails silently (EADDRINUSE), serving stale code.

**UI smoke:** no Chrome/Playwright here, but Brave is. Drive it headless via CDP
(`scripts/smoke.mjs`). One-shot `--screenshot`/`--dump-dom` hang; use
`--remote-debugging-port` + a CDP WebSocket. Use `.textContent` (not `.innerText`)
in headless — `innerText` needs paint and returns partial results.

---

## Safety (this repo runs with `--dangerously-skip-permissions`-readiness)

- `.Codex/settings.json` holds the shared policy: a PreToolUse hook
  (`.Codex/hooks/block-dangerous-git.sh`) + **deny rules** for destructive ops
  (force-push, `reset --hard`, `docker compose down -v` → wipes the `terrain_pg`
  volume, `prisma migrate reset`). Deny rules are enforced even under bypass mode.
- `.Codex/settings.local.json` is personal/gitignored.
- Commit a baseline before any bypass session — the no-commit habit means no
  recovery otherwise.
- For true isolation when running `--dangerously-skip-permissions`, use the
  hardened devcontainer — see `docs/ops/devcontainer.md`.

---

## Status & roadmap

Built & verified: Phase 1a/1b (SR core, streak, export), Phase 2 backend import,
Phase 1d web (5 screens), the 2026-06-30 modernization (latest deps + oxc
tooling + Phase-2 web visibility features), Phase 3 living-roadmap
(curation, prerequisites, drag-reparent), multi-user JWT auth (SP1),
production deploy hardening — helmet/CORS/rate-limiting/Docker/Caddy (SP2,
see `docs/ops/security-review-2026-07-01.md` + `docs/ops/deploy.md`),
Telegram digest + streak nudge (Stage 2 reminders, cut-scope per 2026-07-02 deep review),
FSRS scheduling core + prompt graduation/suspension, DSA curriculum (100 topics / 308 cards),
Next Up + Roadmap drill-down, import v2 alignment, the AI session loop
(repeat/learn exports + studiedTopics activation), the daily-loop UX redesign
(TodayCard + auto-preview import), and session-driven learning (conduct forces
teach-back + do-and-capture; `applicationEvents` import array flips the mastery
application gate from a session; Topic summary is session-authored read-only with
a demoted manual override).
**Deferred:** MFA/password reset, JWT revocation.

## Imported Claude Cowork project instructions
