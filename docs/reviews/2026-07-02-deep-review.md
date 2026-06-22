# Terrain — Deep Comprehensive Review

- **Date:** 2026-07-02
- **Scope:** whole repo — product flow/idea, scheduling model, apps/api, apps/web, packages, specs
- **Method:** four independent deep-review passes (API, web, SR core, product/spec coherence) + first-hand verification of load-bearing claims (timezone bug probed against live DB; test suite run — 116 pass; DSA import grepped — 0 prompts)

---

## 1. Verdict

The **engineering is consistently better than the product coherence**. Layering discipline is excellent (pure decision logic in dependency-free functions, thin Nest services around them), multi-user isolation was traced query-by-query with **no cross-tenant hole found**, and the import machinery (preview/apply split, atomic in-tx claim, Zod contract) is genuinely well-built.

But the system has optimized the *middle* of a learning loop whose **beginning doesn't exist** (nothing ever initiates a review — reminders deferred four times) and whose **end was never wired in** (nothing makes the user actually solve problems — the only path to DSA mastery). Meanwhile the scheduling core carries **two SM-2 clocks where only one drives anything**, and the copy-paste transport to Claude.ai is defended as philosophy when it has become the loop's largest friction source.

Three structural decisions need to be made before more features stack on top:

1. **Pick one scheduled unit** (recommendation: the prompt/practice-item, with Topic.nextReviewAt derived) and swap SM-2 → FSRS while pre-launch.
2. **Wire in the ends of the loop**: a review-session mode + reminders (beginning), problem attempts as first-class tracked entities (end).
3. **Replace the copy-paste transport with an MCP server** — the learning-os Zod schema is already ~90% of a tool input schema.

---

## 2. Product & flow findings

### 2.1 The loop never self-initiates (the app's own theory of failure)

The founding spec's premise: "motivation collapses around week 3; Telegram initiates." That component has been deferred through four planning cycles (founding Phase 1 → CLAUDE.md deferred 1c → learning-science Stage 2 → skipped again for write-from-scratch/graduation). A streak without reminders is a churn engine: you discover the break after the fact — the most demotivating event the system can produce. There is also no mobile surface at all (the founding non-goal "no mobile app" assumed Telegram would exist).

### 2.2 The system measures recall of descriptions, not problem-solving

- All ~225 curated LeetCode problems live as **inert prose inside `Topic.description`**. No entity, no state, no schedule, no history. The system cannot know whether Two Sum was ever solved, let alone cold.
- The DSA import (`apps/api/scripts-tmp/dsa-import.md`, 100 topics) contains **zero `proposedPrompts`** — every sub-pattern falls back to the gate-less 0–5 self-rating that the Stage-1 spec called "the single highest-leverage gap."
- Mastery is gameable: interval ≥ 30 + any one ApplicationEvent + any note. You can reach "mastered" on Interval DP without writing a line of interval DP.
- `nextSession.coldChallenge` is stored as an untracked string; nothing checks it was attempted. `nextFocusTitle` is stored on import and fed into the next export, but **no web screen ever displays it**.

### 2.3 Session ceremony: 10–12 manual steps

Export → copy → Claude.ai → paste → session → ensure well-formed block → copy → Import → paste → preview → resolve → confirm. Sustainable at 2–4 sessions/week for a motivated owner; not daily, and it decays exactly when motivation dips. All-or-nothing import with exact-title matching means one drifted title at 11pm holds the whole session's data hostage.

### 2.4 Curriculum drift

- The DSA spec mandates replacing the 16 flat seed topics with the 100-node curriculum; `prisma/seed.ts` still creates the flat 16, and the curriculum lives only in `scripts-tmp/` (a scratch dir). After the last DB reset the curriculum was **not re-imported** — the centerpiece content is an artifact outside the system.
- Two roadmaps dated 2026-07-01 contradict each other (learning-science roadmap says reminders next; the graduation/write-from-scratch specs declare FSRS next). Never reconciled.
- Founding non-goals (single-user, no deploy) were reversed within 24h by SP1/SP2 — productization plumbing shipped while the learning loop's initiator stayed unbuilt.

### 2.5 Concept accretion in the scheduling core

- `Review` means three incomparable things: gate-less self-rating, retrieval-gated rating, Claude-session import (which **never** passes a promptId, so the designed primary mode bypasses prompt SR state entirely).
- Topic "mastery" (manual, 3 conditions) vs prompt "graduation" (automatic, sticky) are two unrelated notions of "finished."
- Dead concepts: `DailyLog.eveningNote`/`sessionQuality` (no write path), `shouldEscalate` (exported, never called), `SessionExport.domains` (always `[]`).

---

## 3. Scheduling model findings

### 3.1 CRITICAL — Two SM-2 clocks, one drives nothing

`Prompt` carries full SM-2 state written on every review, but **nothing ever reads it for scheduling**. `PromptsService.next()` (`apps/api/src/prompts/prompts.service.ts:13-17`) uses `nextReviewAt` only as a rotation sort key — no dueness filter, no global due-prompts queue. Every consumer of dueness (dashboard, streak, exports) keys off `Topic.nextReviewAt`.

Failure: topic has prompts A (hard) and B (easy). Fail A → A lapses to interval 1 (correct per-fact behavior) — but A is unseeable until the *topic* resurfaces weeks later. Prompt-level lapse handling is structurally defeated. The retrieval-prompts spec claims "per-fact scheduling (how Anki works)" was adopted; it wasn't.

### 3.2 CRITICAL — One rating writes two SM-2 states (double-counting)

`sr-apply.ts:26,36` feeds the same quality into `sm2()` twice. Fail one hard prompt → the whole topic (including well-known facts) resets to interval 1; pass one easy prompt → the whole topic balloons. With N prompts the topic gets N× the review count. `Topic.easeFactor/interval` has no coherent semantics.

**Fix for both:** one scheduled unit. Recommended: Prompt is the card; `Topic.nextReviewAt` = derived min over ungraduated prompts (materialized in the same tx; prompt-less topics keep own state).

### 3.3 IMPORTANT — EF never penalized on lapse

`packages/sr-engine/src/index.ts:20-22` returns early on q<3 without applying the EF formula (canonical SM-2 applies it on every grade: q=1 → −0.54). Consequence: all items sit at EF ≈ 2.5 forever; chronically-failed items regrow intervals at full speed, guaranteeing repeated lapses. Test-pinned (`sm2.test.ts:14`), i.e. deliberate — but it discards the algorithm's only difficulty-adaptation signal. Moot if FSRS lands.

### 3.4 IMPORTANT — Graduation is unsound and gameable

- Permanent retirement after 3 consecutive q≥4 (~3 weeks of retention demonstrated, not mastery). Canonical SRS never retires cards. Worse: graduating all prompts returns the topic to gate-less self-rating — the system un-installs Stage 1's fix as a reward for it working. Stacks with `status='mastered'` exiting `dueTopics()` → zero reviews forever.
- No dueness/spacing requirement on the streak: three q≥4 logged in one sitting graduates permanently — massed practice is the fastest graduation path (`logReview` has no dueness check; 4 same-day q=5 reviews take a fresh topic to interval ~37 days).

**Fix:** replace with stability/interval-threshold *suspension* (e.g. ≥60d → deprioritized, never hard-retired), gated on schedule state not streak.

### 3.5 Algorithm recommendation — migrate to FSRS now

- Benchmarks on ~700M Anki reviews: FSRS needs **20–30% fewer reviews for the same retention**; ±5.3% scheduling accuracy at 90% retention target vs SM-2's ±16.2%; Anki default since v23.10.
- The `Review` log (topicId, promptId?, reviewedAt, quality) is exactly what FSRS fitting needs. Map 0–2→Again, 3→Hard, 4→Good, 5→Easy. Default weights until ~1k reviews, then fit. Exclude `claude_session` bulk imports from fitting (not timed recall).
- Schema: replace `easeFactor/interval/repetitions` with `stability/difficulty` (+ keep `nextReviewAt`) — edit the consolidated init migration, pre-launch freedom.
- Consider moving the UI to FSRS's 4 grades at the same time (0–5 self-rating is noisier than it looks).
- Use `ts-fsrs`, or ~150 LOC hand-rolled to keep sr-engine zero-deps.
- **Sequencing: collapse to one scheduled unit first (~1.5d), then swap the engine (~1d), then replace graduation (~0.5d).**

Sources: [expertium benchmark](https://expertium.github.io/Benchmark.html), [FSRS-5 vs SM-2](https://www.diane.app/en/guides/fsrs-vs-sm2), [algorithm comparison 2026](https://smartrecallai.com/blog/sm2-vs-fsrs-vs-leitner-vs-anki-2026).

---

## 4. Verified bugs — API (apps/api)

Severity-ranked; all verified by reading code unless marked PLAUSIBLE.

1. **CRITICAL — Timezone corruption in DailyLog (verified against live DB).** `streak.service.ts:51-55` computes local midnight; on UTC+3, local midnight of Jul 2 serializes as `2026-07-01T21:00Z` and the `@db.Date` column stores **2026-07-01**. Every DailyLog row is labeled one day early; heatmap (`localDateKey`) disagrees with DailyLog by a day; dev (local TZ) vs prod Docker (UTC) map the same day to different keys → double-evaluate or skip. Fix: UTC `YYYY-MM-DD` day keys everywhere + explicit `Settings.timezone`.
2. **CRITICAL — Import can write parent/prereq cycles.** `import.service.ts` `checkLink` only checks self/missing/ambiguous; two batch topics referencing each other pass and get written. `TopicsService.assertNoParentCycle/assertNoPrereqCycle` are bypassed. Cycled nodes then **silently vanish from every export ROADMAP** (root detection `!t.parentId || !ids.has(t.parentId)`). Fix: batch-aware cycle detection in `buildPlan` over existing ∪ proposed edges.
3. **IMPORTANT — No cron catch-up; `lastEvaluatedDate` dead; cron aborts all users on first error.** `streak.cron.ts:14-20` evaluates exactly yesterday; server down at 00:05 → day never classified, streak silently survives. No try/catch per user. Fix: walk-forward from `lastEvaluatedDate`, per-user error isolation.
4. **IMPORTANT — State-changing GET.** `GET /sessions/export` creates a row per hit; SameSite=Lax sends cookies on cross-site top-level GET → the one CSRF-reachable mutation; refresh spam pollutes RECENT SESSIONS. Fix: `POST /sessions/exports` + app-side UUID (kills the create-then-update dance).
5. **IMPORTANT — Registration not transactional; `updateProfile` 500s if Settings row missing** (`auth.service.ts:39-49,70-77` — P2025 on `settings.update`). Fix: `$transaction` + `settings.upsert`.
6. **IMPORTANT — Index set covers no hot query.** `dueTopics` (userId,status,nextReviewAt), `Review(userId,reviewedAt)`, `Review(topicId,reviewedAt)` (topicId has NO index — Postgres doesn't auto-index FKs), `Topic(parentId)`, `Prerequisite(prerequisiteId)`, `SessionExport(userId,generatedAt)`. Fix in regenerated init migration.
7. **IMPORTANT — Import apply: sequential per-row awaits in a 5s-default interactive tx** — the real ~95-topic DSA import will time out against a remote Postgres. Fix: explicit timeout + `createMany` batching.
8. **IMPORTANT — Test blind spots exactly where the CRITICALs live.** Streak DB paths, import apply vs real tx, cookie flags: untested. `test/app.e2e-spec.ts` is broken (expects 200 from guarded `GET /`). Mock-echo tests (settings/topic-types controllers, topics update trio) prove nothing about behavior. Fix: one real-Postgres integration tier.
9. **IMPORTANT — DTO gaps:** no MaxLength anywhere (megabyte titles embed into every export); `nextReviewAt` accepts garbage strings → 500; `durationMin` accepts negatives; password no max (argon2 DoS-ish); `parentId: ''` skips cycle guard → raw FK 500; `POST /sessions/import` has no DTO (TypeError text leaks into 400).
10. **MINOR (selection):** logReview read-modify-write race (double-click → lying intervalBefore/After); import TOCTOU on `existing` snapshot → duplicate titles poison future imports as "ambiguous"; evaluateDay/skipToday P2002 race → 500 not 409; two APP_GUARDs in different modules (throttle-vs-auth order implicit, PLAUSIBLE); logout requires valid JWT (can't clear expired cookie); `promptKind`/`mode` stringly-typed, `SessionExport.domains` dead; all User FKs RESTRICT → account deletion impossible (cascade from User; also Prompt/Prerequisite cascades would delete manual cleanup code; keep `Review.topicId` RESTRICT — it backs archive-not-delete); **`scripts-tmp/delete_dsa.ts` is an unscoped deleteMany across ALL users — delete the directory**; hello-world controller on authenticated `GET /` (repurpose as `@Public()` /health); topicType stored untrimmed on Topic while vocabulary normalizes (` Pattern ` splits grouping); Settings has no write endpoint — `telegramChatId` only settable via SQL (blocks the Telegram stage!); export N+1 (`applicationEvent.count` per topic → groupBy); no `enableShutdownHooks`; seed plants `demo@terrain.local`/`demo-password` — gate on NODE_ENV; `catch(e:any)` leaks arbitrary messages into 400 bodies; learning-os Zod not `.strict()` + FENCE takes first block (should be last) + `version: z.literal(1)` gives a generic error on v2; no `@@unique([userId, lower(title)])` though titles are identity; CLAUDE.md says "47 tests" — suite is 116.

---

## 5. Verified bugs — Web (apps/web)

1. **IMPORTANT — Import can apply text that was never previewed** (`screens/Import/index.tsx:30-40`): `onApply` sends current `text`, gate checks stale `plan`. Fix: bind `{plan, raw}`, apply `raw`, invalidate on edit.
2. **IMPORTANT — No 401 recovery**: cookie expires → every query errors into red boxes, AuthGate never flips back, only manual reload recovers. Fix: global QueryCache/MutationCache `onError`: 401 → `setQueryData(meKey, null)`.
3. **IMPORTANT — Silent mutation failures**: `TopicDetailPanel` setStatus/saveNotes have no `onError` and no global net — failed saves produce nothing and the UI keeps showing server truth. Fix: global mutation `onError` toast.
4. **IMPORTANT — Roadmap drag silently un-parents**: `onNodeDragStop` with zero intersections fires `updateTopic({parentId: null})` on any mis-drag. Fix: confirm/undo-toast.
5. **IMPORTANT — types.ts hand-mirror already drifted** (phantom `id: number` on Settings/StreakState) and duplicates unions that live in `packages/types`. Fix: consolidate into the shared package.
6. **IMPORTANT — Review modal for prompt-less topics shows only the title** — self-grading recall of a title; description/summary/noteRef all already on the row, just not rendered.
7. **MINOR (selection):** Heatmap level-1 unreachable + single-review day paints darkest green; `req()` header merge defeated by trailing `...init` spread; roadmap connect has no local echo (edge flicker); deleting selected node leaves 404-ing drawer; dead code (`useReviews` — which also orders `asc` vs detail's `desc`, `Sparkline`, `pct()`, `.skeleton` etc.); drawer has no Escape handler while Modal does; Modal has no focus trap; `useFreeze` is a hook-named click handler + one accidental click burns a freeze with no confirm; obsidianVault unsettable from UI so `obsidian://` links unreachable (+ missing settings invalidation); selection baked into node data defeats RF memoization (PLAUSIBLE at scale); `useInvalidateAll` refetches everything on every mutation (defensible single-user, split later).

**Verified stable:** the ReactFlow controlled-state pattern (post-loop-fix) is acyclic and idiomatic; snap-back on rejected mutations is correct.

### UX flow (the real problem)

No review-session mode. Ten due topics ≈ 35–40 clicks of modal churn, no progress indicator, no auto-advance, no keyboard bindings (quality not on 0–5 keys, Reveal not on Enter). The dashboard *shows* the day well (streak, due, struggle gauge with the 40–60% desirable-difficulty band) but the habit surface — the thing you touch daily — is the weakest part of the product.

---

## 6. Consolidated refactoring map (ranked)

| # | Refactor | Effort | Why |
|---|----------|--------|-----|
| 1 | **One scheduled unit + FSRS + graduation→suspension** (§3) | ~3–4d | The core. Do before anything stacks on `Topic.nextReviewAt`. |
| 2 | **Review Session mode** — "Start review (N)": full-screen card queue, ReviewGate, auto-advance, `Enter`=reveal `1-4`=grade, context in-card, end summary | M | The daily habit surface. Rewrite, don't patch the modal flow. |
| 3 | **Regenerate init migration + schema** — composite indexes, enums, cascades, `@@unique(userId, lower(title))`, drop dead columns | M | Pre-launch is the only cheap moment. Owner-preferred approach. |
| 4 | **Rewrite streak/day subsystem** — UTC day keys, walk-forward catch-up, per-user cron isolation, P2002 tolerance | M | Two verified date bugs; the motivational core must not lie. |
| 5 | **Shared graph-invariants module** — batch-aware cycle checks used by TopicsService AND ImportService | S–M | Closes CRITICAL #2, deletes duplicated linking semantics. |
| 6 | **Global error spine (web)** — 401 → login gate; unhandled mutation error → toast | S | Fixes two IMPORTANTs structurally. |
| 7 | **`POST /sessions/exports`** + app-side UUID | S | CSRF + row spam + placeholder dance, one move. |
| 8 | **Type-layer consolidation** into `packages/types` | M | Kills the drift class. |
| 9 | **Auth/settings pass** — transactional register, settings.upsert, `PATCH /settings` (unlocks telegramChatId), `@Public()` logout, guards in one module | S | Mechanical. |
| 10 | **DTO hardening sweep** + delete dead surface (`scripts-tmp/`, hello-world, broken e2e; add `/health`) | S | One sitting. |
| 11 | **Real-Postgres integration test tier** — import apply, streak, cookie flow | M–L | Mock-echo tests structurally cannot catch the CRITICAL class. |

---

## 7. Recommendations for actually mastering DSA

Grounded in the learning-science literature and existing tools ([SpacedSmart](https://www.spacedsmart.com/), [LeetCycle](https://www.leetcycle.com/), [grind CLI](https://github.com/brandon-gong/grind), [LeetRecur](https://chromewebstore.google.com/detail/leetrecur-spaced-repetiti/lmidmepgdbipmebgdalghmbehpiobiie), [Red-Green-Code on SR scheduling](https://www.redgreencode.com/leetcode-tip-10-planning-a-spaced-repetition-schedule/)):

1. **Make the problem attempt a first-class scheduled entity.** This is the single biggest gap. Promote the curated problems out of `description` prose into rows (either a `Problem` entity or a third `promptKind: 'problem'` with a leetcode URL + difficulty). An attempt records outcome ∈ {solved-cold, solved-with-hints, failed} + duration; outcome maps to the FSRS grade. The whole ecosystem of LeetCode-SRS tools exists because *scheduling re-solves of problems* is what builds pattern recognition — Terrain already owns every ingredient (curated lists, ApplicationEvent, recall gate, coldChallenge) as five disconnected features.
2. **Author prompts for the DSA curriculum.** The 100-topic graph has zero. Per sub-pattern: 2–3 concept prompts (recognition cues: "you see 'longest substring with at most K...' — which pattern and why?"), 1 code prompt (write the skeleton from scratch), 2–3 problem rows. Recognition-cue prompts are the interleaving-compatible unit — discriminating *which* pattern applies is the actual interview skill.
3. **Time-budgeted due queue.** An honest review of "Interval DP" is 30–45 min, not seconds. With ~80 patterns on flashcard-calibrated intervals the due queue will blow past any real day. Add per-item `estimatedMinutes` (concept 2', code 10', problem 30') and let the session mode cut the queue to a daily budget (e.g. 45'), most-at-risk first (FSRS retrievability makes "most at risk" computable). Without this, either ratings become dishonest or days get missed.
4. **Interleave the queue** (already spec'd Stage 3): once the unit is the prompt/problem, round-robin across categories so consecutive items differ — the research benefit is discrimination between confusable patterns (Union-Find vs DFS-components), which is exactly the DSA failure mode.
5. **Build the reminder now, but cut scope**: a daily Telegram digest ("7 due · 3 code · ~40 min · streak 12") with a deep link is 90% of the value of the full bot conversation flows spec'd in the founding doc. Unblocks on `PATCH /settings` (currently `telegramChatId` is unreachable).
6. **Replace copy-paste with an MCP server.** Claude.ai supports remote MCP. Tools: `get_context`, `get_due`, `log_review`, `propose_topics`, `add_prompts` — the export generator becomes `get_context`, the Zod contract becomes tool schemas, preview/apply becomes the approval flow. All ~10 manual steps disappear while *keeping* human-in-the-loop. The backend is unusually well-positioned; only the transport is wrong.
7. **Keep the streak, fix its truthfulness** (timezone + catch-up), and surface `nextFocusTitle` in the app — the loop's connective tissue is currently invisible.
8. **Defer:** multi-user polish, more export sections, web3 content (the DSA loop is the template; clone it once it works end-to-end).

## 8. Suggested sequencing

1. **Wave 1 — core correctness (~1 week):** refactors #1 (unit + FSRS) + #3 (schema regen) + #4 (streak rewrite) + #5 (cycle guard) + #10 (hardening/dead-code). Result: the scheduler tells the truth.
2. **Wave 2 — the loop (~1 week):** #2 session mode (+ time budget) + problem attempts as entities + author DSA prompts via one Claude session per category (the import machinery already supports bulk `proposedPrompts`) + Telegram digest.
3. **Wave 3 — transport:** MCP server; retire the copy-paste ceremony (keep export as fallback).

*Full agent transcripts available in session task outputs; this document is the consolidated, deduplicated record.*
