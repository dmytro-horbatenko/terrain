# Terrain — Modernization + Fully-Working Web — Design Spec

- **Date:** 2026-06-30
- **Status:** Design approved — ready for implementation planning
- **Owner:** Dima (single user)
- **Predecessor specs:** `2026-06-30-terrain-design.md`, `2026-06-30-terrain-import-design.md`

> Modernize the Terrain monorepo onto current tooling and dependencies, and
> finish the **web app** so it is fully working (Phase-2 visibility features).
> Telegram bot (1c) and Phase-3 living-roadmap remain out of scope.

---

## 0. Goals & non-goals

**Goals**
1. Replace the per-package eslint/prettier setup with a single root **oxlint + oxfmt** toolchain and format the whole tree.
2. Bring all dependencies to current latest, in verified waves.
3. Migrate the web app's routing to **TanStack Router** (in place, client-side SPA — no SSR).
4. Build the missing Phase-2 **web visibility features** so the web app is fully working.

**Non-goals**
- No TanStack **Start** / SSR / server functions — the web app stays a pure client of the NestJS API.
- No Telegram bot (1c). No Phase-3 (AI-node approve/reject, drag-reparent, multi-domain).
- No git commits — work stays uncommitted in the working tree (standing preference).

**Ordering decision:** Web work (Waves 1–2 + features) ships **before** backend upgrades (Wave 3). Backend majors carry the most regression risk and the least payoff toward "fully working web", so they must not block the web.

---

## 1. Tooling — oxlint + oxfmt at the monorepo root

- Add root devDeps: `oxlint@^1.71`, `oxfmt@^0.56`.
- One root `.oxlintrc.json` covering all workspaces. Remove `apps/api`'s eslint stack
  (`eslint`, `@typescript-eslint/*`, `eslint-config-prettier`, `eslint-plugin-prettier`,
  `prettier`) and per-package prettier configs (`.prettierrc`, `.eslintrc.js`) so there is
  one source of truth.
- Root scripts: `lint` → `oxlint`; `format` → `oxfmt --write .`; `format:check` → `oxfmt --check .`.
- Replace `apps/api`'s `format`/`lint` scripts to delegate to root tooling.
- Run a **tree-wide `oxfmt --write`** as an isolated step (its own diff) so the
  formatting churn does not mix with logic changes. This resolves the known
  codebase-wide double-quote vs `.prettierrc` inconsistency.

**Acceptance:** `oxlint` runs clean (or with only intentional, documented warnings);
`oxfmt --check .` passes; no eslint/prettier deps remain.

---

## 2. Dependency modernization — verified waves

Each wave is independently revertable. Stop and report if a major bump cascades.
Target versions are "latest at implementation time"; the numbers below are the
versions current as of 2026-06-30.

### Wave 1 — Frontend deps (web priority)
- `react` / `react-dom` 18 → **19.2**, `@types/react*` → 19.
- `vite` 5 → **8.1**, `@vitejs/plugin-react` → latest.
- `typescript` → **6.0** (web workspace).
- `@tanstack/react-query` → latest v5.
- `reactflow` → **`@xyflow/react`** (the renamed successor) latest. Update imports/CSS.
- `recharts` → latest, `dagre` + `@types/dagre` current.
- **Verify:** `tsc --noEmit` + `vite build` + dev-server smoke via headless Brave/CDP
  (per project ops notes — production build passing does NOT prove dev works; both
  bundlers must be checked). Confirm the `@terrain/sr-engine` CJS↔ESM interop
  (`optimizeDeps.include` / `commonjsOptions.include`) still holds.

### Wave 2 — TanStack Router migration
- Add `@tanstack/react-router` (+ devtools optional).
- Convert `app/router.tsx` + `app/Layout.tsx` to a TanStack route tree.
  **Code-based routes** (not file-based codegen) — 5 screens don't need the generator.
- Root route renders `Layout` (nav shell) with an `<Outlet/>`; one route per screen
  (`/`, `/topics`, `/roadmap`, `/export`, `/import`) plus any param routes the
  detail drawer uses.
- Remove `react-router-dom`. Port the 5 screens (plain React + react-query — minimal change).
- **Verify:** every screen renders and navigates; deep-linkable routes work.

### Wave 3 — Backend deps (AFTER web is working)
- `prisma` / `@prisma/client` 5 → **7.8**: regenerate client, `prisma validate`,
  `prisma migrate status` must stay in sync (Prisma 7 has known friction — handle
  carefully; pin the binary, do not `dlx`).
- `@nestjs/*` 10 → **11.1**; `@nestjs/schedule` → a Nest-11-compatible line.
- `class-validator` / `class-transformer`, `jest` / `ts-jest`, `@types/*` current.
- **Verify:** `docker compose up` Postgres, full API unit suite green, `nest build` 0,
  live boot smoke (`/streak`, `/sessions/export`, import preview/apply). Kill dev
  server via `kill -9 $(lsof -ti:3000)` (not `pkill -f "nest start"`).

### Wave 4 — Shared packages
- `vitest` 2 → **4**, TS 6 across `packages/sr-engine` + `packages/types`.
- **Verify:** both unit suites green; packages build to `dist`.

---

## 3. Fully-working web — Phase-2 visibility features

Backend already exposes `GET /metrics/dashboard`, topic detail (relations + reviews +
mastery + labels), `GET /topic-types`. Most of this is frontend; small API additions
are called out.

1. **Interval-growth chart** — per topic, plot `Review.intervalAfter` over `reviewedAt`
   (recharts line). Lives in the topic detail drawer. Reads historical facts, not recomputed.
2. **Activity heatmap** — calendar heatmap of reviews-per-day (GitHub-style) on the
   Dashboard. Source: reviews grouped by day (add `GET /metrics/heatmap?days=N` if a
   suitable aggregate endpoint is missing).
3. **Struggle-ratio trend** — MetricsService already computes the 7d ratio; surface it
   as a small trend/gauge on the Dashboard with the 40–60% target band marked.
4. **Mastery checklist UI** — per active topic, show retention (interval ≥ 30) /
   application (≥1 ApplicationEvent) / teaching (noteRef or summary) as ✓/✗, with a
   **Confirm mastery** action (`PATCH /topics/:id` status→mastered) enabled only when
   all three hold. Backend already derives `masteryStatus`.
5. **ApplicationEvent UI** — list + add application events in the topic detail drawer.
   Needs `POST /topics/:id/app-events` (kind, description, url?) and the events surfaced
   in topic detail if not already returned.
6. **noteRef / Obsidian deep links** — render `noteRef` as a clickable link; when
   `Settings.obsidianVault` is set, build `obsidian://open?vault=…&file=…`. Needs
   `Settings` read exposed to the web (`GET /settings`) if absent.

These slot into existing screens (Dashboard + topic detail drawer); no new top-level screens.

**Acceptance:** all six visible and functional against a live API with seeded data,
verified via the headless-Brave/CDP smoke method.

---

## 4. Process & verification

- **No commits.** Uncommitted working tree (standing preference).
- Follow the project's SDD pattern (spec → plan → per-wave implement→verify), reusing
  `docs/superpowers/tooling/` where it helps.
- Each wave has an explicit verify gate (above). A wave is not "done" until its gate passes
  with observed evidence (build output, test counts, live smoke), not assertion.
- Memory ops facts apply: Postgres on host port **5433**; monorepo is **CommonJS** for
  api/packages; web is ESM; web dev pinned to **port 5180**; API on **3000**.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| TS 6.0 breaking changes cascade across all workspaces | Upgrade per-workspace, typecheck each; TS is the most cross-cutting bump |
| Vite 8 + `@xyflow/react` rename breaks dev-only ESM interop | Verify dev server (not just `vite build`) via CDP smoke after Wave 1 |
| Prisma 7 migration/runtime breakage | Gated to Wave 3 (after web works); `migrate status` in sync, no `dlx`, pinned binary |
| Nest 11 + `@nestjs/schedule` compat | Boot test + full suite gate Wave 3; pin schedule to a Nest-11 line |
| oxfmt churn reformats the whole tree | Isolated `oxfmt --write` step so the diff is reviewable on its own |
