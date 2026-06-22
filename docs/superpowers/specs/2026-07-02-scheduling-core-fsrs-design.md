# Scheduling Core — One Card Unit + FSRS — Design

- **Date:** 2026-07-02
- **Status:** Design approved (brainstormed with user; grade scale, problem representation, and card-less-topic behavior decided explicitly)
- **Context:** implements refactor #1 + #3 of `docs/reviews/2026-07-02-deep-review.md` (wave 1). Fixes review findings: two-clock scheduling (CRITICAL), double-counted ratings (CRITICAL), EF-not-penalized-on-lapse, gameable/permanent graduation, missing indexes, stringly-typed enums, cascade rules, title-identity fragility.

## Purpose

Terrain currently runs SM-2 on two entities at once: every `Topic` and every
`Prompt` carry independent SR state, one rating advances both, and only the
topic's state ever drives scheduling — prompt state is written but never read
as a queue, so a failed prompt is unseeable until its topic resurfaces weeks
later. Graduation permanently retires prompts after 3 consecutive good
ratings (achievable in one sitting) and returns topics to gate-less
self-rating. This spec collapses scheduling to **one unit — the card
(`Prompt`)** — and replaces SM-2 with **FSRS-6**, the current
state-of-the-art scheduler (Anki default since v23.10; ~20–30% fewer reviews
at equal retention on the public 700M-review benchmark).

## Scope

**In:** card-as-only-scheduled-unit; FSRS via `ts-fsrs` wrapped by
`packages/sr-engine`; 4-grade reviews end to end (DB, API, contract, web);
graduation removed in favor of manual suspension; regenerated consolidated
init migration carrying every schema fix from the deep review; `learning-os`
contract v2; seed rewrite; matching web changes (GradePicker, ReviewGate
rotation, PromptsPanel suspension, SR displays).

**Out (own specs/plans):** streak/day-evaluation rewrite (separate spec —
`Settings.timezone` lands here as schema only); import cycle guard + DTO
hardening sweep (fixes plan, no design needed); review-session mode, DSA
prompt authoring, Telegram digest (wave 2); MCP transport (wave 3); web
type-layer consolidation into `packages/types`.

## Decisions (user-confirmed)

1. **Grade scale:** FSRS-native 4 grades — `again / hard / good / easy` —
   everywhere: DB enum, DTOs, contract v2, UI buttons with keys 1–4. The 0–5
   scale is deleted, not mapped.
2. **Problems:** third `promptKind: 'problem'` on `Prompt` (+ `url`,
   `problemDifficulty`, `estimatedMinutes`), NOT a separate entity. A problem
   is a card whose recall act is solving it. UI flow is wave 2; schema lands
   now.
3. **Card-less topics:** topics carry **no SR state, ever**. Leaf topics
   arriving without cards get one auto-generated, editable **starter card**.
   Card-less reviews (Claude-session topic-level, quick log) are stored as
   **evidence-only** — visible in history, no schedule effect.
4. **Suspension is manual-only** (deviation from the review doc's
   "auto-suspend at stability ≥ 60d", approved): FSRS interval growth makes
   retirement pointless — a stability-180d card costs ~2 reviews/year.
   Graduation existed to compensate for the broken two-clock model; no
   automatic retirement replaces it.
5. **Materialized topic dueness:** `Topic.nextReviewAt` stays as a column =
   `min(nextReviewAt)` over the topic's non-suspended cards, recomputed in
   the same transaction as every card write. All existing consumers
   (dashboard, exports, streak, roadmap) keep reading it unchanged.
6. **Engine:** `ts-fsrs` (reference FSRS-6 implementation), wrapped behind a
   pure API in `packages/sr-engine`. Zero-deps property is given up
   deliberately. Desired retention: 0.9 constant (per-user setting +
   weight-fitting are future work; the Review log retains everything fitting
   needs).
7. **Pre-launch reset:** the regenerated init migration replaces the current
   one; dev DB is reset + reseeded (user runs the reset per safety policy).
   Existing reviews/streak data are discarded; `scripts-tmp/dsa-import.md`
   can be re-imported afterward (contract v1 → regenerate via the new
   export, or bulk re-import is superseded by wave 2's curriculum-with-prompts).

## Data model (regenerated `20260701113254_init` migration + schema.prisma)

New/changed enums:

```prisma
enum PromptKind { concept code problem }
enum ReviewGrade { again hard good easy }
enum CardState  { new learning review relearning }   // ts-fsrs State
enum ProblemDifficulty { easy medium hard }
enum ExportMode { full domain }
```

**Topic** — REMOVE `easeFactor`, `interval`, `repetitions`. KEEP
`nextReviewAt DateTime?` (materialized min; null when no reviewed,
non-suspended cards exist). All other fields unchanged.

**Prompt (the card):**

```prisma
model Prompt {
  id               String    @id @default(uuid())
  topicId          String
  topic            Topic     @relation(fields: [topicId], references: [id], onDelete: Cascade)
  promptText       String
  answerHint       String?
  promptKind       PromptKind @default(concept)
  // problem metadata (promptKind = problem)
  url              String?
  problemDifficulty ProblemDifficulty?
  estimatedMinutes Int?
  // lifecycle
  autoGenerated    Boolean   @default(false)
  suspended        Boolean   @default(false)
  suspendedAt      DateTime?
  // FSRS state (null/zero until first review)
  stability        Float?
  difficulty       Float?      // FSRS difficulty 1–10, not problemDifficulty
  reps             Int       @default(0)
  lapses           Int       @default(0)
  state            CardState @default(new)
  lastReviewedAt   DateTime?
  nextReviewAt     DateTime?
  reviews          Review[]
  createdAt        DateTime  @default(now())

  @@index([topicId, suspended, nextReviewAt])
}
```

`graduated` and `consecutiveGood` are deleted.

**Review** — `quality Int` → `grade ReviewGrade`. `promptId String?` kept;
**null ⇒ evidence-only** (no schedule writes). `intervalBefore Int?` /
`intervalAfter Int?` become nullable display metadata (days, computed from
the schedule; null on evidence rows) — `IntervalGrowthChart` keeps working.
`mode ReviewMode` unchanged.

**SessionExport** — `mode String` → `mode ExportMode` + `domain String?`;
`domains String[]` (always-empty dead column) deleted.

**Settings** — add `timezone String @default("UTC")` (consumed by the
upcoming streak rewrite; not read by this project).

**User** — `role` renamed `headline` (it's profile prose, not authorization).

**DailyLog** — `eveningNote` and `sessionQuality` columns deleted (no write
path exists; re-add if Stage-4 structured notes lands). `SessionQuality`
enum deleted with them.

**Indexes** (replacing the bare single-column set):
`Topic(userId, status, nextReviewAt)`, `Topic(parentId)`,
`Review(userId, reviewedAt)`, `Review(topicId, reviewedAt)`,
`Review(promptId)`, `Prerequisite(prerequisiteId)`,
`ApplicationEvent(topicId)`, `SessionExport(userId, generatedAt)`, plus the
Prompt index above.

**Cascade rules:** `User → Topic/Review/ApplicationEvent/SessionExport/
DailyLog/StreakState/TopicType/Settings` all `onDelete: Cascade`;
`Topic → Prompt` Cascade; both `Prerequisite` FKs Cascade (the manual
edge/prompt cleanup in `topics.service.ts remove()` transaction shrinks
accordingly); `Review.topicId` and `Review.promptId` stay RESTRICT —
history gates deletion; a reviewed card is suspended, not deleted
(mirror of the topic archive rule; the API returns 409 with that hint).

**Title identity:** raw statement in the hand-maintained migration.sql —
`CREATE UNIQUE INDEX "Topic_userId_title_ci_key" ON "Topic" ("userId", lower(title));`
(not expressible in schema.prisma; documented there as a comment).
`TopicsService.create` and `ImportService` trim titles before writes and map
P2002 on this index to 409/`ambiguous`-style errors instead of 500s.

## Engine (`packages/sr-engine`)

Thin, pure wrapper over `ts-fsrs`; nothing outside the package imports
`ts-fsrs` directly:

```ts
export type Grade = 'again' | 'hard' | 'good' | 'easy';
export interface CardSrState {
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: 'new' | 'learning' | 'review' | 'relearning';
  lastReviewedAt: Date | null;
  nextReviewAt: Date | null;
}
export const INITIAL_CARD_STATE: CardSrState;
export function applyGrade(state: CardSrState, grade: Grade, now: Date): CardSrState;
export function previewIntervals(state: CardSrState, now: Date):
  Record<Grade, number>; // scheduled days per grade, for UI buttons
```

Grade ↔ ts-fsrs `Rating` mapping: again=1, hard=2, good=3, easy=4. Desired
retention 0.9, default FSRS-6 weights, fuzz disabled (deterministic tests;
revisit later). `sm2()`, `SRState`, `INITIAL_SR_STATE`, and the dead
`shouldEscalate` are **deleted** (leech visibility later = derived query on
`lapses`). Tests assert against ts-fsrs-computed reference vectors plus
invariants (lapse → `lapses+1`, `state: relearning`, stability shrinks;
monotone previews `again ≤ hard ≤ good ≤ easy`).

**Plan-time verification:** `ts-fsrs` must load under the monorepo's
CommonJS resolution (`moduleResolution: node10`). It dual-publishes CJS/ESM;
confirm at install, and if broken, pin/adapt before building on it.

## Review write path (`apps/api/src/reviews/sr-apply.ts`)

`buildReviewWrites` single-signature rewrite:

- **Card review** (promptId present): caller resolves the card via
  `findFirst({ id, topicId, topic: { userId } })` **inside** the interactive
  transaction (closes the read-modify-write race). Writes: `prompt.update`
  (new FSRS state) + `review.create` (grade, mode, intervalBefore/After) +
  **recompute** `topic.nextReviewAt = min(nextReviewAt)` over the topic's
  non-suspended cards (Prisma `aggregate` in-tx).
- **Evidence review** (no promptId): `review.create` only. No schedule
  writes, no materialization change.
- Graduation logic deleted entirely.

Suspend/unsuspend (`PATCH /prompts/:id { suspended }`, replacing the
graduation endpoint) and card create/delete also recompute the topic's
materialized min in the same transaction.

## Due queue

- `MetricsService.dueCards(userId, now, domain?)` — non-suspended cards with
  `nextReviewAt <= end-of-day`, joined through `topic: { userId, status: {
  not: archived } }` — note **mastered topics keep reviewing** (this fixes
  the review finding where mastered + graduated meant zero reviews forever);
  plus a separate **`newCards` count** (`state: new`, non-suspended). New
  cards are *not* mixed into "due" — no day-1 avalanche from starter cards;
  introduction pacing is wave 2's session-budget job.
- `dueTopics` keeps working off materialized `Topic.nextReviewAt` (dashboard,
  export, streak untouched).
- `PromptsService.next(userId, topicId)` gains the missing dueness filter:
  due cards first (most overdue), then new cards; suspended excluded. The
  response includes `previewIntervals` so the web grade buttons show
  predicted intervals (Anki-style).

## Starter cards

Generated with `autoGenerated: true`, text
`"Explain <title>: what it is, when to use it, key pitfalls."`,
`promptKind: concept`:

- **Manual topic creation** (`TopicsService.create`): always.
- **Import**: for proposed topics that end the batch as card-less leaves —
  no children in the batch and no `proposedPrompts` targeting them. Root and
  category nodes therefore get none. Existing topics are never backfilled.

Starter cards are ordinary cards: editable, deletable (if unreviewed),
suspendable.

## `learning-os` contract v2

- Parser first reads `{ version: number }` and dispatches: v2 → full
  `.strict()` schema with array/string bounds; v1 → explicit 422
  `"unsupported learning-os version 1 — regenerate the export"`; the fence
  regex takes the **last** ```learning-os``` block.
- `reviews[]`: `{ promptId?, topicTitle?, grade, note? }` with a Zod refine
  requiring **at least one of** `promptId` / `topicTitle` — promptId ⇒ card
  review (resolved user-scoped; unknown id ⇒ unresolved entry, kind
  `prompt`, blocks apply); topicTitle-only ⇒ evidence review.
- `proposedPrompts[]` gains `promptKind: 'concept'|'code'|'problem'`,
  `url?`, `problemDifficulty?`, `estimatedMinutes?`.
- Export changes: the due section lists each due card's `promptId`,
  `promptKind`, and text (so Claude quizzes through real cards and
  references ids in `reviews[]`); `OUTPUT_CONTRACT` text rewritten for v2;
  MASTERY CONDITIONS reads the new retention condition (below).

## Derived metrics redefinitions

- **Mastery retention condition** (was `interval >= 30`): topic has ≥1 card
  AND `min(stability)` over non-suspended cards ≥ 30. Other two conditions
  (application event, personal note) unchanged.
- **Struggle ratio** (was `quality <= 2`): `grade = again`. The 40–60%
  desirable-difficulty gauge band is kept as-is; revisit after real data.
- `topicLabels` (blocked/reviewing) unchanged — `repetitions > 0` input
  replaced by "any card with `reps > 0`".

## Web changes (`apps/web`)

- `QualityPicker` → **`GradePicker`**: 4 buttons (Again/Hard/Good/Easy),
  keys 1–4, each showing its predicted interval from `previewIntervals`.
- `ReviewGate`: unchanged recall→reveal→grade flow; rotates through the
  topic's **due** cards (then new), resetting recall state per card (existing
  behavior); after the last one, falls back to the evidence-only quick log.
- `LogReviewForm`: sends `grade` (+ `promptId` when gated); interval preview
  now comes from the API payload — **`lib/sr.ts` deleted**.
- `PromptsPanel`: suspend/unsuspend replaces graduation UI; shows per-card
  state/stability/next due; `autoGenerated` badge.
- `TopicDetailPanel` SR strip: derived topic dueness + per-card summary
  (no more topic EF/interval); `api/types.ts` updated to match (full
  consolidation into `packages/types` stays out of scope).

## Seed & reset

`prisma/seed.ts` rewritten: demo user + a small DSA sample tree (root → 2
categories → ~6 pattern leaves) where every leaf has 1–3 real cards (mix of
concept/code/problem kinds) and a few graded reviews, so every screen has
data. The 16-flat-topic seed is deleted (the full 100-topic curriculum with
authored prompts is wave 2 content work). Reset procedure: user runs
`prisma migrate reset` themselves (deny-rule policy), then seed.

## Error handling

- Unknown/unsupported contract version → 422 with explicit message.
- Unknown `promptId` in v2 reviews → unresolved (kind `prompt`), blocks
  apply (all-or-nothing preserved).
- Deleting a reviewed card → 409 with "suspend instead" hint.
- Grade validated as enum at DTO and Zod layers; `quality` fields rejected
  by `.strict()`.

## Testing

- `sr-engine`: reference-vector tests + invariants (vitest).
- `sr-apply`: TDD — card path, evidence path, materialized-min recompute
  (incl. suspension and multi-card cases), in-tx read, no-graduation.
- `prompts.service`: dueness filter, due-before-new ordering, suspension
  exclusion, ownership scoping (existing isolation-test conventions).
- `import.service`: v2 parse/dispatch, v1 rejection, last-fence selection,
  promptId resolution, starter-card leaf rule, `.strict()` rejection.
- `metrics/export`: mastery + struggle redefinitions, due/new split.
- Full monorepo gate (build/test/lint/format) + live CDP smoke of the review
  flow per repo convention.

## Out-of-scope debts this spec knowingly leaves

Streak timezone/catch-up bugs (next spec); import cycle guard + DTO
hardening (fixes plan); `GET /sessions/export` → POST (fixes plan); web
401-recovery spine (fixes plan); session mode + time budgeting (wave 2).
