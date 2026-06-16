# Terrain — Multi-User Auth & Tenancy (Sub-project 1) — Design

Date: 2026-07-01
Status: Approved for planning
Scope: Convert Terrain from a single-user, no-auth personal app into a
multi-tenant, authenticated app where each user has fully isolated learning
data. Self-hosted target (single Linux VPS).

> This is **Sub-project 1** of a two-part effort. **Sub-project 2** (production
> deploy to the VPS: Dockerfiles, prod `docker-compose`, nginx + TLS,
> `start:prod`/global-prefix/`VITE_API_URL` fixes, `migrate deploy`, CORS
> allowlist, helmet, rate-limiting, `.env.example`, deploy runbook) has its own
> spec and follows this one. A few items below are explicitly **handed off** to
> Sub-project 2 where noted.

---

## 1. Goal & context

Today Terrain is architected for one user: every service method queries data
globally (`prisma.topic.findMany({})`), identity is a hardcoded `WHO I AM`
block (`Name: Dima`), and singleton tables (`StreakState`, `Settings`) have a
fixed `id = 1` row. There is no auth and CORS is wide open.

The goal: **anyone can self-register, and each user sees and mutates only their
own topics, roadmap, reviews, streak, settings, and session exports.** No user
can read or affect another user's data. The daily learning loop (Dashboard →
Export → Claude.ai → Import) is unchanged in behavior, just scoped per user.

### Success criteria

- A logged-out visitor can register and log in; all app data routes require auth.
- Two users on the same instance have completely isolated data (enforced and
  unit-tested as a cross-user isolation invariant).
- The export's identity block reflects the logged-in user's editable profile.
- The schema is natively multi-user (single fresh init migration), and the seed
  produces a demo user with the DSA topics under it.
- All existing behavior/tests keep passing, re-scoped per user.

## 2. Non-goals (deferred, tracked but out of this spec)

- **Password reset / email verification** — needs an outbound email server we
  don't have. Deferred.
- **OAuth / social login** — no external identity providers.
- **Admin / user-management UI** — signup is open; no roles beyond "user".
- **AI-bootstrap onboarding** ("propose a roadmap for a goal") — the richer
  cold-start flow is its own later enhancement. v1 ships minimal empty states.
- **Production security hardening** (helmet, throttler incl. `/auth/register`
  rate limit, CORS allowlist, TLS) — **handed off to Sub-project 2.**
- **Per-user Telegram** (Phase 1c) — remains deferred.

## 3. Data model changes

New `User` model; add `userId` ownership to every owned table; rework the three
singleton/global-keyed tables to be per-user.

### 3.1 New `User` model

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  // profile — replaces the hardcoded WHO I AM block
  name         String
  role         String?
  learningStyle String?
  codeStyle    String?
  noteSystem   String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  // back-relations added as each owned model gains userId
}
```

### 3.2 Add `userId` to owned tables

Every owned model gets `userId String` + `user User @relation(...)` + an index
on `userId`.

- **`Topic`** — add `userId`. (No existing unique constraints on title/domain,
  so scoping is purely additive.)
- **`Review`** — add `userId` (denormalized). Rationale: metrics like
  `struggleRatio7d` query `Review` directly over a time window; a denormalized
  `userId` keeps those scans a simple `where: { userId }` instead of a join
  through `Topic`. Written at `logReview`/import time from the topic's owner.
- **`ApplicationEvent`** — add `userId` (denormalized, same rationale — mastery
  counts query it).
- **`SessionExport`** — add `userId` (the suggested-next-focus `findFirst` and
  recent-sessions `findMany` must be per-user).
- **`Prerequisite`** — no `userId`; scope is inherited through both topics. The
  service **must guard** that `topicId` and `prerequisiteId` belong to the same
  logged-in user before creating an edge.

### 3.3 Rework singleton / globally-keyed tables to per-user

- **`StreakState`** — currently `id Int @default(1)` (one global row). Change PK
  to `userId String @id` + `user User @relation`. One streak row per user.
- **`Settings`** — currently `id Int @default(1)`. Change PK to
  `userId String @id`. Keeps `obsidianVault`, `telegramChatId` (identity/profile
  lives on `User`, not here).
- **`DailyLog`** — currently `date DateTime @id @db.Date` (one global log per
  calendar date!). Change to composite PK `@@id([userId, date])` so each user
  has their own daily log per date. Add `userId`.
- **`TopicType`** — currently `key String @id` (global vocabulary). Change to
  composite PK `@@id([userId, key])` so each user has their own soft vocabulary.
  Add `userId`.

## 4. Auth

### 4.1 Mechanism

- **Email + password.** Passwords hashed with **argon2** (`argon2` package).
- **Stateless JWT** signed with `JWT_SECRET` (env), ~30-day expiry, carried in an
  **httpOnly cookie** (`Secure` in prod, `SameSite=Lax`). Web and API are
  same-origin (dev via Vite proxy, prod behind nginx), so cookies work without
  CORS-credentials complexity. `SameSite=Lax` + same-origin gives adequate CSRF
  protection for v1 (no separate CSRF token). No refresh-token machinery.
- JWT payload: `{ sub: userId, email }`.

### 4.2 New `AuthModule`

- `POST /auth/register` — `{ email, password, name }` → create user (argon2
  hash), also seed that user's singleton rows (`StreakState`, `Settings`), set
  cookie, return `{ id, email, name }`. Rejects duplicate email (409).
- `POST /auth/login` — verify argon2, set cookie, return the user.
- `POST /auth/logout` — clear the cookie.
- `GET /auth/me` — return the current user (from the JWT) or 401.
- `PATCH /auth/me` — update the profile fields (`name`, `role`, `learningStyle`,
  `codeStyle`, `noteSystem`) and `Settings` (`obsidianVault`).

### 4.3 Global guard + request scoping

- A **global `JwtAuthGuard`** (registered via `APP_GUARD`) protects every route
  by default. A **`@Public()`** decorator opts out `register`/`login`.
- The guard validates the cookie JWT and attaches `req.userId`.
- A **`@CurrentUser()`** param decorator extracts `userId` for controllers.
- **Every existing service method gains a `userId` parameter** and scopes all
  Prisma queries with `where: { userId, ... }`. Controllers pass
  `@CurrentUser()` through. This is the bulk of the work and touches: topics,
  reviews, metrics, streak, sessions (export generator), import, settings,
  topic-types.

### 4.4 Streak cron becomes multi-user

`StreakCron` (`@Cron('5 0 * * *')`) currently evaluates one global streak. It
must **iterate all users** and evaluate each user's streak for the day.

## 5. Identity → per-user profile

- `ExportGeneratorService` currently emits a hardcoded `WHO_I_AM` constant. It
  will instead build the identity block from the logged-in user's profile
  fields (`name`, `role`, `learningStyle`, `codeStyle`, `noteSystem`), falling
  back to sensible blanks when a field is empty.
- The **Settings screen gains a write side** (a Profile editor) backed by
  `PATCH /auth/me`. This also closes the "Settings is read-only" gap found in the
  readiness audit.

## 6. Web changes

- **Login / Register screen** — email + password (+ name on register). On
  success the cookie is set server-side; the app redirects into the SPA.
- **Auth gate** — a wrapper at the router root that calls `GET /auth/me`; while
  loading shows a splash, on 401 renders the login screen instead of the app.
- **`client.ts`** — send `credentials: 'include'` on every request so the cookie
  rides along; on a `401` response, drop to the login screen (invalidate auth
  query). `BASE = '/api'` stays (same-origin).
- **Profile editor** in Settings (new write UI) — edits the identity fields.
- **Empty states** — new users have no data; each screen's existing empty state
  copy is refreshed to guide first use ("add a topic, or run an Export and let
  Claude propose your roadmap"). No new onboarding wizard in v1.

## 7. Schema rewrite & seed (no incremental migration)

Current data is **disposable dev seed data** — the app has never been deployed,
nothing is committed, and there is no production data to preserve. So we do
**not** write an additive backfill migration. Instead:

- **Edit `schema.prisma` directly** to its native multi-user shape (the `User`
  model, `userId` on owned tables, and the reworked per-user PKs from §3) — as if
  the app was multi-user from the start.
- **Regenerate the migration history as a single fresh init.** Replace the
  existing three migrations with one new init migration reflecting the final
  schema. (No nullable-then-backfill steps — the schema is already correct.)
- `prisma/seed.ts` is rewritten to be idempotent: create the demo user
  (`demo@terrain.local`, a known dev password), then seed the DSA topics/types
  and singleton rows **under that user**.

**Execution note for the plan:** applying a rewritten init to the existing dev DB
requires a database reset, but `prisma migrate reset` and `docker compose down
-v` are **deny-listed** in `.claude/settings.json` (they wipe the volume). The
plan must reset the dev DB through an allowed path — e.g. the user runs the reset
themselves via `! <cmd>`, or we drop/recreate the `terrain` database (not the
volume) and `prisma migrate deploy` the fresh init onto it. Decide the exact
mechanism in the plan; do not assume `migrate reset` is available.

## 8. Testing

- **TDD, matching the repo.** Every re-scoped service keeps its existing unit
  tests, updated so mocks/asserts include `userId`.
- **New cross-user isolation invariant** (the critical new guarantee): tests that
  assert user A's queries never return / never mutate user B's rows — at minimum
  for topics (read + update + delete), reviews, streak, and session export
  suggested-focus/recent-sessions.
- **New auth tests**: register (dup-email 409), login (bad-password 401), guard
  (missing/invalid token → 401, `@Public()` bypass), profile update.
- Prereq-edge cross-user guard test (can't link to another user's topic).
- All existing gates stay green: `yarn workspace @terrain/api test`, both package
  suites, web build, lint, format.

## 9. Security notes (this spec vs. Sub-project 2)

- **In this spec:** argon2 hashing, httpOnly `SameSite=Lax` cookie, global auth
  guard, per-user query scoping, `JWT_SECRET` env var.
- **Handed to Sub-project 2:** helmet, `@nestjs/throttler` with a strict limit on
  `/auth/register` and `/auth/login` (open signup abuse), CORS origin allowlist
  (replace bare `enableCors()`), TLS/HTTPS at nginx (required for `Secure`
  cookies), `.env.example` documenting `DATABASE_URL`, `PORT`, `JWT_SECRET`.

## 10. Rough waves (for the plan)

- **Wave A — schema & auth core:** rewrite `schema.prisma` to the multi-user
  shape + regenerate a single fresh init migration + seed rewrite (demo user);
  `AuthModule` (register/login/logout/me, argon2, JWT cookie); global guard +
  `@Public()`/`@CurrentUser()`.
- **Wave B — scope every service:** thread `userId` through topics, reviews,
  metrics, streak (+ multi-user cron), sessions/export-generator (profile block),
  import, settings, topic-types; cross-user isolation tests.
- **Wave C — web:** login/register screen, auth gate, `credentials: 'include'` +
  401 handling, Settings profile editor, refreshed empty states.

## 11. Open risks

- **Cookie + Vite dev proxy:** confirm the httpOnly cookie survives the dev proxy
  (`/api` → `:3000`) round-trip; it should (same-origin from the browser's view),
  but verify in the Wave C smoke.
- **Denormalized `userId` on `Review`/`ApplicationEvent`:** must be written
  consistently in `buildReviewWrites` and the import transaction, and always
  match the topic's owner. Guard against mismatch.
- **`DailyLog` composite PK** (`@@id([userId, date])` on a `@db.Date` column) —
  verify Prisma emits it correctly in the fresh init migration and that the seed
  writes demo-user logs against it.
