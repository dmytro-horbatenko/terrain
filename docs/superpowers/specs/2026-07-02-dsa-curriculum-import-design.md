# DSA Curriculum Content Import — Design

- **Date:** 2026-07-02
- **Status:** Design approved (brainstormed with user; scope, card template, URL
  sourcing, target account, import path, and batching decided explicitly)
- **Context:** wave-2 content work deferred by
  `2026-07-02-scheduling-core-fsrs-design.md` ("DSA prompt authoring"). Source
  material: the 100-topic NeetCode-roadmap curriculum at
  `apps/api/scripts-tmp/dsa-content.json` (topics only, problems referenced in
  prose, no cards).

## Purpose

Get the full DSA curriculum into Terrain as **real per-topic cards** through the
v2 `/sessions/import` endpoint — a content-authoring effort, not a mechanical
port. `prisma/seed.ts` stays a small demo fixture; the curriculum is import
content owned by the user's real account.

## Decisions (user-confirmed)

1. **Scope:** all 100 topics AND authored cards for all 81 pattern leaves in
   this pass (~300–350 cards). New cards don't enter the due queue, so there is
   no scheduling downside to importing everything at once.
2. **Card template per leaf** (baseline; go heavier on crucial patterns such as
   sliding window, DFS/BFS, binary search on answer, 1-D DP):
   - 1 `concept` card — recognition: "when do you reach for X, what's the
     signal, what's the classic pitfall"; `answerHint` = cues + pitfall.
   - 1 `code` card — implement the pattern's kernel; **language-neutral**
     ("in your language of choice"), `answerHint` describes loop structure /
     invariants, never syntax. Skipped where no real kernel exists.
   - 2–3 `problem` cards — one specific problem each, with `url`,
     `problemDifficulty` (from the source prose), `estimatedMinutes`
     (heuristic 15/30/45 by difficulty, nudged for known outliers).
3. **Problem selection:** prefer Blind 75 / NeetCode 150; mixed difficulty per
   leaf (easy anchor + medium core; hards only where the leaf *is* the hard).
   **Dedupe rule:** a problem becomes a card on exactly one leaf — its most
   canonical home (Two Sum → "Two Sum / complement lookup"); other leaves may
   mention it in hint prose. No problem is ever scheduled twice.
4. **URLs:** `https://leetcode.com/problems/<slug>/` derived from titles;
   premium-locked problems (Meeting Rooms, Encode and Decode Strings, Graph
   Valid Tree, Employee Free Time, …) use their free
   `https://neetcode.io/problems/<slug>` page instead. Every URL is
   liveness-checked, not trusted.
5. **Target account:** the user's real (non-demo) account, which has no seed
   data — no collisions with `demo@terrain.local`'s near-duplicate sample
   titles. The script registers/logs in via the auth API.
6. **Import path:** script-driven via the API, preview-gated. The web Import
   screen (known-broken v1-shaped preview rendering) is NOT fixed in this pass;
   it stays on the fixes-plan.
7. **Batching: per-category, topology-ordered.** 18 batches, each = category
   concept + its pattern leaves + their cards, so the starter-card rule never
   fires (every batch-created leaf is targeted by same-batch `proposedPrompts`;
   category/root nodes have same-batch children). Root topic rides in batch 01.
   Order = NeetCode order **except Graphs before Backtracking** ("Grid
   backtracking" depends on "DFS (connected components)"). Batches stay far
   under the 200-topic/500-prompt contract caps and Nest's ~100KB body limit —
   no API changes needed.

## Content layout

New repo-root directory **`content/dsa/`** — maintained curriculum content
(re-importable after any future DB reset). One file per category, numbered in
import order:

```
content/dsa/01-arrays-hashing.json
content/dsa/02-two-pointers.json
...
content/dsa/09-heap-priority-queue.json
content/dsa/10-graphs.json          # moved ahead of backtracking
content/dsa/11-backtracking.json
...
content/dsa/18-math-geometry.json
```

Each file is one v2 `learning-os` JSON object: `version: 2`,
`sessionId: null` (placeholder — the import script stamps a freshly minted
SessionExport id at import time), `proposedTopics`, `proposedPrompts`.

Topics are copied from `dsa-content.json` with one edit: the prose
`Problems: …` tail is trimmed from leaf descriptions (problems become real
cards; keeping the list would duplicate and drift). Recognition guidance stays.
`apps/api/scripts-tmp/` files remain untouched as historical source.

## Import pipeline — `scripts/import-dsa.mjs`

Node script (fetch-based, style of `scripts/smoke.mjs`) against the local API:

1. **Login** to the real account (`/auth/login`; credentials via env, never
   hardcoded); register first if absent. Keep the JWT cookie.
2. **Pre-flight across all files:** every `prerequisiteTitles`/`parentTitle`
   must resolve within the same or an earlier file — ordering bugs surface
   before touching the API.
3. Per file, in filename order:
   a. **Mint an export** via the sessions-export endpoint → `SessionExport`
      id (imports hard-require a real, unclaimed export id).
   b. Stamp the id into `sessionId`, wrap in a ```learning-os fence, POST to
      `/sessions/import/preview`.
   c. **Gate:** print plan summary (create/exists counts, cards by kind,
      unresolved). Any `unresolved` entry or count mismatch → stop before
      apply. `--dry-run` stops here for every batch.
   d. POST `/sessions/import` (apply). The one-shot export claim makes an
      accidental re-apply fail loudly (409) instead of duplicating.
4. **Re-runs are safe:** already-created topics resolve `alreadyExists` and are
   skipped; a partially-imported curriculum can be resumed by re-running.

## Validation

**Pre-import** (`scripts/validate-dsa-content.mjs`):
- Every file parses against `learningOsV2Schema` from `@terrain/types` (the
  real contract — no schema drift possible).
- Cross-file prereq/parent ordering (the pre-flight, runnable standalone).
- Every `problem` card has `url` + `problemDifficulty` + `estimatedMinutes`;
  no duplicate problem URL across the entire curriculum; every leaf has ≥1
  `concept` card; per-batch contract limits respected.
- **URL liveness:** HEAD/GET every unique URL (~200), flag non-200s — catches
  bad derived slugs, the most likely authoring error.

**Post-import** (script `verify` subcommand, via the API):
- 100 DSA topics exist; per-category topic and card counts match the files.
- **Zero `autoGenerated` cards** in the DSA subtree (starter-card rule never
  fired).
- Prerequisite edge count matches the content files; spot-check a few leaves'
  cards for full field integrity.
- Manual finish: load the roadmap graph screen (local-dev smoke runbook) and
  eyeball the full tree.

## Error handling

- Preview `ambiguous` on any title → stop: the account isn't clean or a title
  collides case-insensitively; resolve manually.
- Apply is all-or-nothing per batch (existing importer transaction); a failed
  batch leaves earlier batches intact and is re-runnable.
- Unresolved cross-batch prereqs are impossible if file order is respected;
  the pre-flight makes violations a local error, not an API 422.

## Out of scope

Import-screen v2 fix (fixes-plan); new-card introduction pacing / session
budgeting (wave-2 scheduling); Telegram digest; any API code changes (body
limit stays default); FSRS weight fitting.

## Main risk & mitigation

Card quality diluting across ~400 cards. Mitigated by: per-kind templates
(above), authoring category-by-category (each file a focused ~25-card unit),
the dedupe rule keeping the problem set tight, and the validation scripts
catching structural (if not editorial) lapses.
