# Security review — 2026-07-01

Full-app review of Terrain (`apps/api`, `apps/web`, infra/tooling) against the
[OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org), done ahead of
the planned move from "runs on my laptop" to a self-hosted Linux server.
Fixes are applied directly in this working tree (uncommitted, per this repo's
no-auto-commit convention — review with `git diff` before committing).

Context that shaped the priorities: the app already has full multi-user auth
(`docs/superpowers/specs/2026-07-01-terrain-multi-user-auth-design.md`,
Sub-project 1) but explicitly deferred all production hardening — helmet,
rate limiting, CORS allowlist, TLS, `.env.example` — to a not-yet-started
"Sub-project 2." This review **is** Sub-project 2, scoped against OWASP
guidance rather than a fresh list.

## What was already solid (no changes needed)

Worth stating explicitly, since a security review can otherwise read as
all-bad-news:

- **Authorization / IDOR** — every service method scopes its Prisma queries
  by `userId` (`findFirst({ where: { id, userId } })`), consistently, across
  topics, reviews, sessions, settings, streak, topic-types. No endpoint lets
  one user read or mutate another's data. Prerequisite/parent-link mutations
  also re-check ownership on both sides of the edge.
- **SQL injection** — 100% Prisma query-builder, no `$queryRaw`/`$executeRaw`
  anywhere. Not exploitable via the ORM layer.
- **Password storage** — argon2 (`argon2.hash`/`argon2.verify`), matching the
  OWASP Password Storage Cheat Sheet's top recommendation.
- **XSS** — no `dangerouslySetInnerHTML`, no `innerHTML`/`eval` anywhere in
  `apps/web`. React's default escaping is intact. The one user-supplied URL
  that's rendered as a clickable link (`AppEventsPanel`) is allow-listed to
  `http(s)://` only (`isUrl()`) and opened with `rel="noreferrer"` — blocks
  both `javascript:` URL injection and reverse-tabnabbing.
- **Auth cookie** — JWT in an `httpOnly`, `SameSite=Lax` cookie
  (`Secure` gated on `NODE_ENV=production`), not `localStorage` — not
  readable by JS even if an XSS bug ever appeared.
- **Secrets hygiene** — `.env` was already gitignored and never committed
  (checked `git log --all -- apps/api/.env`: no history).
- **Mass assignment** — DTOs never carry `userId`; every write does
  `{ ...dto, userId }` with the server-derived id last, so a client can't
  reassign ownership of a row through a crafted body.

## Fixed

### 1. No rate limiting on any endpoint — brute force / signup abuse

**Risk:** unlimited login/register attempts (credential stuffing, password
guessing) and unlimited request volume generally (basic DoS). OWASP
Authentication + Credential Stuffing Prevention Cheat Sheets both call out
login throttling as a baseline control.

**Fix:** `@nestjs/throttler` added, applied two ways
(`apps/api/src/app.module.ts`, `apps/api/src/auth/auth.controller.ts`):
a global default of 100 req/min/IP on every route, and a tighter 10 req/min/IP
on `POST /auth/register` and `POST /auth/login` specifically.

### 2. No security headers — `helmet` missing entirely

**Risk:** missing `X-Content-Type-Options`, `X-Frame-Options`,
`Strict-Transport-Security`, etc. OWASP Secure Headers Cheat Sheet.

**Fix:** `app.use(helmet())` in `apps/api/src/main.ts`. Also mirrored on the
static/web side via Caddy response headers (`apps/web/Caddyfile`), since
those cover the SPA's own document response, not just API JSON responses.

### 3. CORS wide open (`app.enableCors()` with no options)

**Risk:** reflects any `Origin`. Low *current* exploitability because
`credentials` wasn't set true anywhere, but it's the wrong default to carry
into a production deploy, and the multi-user-auth design doc itself flagged
this as "handed off" — never actually closed.

**Fix:** origin allowlist from `CORS_ORIGIN` (comma-separated env var),
`credentials: true` set explicitly and paired with the allowlist rather than
a wildcard (`apps/api/src/main.ts`). Defaults to the local Vite dev origin so
local dev is unaffected.

### 4. `JWT_SECRET` — weak default, no startup validation

**Risk:** the dev `.env` shipped `JWT_SECRET=dev-only-change-in-prod` (24
chars, guessable) with nothing stopping that same value — or a missing
var entirely — from reaching production. A weak/guessed signing secret lets
an attacker forge a valid session cookie for *any* user id. OWASP Secrets
Management + JWT Cheat Sheets.

**Fix:** `assertJwtSecret()` in `apps/api/src/main.ts` — the app now refuses
to boot if `JWT_SECRET` is unset, under 32 characters, or (in production)
equal to a known placeholder value. Local `.env` was rotated to a fresh
48-byte random secret so dev keeps working under the new 32-char floor.

### 5. Local Postgres published on `0.0.0.0`, not loopback

**Risk:** `docker-compose.yml` mapped `5433:5432` — Docker's default bind
(no host IP given) is *all* interfaces, so anyone else on the same LAN/wifi
could reach your local dev Postgres using the hardcoded `terrain`/`terrain`
credentials. Easy to miss since `localhost:5433` still looks local from the
host machine.

**Fix:** changed to `127.0.0.1:5433:5432`.

### 6. `ValidationPipe` silently dropped unrecognized fields

**Risk:** `forbidNonWhitelisted: false` meant extra/unexpected body fields
were stripped without error instead of rejected — not itself exploitable
here (mass-assignment is separately blocked, see above), but it hides
client bugs and malformed/probing requests that are worth surfacing as 400s.
OWASP Input Validation Cheat Sheet favors explicit rejection.

**Fix:** flipped to `forbidNonWhitelisted: true`
(`apps/api/src/main.ts`). Checked every `.spec.ts`/e2e test first — none
relied on the old silent-strip behavior.

### 7. No production Docker/deploy story at all

**Risk:** not a "vulnerability" in the running app, but the single biggest
risk to the *planned* server deployment — without this, the natural path is
"docker compose up the dev file on the public server," which would expose
Postgres directly to the internet with default credentials and serve
everything over plain HTTP.

**Fix:** added a full production path — see "Infra added" below.

## Infra added

- **`apps/api/Dockerfile`** — multi-stage build (installs + builds from repo
  root so the workspace-linked `@terrain/sr-engine`/`@terrain/types`
  packages resolve, then prunes to production-only deps via
  `yarn workspaces focus --production`), runs as the image's built-in
  unprivileged `node` user, not root.
- **`apps/web/Dockerfile`** + **`apps/web/Caddyfile`** — builds the SPA, then
  serves it through Caddy, which also reverse-proxies `/api/*` to the API
  container and gets **automatic HTTPS** (Let's Encrypt) for free once
  `DOMAIN` is a real domain. No manual certbot/nginx config to maintain.
- **`docker-compose.prod.yml`** — `db` and `api` publish **no host ports at
  all** (internal Docker network only); only `web` (Caddy, 80/443) is
  reachable from outside. `web`'s Linux capabilities are dropped to just
  `NET_BIND_SERVICE` (needed to bind :80/:443) rather than running fully
  unrestricted.
- **`apps/api/.env.example`**, **`.env.production.example`** — every
  required env var documented with generation commands, no real secrets.
- **`.dockerignore`** — now excludes `.env*` (except `*.example`) so a local
  secret can never end up baked into an image layer via `COPY . .`, even
  transiently in a build-stage layer.
- **`.gitignore`** — added `.env.production` / `.env.*.local` (only bare
  `.env` was covered before; a real `.env.production` created for the deploy
  would *not* have been ignored).
- **`docs/ops/deploy.md`** — the runbook: DNS-before-TLS ordering, firewall
  (only 22/80/443 open — DB and API were never exposed to begin with so
  there's nothing else to firewall), SSH hardening, `migrate deploy` (never
  `migrate reset`), backup command, update procedure.

## Proposed, not fixed (judgment calls / bigger scope)

- **No JWT revocation.** The 30-day cookie is stateless — "logout" clears the
  browser's cookie but a copied/stolen token stays valid until it expires.
  Fixing this properly means a server-side session/allowlist store (or
  short-lived access + refresh tokens), which is a real architecture change,
  not a patch. Current mitigations (`httpOnly`, `Secure` in prod, `SameSite=Lax`,
  no XSS sinks found) meaningfully reduce *how* a token could leak in the
  first place. Worth revisiting if this ever goes multi-device/shared-computer.
- **No MFA / no password reset flow.** Both explicitly deferred in the
  multi-user-auth design doc (no outbound email server yet). Still true.
  MFA is, per OWASP, the single most effective control against credential
  attacks — worth prioritizing once email delivery exists for reset flows
  anyway (same infra need).
- **Register leaks email existence** (409 on duplicate email). Minor,
  industry-standard trade-off for usable signup UX; OWASP treats this as
  acceptable when the app doesn't need to hide its user list. Flagging for
  awareness, not fixing.
- **No Content-Security-Policy on the web response.** `helmet()`'s default
  CSP covers the API's own JSON responses (low-value there — it's not
  serving HTML), but the Caddy-served SPA doesn't have one yet. Deferred
  because a correct CSP needs enumerating the Vite build's actual
  script/style/connect sources, and a wrong one silently breaks the app —
  wanted a follow-up pass with the app actually running against it, not a
  guess baked into this review.
- **No dependency-vulnerability scanning.** `yarn npm audit` / Dependabot /
  Renovate aren't wired up — natural next step once this repo has a real git
  remote (it's local-only today per `CLAUDE.md`).
- **No automated backups.** `docs/ops/deploy.md` gives the manual `pg_dump`
  command; scheduling it (cron + off-box copy) is left as a deploy-day task
  since it depends on where you want backups to land.
- **`CLAUDE.md` is stale** — still says "Single user, no auth," but the repo
  already has full multi-user JWT auth (Sub-project 1 shipped). Not a
  security issue, but worth a doc fix so future sessions (agent or human)
  don't reason from outdated assumptions.

## Verification

- `tsc --noEmit` passed cleanly for both `apps/api` (via
  `tsconfig.build.json`) and `apps/web` after all changes — confirms the new
  `helmet`/`@nestjs/throttler` usage type-checks and nothing else regressed.
- Could **not** get `yarn lint` (oxlint), `yarn workspace @terrain/web test`
  (vitest/rolldown), or `yarn workspace @terrain/api test` (jest) to run
  inside this session's sandbox — native-binary/platform mismatches
  (oxlint/rolldown ship prebuilt binaries per-OS/arch) and an unrelated
  `ts-jest` module-resolution error that reproduces even on files this
  review never touched. These look like sandbox-specific issues, not
  something introduced here, but they weren't independently confirmed.
  **Please run `yarn build && yarn test && yarn lint` locally before
  trusting this is green.**
- The new Docker/Compose files are unbuilt/untested — no Docker daemon in
  this sandbox. Review them, then do a first `docker compose -f
  docker-compose.prod.yml build` locally before the real deploy.
- Rotating `JWT_SECRET` (done in `apps/api/.env` for dev) invalidates every
  existing session — expected, just noting it so it's not mistaken for a bug
  next time login stops working after a pull.

## Files touched

```
 .dockerignore                          | changed — exclude real .env* from build context
 .gitignore                             | changed — cover .env.production / .env.*.local
 apps/api/.env                          | changed — longer dev JWT secret, new documented vars
 apps/api/.env.example                  | new
 apps/api/Dockerfile                    | new
 apps/api/package.json                  | changed — +helmet, +@nestjs/throttler
 apps/api/src/app.module.ts             | changed — global ThrottlerModule/guard
 apps/api/src/auth/auth.controller.ts   | changed — per-route throttle on register/login
 apps/api/src/main.ts                   | changed — helmet, CORS allowlist, JWT_SECRET check, forbidNonWhitelisted
 apps/web/Caddyfile                     | new
 apps/web/Dockerfile                    | new
 docker-compose.yml                     | changed — bind Postgres to 127.0.0.1
 docker-compose.prod.yml                | new
 .env.production.example                | new
 docs/ops/deploy.md                     | new
 docs/ops/security-review-2026-07-01.md | new (this file)
```
