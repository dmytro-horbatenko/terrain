# Scheduling Core — One Card Unit + FSRS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse scheduling to one unit (the `Prompt` card), replace SM-2 with FSRS-6 via `ts-fsrs`, move to 4-grade reviews end to end, and regenerate the consolidated init migration with every schema fix from the deep review.

**Architecture:** `packages/sr-engine` becomes a pure wrapper over `ts-fsrs` (`applyGrade`/`previewIntervals`); `Topic` loses all SR state and gains a transactionally-materialized `nextReviewAt = min(card dues)`; `Review.grade` enum replaces `quality`; the `learning-os` contract bumps to v2 (strict, card-referencing reviews); graduation is replaced by manual suspension.

**Tech Stack:** NestJS 11, Prisma 7 (@prisma/adapter-pg), ts-fsrs, Zod, React 19 + react-query, vitest/jest.

**Normative spec (READ FIRST):** `docs/superpowers/specs/2026-07-02-scheduling-core-fsrs-design.md`. Where this plan says "per spec", the spec's field lists and rules are verbatim requirements. Background: `docs/reviews/2026-07-02-deep-review.md`.

## Global Constraints

- **NO git commits.** Work stays uncommitted on `main` (repo convention). Where this skill's template says "Commit", instead run the task's test gate. Per-task review diffs via tree snapshots: `git add -A && git write-tree && git reset -q` before and after each task, then `git diff <before> <after>`.
- **NO new migration files.** Schema changes go into `apps/api/prisma/schema.prisma` AND the single consolidated `apps/api/prisma/migrations/20260701113254_init/migration.sql` (pre-launch convention).
- **NEVER run `prisma migrate reset` / `docker compose down -v`** — deny-ruled. The DB reset in Task 14 is run BY THE USER; the plan pauses there.
- Monorepo is CommonJS (`packages/*`, `apps/api`); `apps/web` is ESM. TS 6, `moduleResolution: node10`.
- Commands from repo root: `yarn workspace @terrain/sr-engine test|build`, `yarn workspace @terrain/types test|build`, `yarn workspace @terrain/api test|build`, `yarn workspace @terrain/web build`, `yarn lint`, `yarn format:check`.
- After editing `packages/*` sources, run that package's `build` before running API tests (API resolves `@terrain/*` from `dist`).
- Prisma client regen: `yarn workspace @terrain/api exec prisma generate` (needed after Task 3, before Tasks 5–10 compile).
- Dev API kill: `kill -9 $(lsof -ti:3000)` (never `pkill -f "nest start"`).

---

### Task 1: Rewrite `packages/sr-engine` as an FSRS wrapper

**Files:**
- Modify: `packages/sr-engine/package.json` (add dep `ts-fsrs`)
- Rewrite: `packages/sr-engine/src/index.ts`
- Rewrite: `packages/sr-engine/src/sm2.test.ts` → rename to `packages/sr-engine/src/fsrs.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 5, 6):
  ```ts
  export type Grade = 'again' | 'hard' | 'good' | 'easy';
  export interface CardSrState {
    stability: number | null; difficulty: number | null;
    reps: number; lapses: number;
    state: 'new' | 'learning' | 'review' | 'relearning';
    lastReviewedAt: Date | null; nextReviewAt: Date | null;
  }
  export const INITIAL_CARD_STATE: CardSrState;
  export function applyGrade(state: CardSrState, grade: Grade, now: Date): CardSrState;
  export function previewIntervals(state: CardSrState, now: Date): Record<Grade, number>; // days, >= 0
  ```

- [ ] **Step 1: Install and verify CJS interop**

```bash
yarn workspace @terrain/sr-engine add ts-fsrs
node -e "const f = require('/Users/dmitrijgorbatenko/personal/consistency/node_modules/ts-fsrs'); console.log(typeof f.fsrs, typeof f.createEmptyCard, typeof f.Rating)"
```
Expected: `function function object`. If `require` fails (ESM-only build), STOP and report — do not improvise a workaround; the fallback decision (pin older version vs dynamic import) is a controller decision.

- [ ] **Step 2: Write the failing tests** (`src/fsrs.test.ts`)

Read `node_modules/ts-fsrs/dist/index.d.ts` first to confirm exact API names for the version installed (expect `fsrs`, `generatorParameters`, `createEmptyCard`, `Rating`, `State`, `Card`). Tests are differential (wrapper vs direct ts-fsrs) plus invariants — they survive weight changes between ts-fsrs versions:

```ts
import { describe, expect, it } from 'vitest';
import { applyGrade, INITIAL_CARD_STATE, previewIntervals } from './index';

const NOW = new Date('2026-07-02T10:00:00Z');

describe('applyGrade', () => {
  it('first good review leaves new state, sets stability/difficulty and a future due', () => {
    const s = applyGrade(INITIAL_CARD_STATE, 'good', NOW);
    expect(s.reps).toBe(1);
    expect(s.lapses).toBe(0);
    expect(s.stability).toBeGreaterThan(0);
    expect(s.difficulty).toBeGreaterThan(0);
    expect(s.lastReviewedAt).toEqual(NOW);
    expect(s.nextReviewAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(s.state).not.toBe('new');
  });

  it('again on a mature card increments lapses, moves to relearning, shrinks stability', () => {
    let s = applyGrade(INITIAL_CARD_STATE, 'good', NOW);
    s = applyGrade(s, 'good', new Date(NOW.getTime() + 3 * 86_400_000));
    s = applyGrade(s, 'good', new Date(NOW.getTime() + 13 * 86_400_000));
    const before = s.stability!;
    const lapsed = applyGrade(s, 'again', new Date(NOW.getTime() + 40 * 86_400_000));
    expect(lapsed.lapses).toBe(s.lapses + 1);
    expect(lapsed.state).toBe('relearning');
    expect(lapsed.stability!).toBeLessThan(before);
  });

  it('easy schedules further out than hard on the same state', () => {
    const base = applyGrade(INITIAL_CARD_STATE, 'good', NOW);
    const later = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(applyGrade(base, 'easy', later).nextReviewAt!.getTime())
      .toBeGreaterThan(applyGrade(base, 'hard', later).nextReviewAt!.getTime());
  });
});

describe('previewIntervals', () => {
  it('returns monotone non-negative day counts for all four grades', () => {
    const p = previewIntervals(INITIAL_CARD_STATE, NOW);
    expect(p.again).toBeGreaterThanOrEqual(0);
    expect(p.again).toBeLessThanOrEqual(p.hard);
    expect(p.hard).toBeLessThanOrEqual(p.good);
    expect(p.good).toBeLessThanOrEqual(p.easy);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `yarn workspace @terrain/sr-engine test` → FAIL (`applyGrade` not exported).

- [ ] **Step 4: Implement** (`src/index.ts`, complete file — deletes `sm2`, `SRState`, `INITIAL_SR_STATE`, `shouldEscalate`)

```ts
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
} from 'ts-fsrs';

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

export const INITIAL_CARD_STATE: CardSrState = {
  stability: null,
  difficulty: null,
  reps: 0,
  lapses: 0,
  state: 'new',
  lastReviewedAt: null,
  nextReviewAt: null,
};

const RATING: Record<Grade, Rating> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const STATE_TO_DB: Record<State, CardSrState['state']> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const STATE_FROM_DB: Record<CardSrState['state'], State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const engine = fsrs(generatorParameters({ enable_fuzz: false, request_retention: 0.9 }));

function toFsrsCard(s: CardSrState, now: Date): Card {
  if (s.state === 'new' && s.reps === 0) return createEmptyCard(now);
  const last = s.lastReviewedAt ?? now;
  const due = s.nextReviewAt ?? now;
  return {
    ...createEmptyCard(last),
    due,
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    elapsed_days: Math.max(0, Math.round((now.getTime() - last.getTime()) / 86_400_000)),
    scheduled_days: Math.max(0, Math.round((due.getTime() - last.getTime()) / 86_400_000)),
    reps: s.reps,
    lapses: s.lapses,
    state: STATE_FROM_DB[s.state],
    last_review: s.lastReviewedAt ?? undefined,
  };
}

function fromFsrsCard(card: Card, now: Date): CardSrState {
  return {
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_DB[card.state],
    lastReviewedAt: now,
    nextReviewAt: card.due,
  };
}

export function applyGrade(state: CardSrState, grade: Grade, now: Date): CardSrState {
  const next = engine.next(toFsrsCard(state, now), now, RATING[grade]);
  return fromFsrsCard(next.card, now);
}

export function previewIntervals(state: CardSrState, now: Date): Record<Grade, number> {
  const card = toFsrsCard(state, now);
  const days = (g: Grade) =>
    Math.max(
      0,
      Math.round((engine.next(card, now, RATING[g]).card.due.getTime() - now.getTime()) / 86_400_000),
    );
  return { again: days('again'), hard: days('hard'), good: days('good'), easy: days('easy') };
}
```

If the installed ts-fsrs version's `.d.ts` differs (e.g. `next()` absent, only `repeat()`), adapt the two call sites — the exported wrapper API must not change.

- [ ] **Step 5: Gate** — `yarn workspace @terrain/sr-engine test` → all pass; `yarn workspace @terrain/sr-engine build` → exit 0. Grep for stale consumers (they are fixed in their own tasks, this is inventory only): `grep -rn "shouldEscalate\|INITIAL_SR_STATE\|sm2(" apps/ --include="*.ts" --include="*.tsx" -l`.

---

### Task 2: `learning-os` contract v2 in `packages/types`

**Files:**
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/learning-os.test.ts`

**Interfaces:**
- Produces (consumed by Task 9):
  ```ts
  export const GRADES = ['again', 'hard', 'good', 'easy'] as const;
  export type Grade = (typeof GRADES)[number];
  export type LearningOsV2 = z.infer<typeof learningOsV2Schema>;
  // parseLearningOs(raw: string): LearningOsV2  — throws LearningOsParseError with .code
  //   'no-block' | 'invalid-json' | 'unsupported-version' | 'schema'
  ```
- Keep existing exported enums (`TOPIC_STATUSES` etc.) untouched.

- [ ] **Step 1: Write failing tests** — replace the v1 cases in `learning-os.test.ts`:

```ts
// key cases (write all of these):
it('parses a minimal valid v2 block');                       // version:2, all arrays defaulted []
it('review with promptId only is valid');
it('review with topicTitle only is valid');
it('review with neither promptId nor topicTitle fails');     // refine
it('rejects version 1 with unsupported-version code');       // clear message, not a Zod dump
it('rejects unknown top-level keys (strict)');
it('rejects unknown review keys e.g. quality (strict)');
it('takes the LAST learning-os fence when two are present');
it('proposedPrompts accepts promptKind problem with url/problemDifficulty/estimatedMinutes');
it('proposedPrompts rejects estimatedMinutes > 240 and promptText > 2000 chars'); // bounds
```

- [ ] **Step 2: Run to verify failure** — `yarn workspace @terrain/types test` → FAIL.

- [ ] **Step 3: Implement.** In `index.ts`: keep the fence extraction but make it last-match:

```ts
const FENCE = /```learning-os\s*\n([\s\S]*?)```/g;
export function extractLearningOsBlock(raw: string): string | null {
  let last: string | null = null;
  for (const m of raw.matchAll(FENCE)) last = m[1];
  return last;
}
```

Version dispatch before full validation:

```ts
export class LearningOsParseError extends Error {
  constructor(
    public readonly code: 'no-block' | 'invalid-json' | 'unsupported-version' | 'schema',
    message: string,
  ) {
    super(message);
  }
}

export function parseLearningOs(raw: string): LearningOsV2 {
  const block = extractLearningOsBlock(raw);
  if (!block) throw new LearningOsParseError('no-block', 'no learning-os block found');
  let json: unknown;
  try {
    json = JSON.parse(block);
  } catch {
    throw new LearningOsParseError('invalid-json', 'learning-os block is not valid JSON');
  }
  const version = z.object({ version: z.number() }).passthrough().safeParse(json);
  if (!version.success || version.data.version !== 2) {
    throw new LearningOsParseError(
      'unsupported-version',
      `unsupported learning-os version ${version.success ? version.data.version : '<missing>'} — regenerate the export and re-run the session`,
    );
  }
  const parsed = learningOsV2Schema.safeParse(json);
  if (!parsed.success) throw new LearningOsParseError('schema', parsed.error.message);
  return parsed.data;
}
```

v2 schema (all objects `.strict()`, per-spec fields and bounds):

```ts
export const GRADES = ['again', 'hard', 'good', 'easy'] as const;
export type Grade = (typeof GRADES)[number];

const reviewV2Schema = z
  .object({
    promptId: z.string().uuid().optional(),
    topicTitle: z.string().min(1).max(300).optional(),
    grade: z.enum(GRADES),
    note: z.string().max(2000).optional(),
  })
  .strict()
  .refine((r) => r.promptId != null || r.topicTitle != null, {
    message: 'review needs promptId or topicTitle',
  });

const proposedPromptV2Schema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    promptText: z.string().min(1).max(2000),
    answerHint: z.string().max(2000).optional(),
    promptKind: z.enum(['concept', 'code', 'problem']).default('concept'),
    url: z.string().url().max(500).optional(),
    problemDifficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    estimatedMinutes: z.number().int().min(1).max(240).optional(),
  })
  .strict();

export const learningOsV2Schema = z
  .object({
    version: z.literal(2),
    sessionId: z.string().max(100).nullable().optional(),
    reviews: z.array(reviewV2Schema).max(200).default([]),
    proposedTopics: z.array(proposedTopicSchema).max(200).default([]),   // make .strict() too
    proposedPrompts: z.array(proposedPromptV2Schema).max(500).default([]),
    noteSummaries: z.array(noteSummarySchema).max(200).default([]),      // make .strict() too
    nextSession: z
      .object({ focusTitle: z.string().max(300).nullable().optional(), coldChallenge: z.string().max(500).nullable().optional() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
```

Keep `proposedTopicSchema`/`noteSummarySchema` field-compatible with v1 but add `.strict()` and length bounds (`title/topicTitle ≤ 300`, free text ≤ 2000). Delete the v1 `learningOsSchema` export and its `quality` field entirely.

- [ ] **Step 4: Gate** — `yarn workspace @terrain/types test` → pass; `yarn workspace @terrain/types build` → 0.

---

### Task 3: Schema + regenerated init migration

**Files:**
- Rewrite: `apps/api/prisma/schema.prisma` (per spec's Data model section, verbatim)
- Regenerate: `apps/api/prisma/migrations/20260701113254_init/migration.sql`

**Interfaces:**
- Produces: Prisma client types used by Tasks 5–10 (`ReviewGrade`, `PromptKind`, `CardState`, `ProblemDifficulty`, `ExportMode` enums; new `Prompt` fields; `Topic` without SR fields; `Review.grade`; `Settings.timezone`; `User.headline`).

- [ ] **Step 1: Rewrite `schema.prisma`** exactly per the spec's Data model section: the five enums; `Topic` minus `easeFactor/interval/repetitions` plus indexes `@@index([userId, status, nextReviewAt])` and `@@index([parentId])` and comment noting the raw CI unique index; `Prompt` as spec'd (with `@@index([topicId, suspended, nextReviewAt])`, `onDelete: Cascade` from topic); `Review` with `grade ReviewGrade`, nullable `intervalBefore/intervalAfter`, `@@index([userId, reviewedAt])`, `@@index([topicId, reviewedAt])`, `@@index([promptId])`, `onDelete: Restrict` on both topic and prompt relations; `Prerequisite` FKs `onDelete: Cascade`; `ApplicationEvent` `@@index([topicId])`; `SessionExport` with `mode ExportMode`, `domain String?`, no `domains`, `@@index([userId, generatedAt])`; `DailyLog` without `eveningNote/sessionQuality` (delete `SessionQuality` enum); `Settings.timezone String @default("UTC")`; `User.headline String?` (rename from `role`); every `User`-child relation `onDelete: Cascade`.

- [ ] **Step 2: Regenerate the migration SQL from the schema** (guarantees consistency; do NOT hand-write the DDL):

```bash
cd apps/api && yarn exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20260701113254_init/migration.sql
```

Then append the raw index at the end of the file:

```sql
-- case-insensitive title identity per user (not expressible in schema.prisma)
CREATE UNIQUE INDEX "Topic_userId_title_ci_key" ON "Topic" ("userId", lower("title"));
```

- [ ] **Step 3: Regenerate the client** — `yarn workspace @terrain/api exec prisma generate` → success. Do NOT run `migrate deploy`/`reset` (Task 14, user-run).

- [ ] **Step 4: Gate** — `grep -c "CREATE TABLE" apps/api/prisma/migrations/20260701113254_init/migration.sql` → 10 tables; grep confirms `ReviewGrade`, `Topic_userId_title_ci_key`, no `easeFactor` column on `"Topic"`, `ON DELETE CASCADE` on `"Prompt"` topic FK. API build is EXPECTED RED until Tasks 5–10 (matches the SP1 precedent); note it and move on.

---

### Task 4: Seed rewrite

**Files:**
- Rewrite: `apps/api/prisma/seed.ts`

**Interfaces:**
- Consumes: Task 3 client. Produces: demo data every screen can render.

- [ ] **Step 1: Rewrite seed.** Keep: `import 'dotenv/config'` first, adapter-constructed `PrismaClient`, argon2 hash of `demo-password`, idempotency (upsert-by-natural-key), demo user profile (rename `role`→`headline`), 1 StreakState, 1 Settings (`timezone: 'Europe/Kyiv'`), the 8 TopicTypes. Replace the 16 flat topics with: root `Data Structures & Algorithms` (domain DSA, type concept) → categories `Arrays & Hashing`, `Two Pointers` → leaves: `Hashing fundamentals`, `Two Sum / complement lookup`, `Prefix sums`, `Opposite-direction pointers`, `Fast & slow pointers`, `Three-way partitioning (Dutch national flag)` (type pattern, parented to their category, in-category chain prerequisites, categories require root... no — root has no prereqs; `Two Pointers` category requires `Arrays & Hashing` per the DSA spec). Every leaf gets 1 concept card (`autoGenerated: true`, starter text per spec) plus, on `Two Sum / complement lookup`: 1 code card (`"Write two-sum with a complement hash map from scratch."`) and 1 problem card (`promptText: "Solve: Two Sum"`, `promptKind: 'problem'`, `url: 'https://leetcode.com/problems/two-sum/'`, `problemDifficulty: 'easy'`, `estimatedMinutes: 15`). Give `Hashing fundamentals`'s starter card a review history so charts render: 3 reviews (`good`, `good`, `again`) on days −10/−6/−1 relative to now — compute each card state by calling `applyGrade` from `@terrain/sr-engine` sequentially, write the final state to the card, one `Review` row per step (`mode: 'app_log'`, `grade`, `intervalBefore/After` from the successive `nextReviewAt` deltas in days), and set the topic's materialized `nextReviewAt` to the min over its cards.
- [ ] **Step 2: Typecheck only** (no DB yet): `yarn workspace @terrain/api exec tsc --noEmit prisma/seed.ts` is not wired; instead `yarn workspace @terrain/api build` compiles `prisma/seed.ts`? It does NOT (outside src). Gate: `yarn workspace @terrain/api exec tsx --tsconfig tsconfig.json -e "import('./prisma/seed.ts').catch(e => { console.error(e); process.exit(1) })"` will attempt a DB connection — SKIP live run; instead run `yarn workspace @terrain/api exec tsc --noEmit -p tsconfig.json` after temporarily confirming seed.ts is included, or simply defer execution to Task 14 and gate this task on review-only. Acceptable gate: `npx tsc --noEmit prisma/seed.ts` from `apps/api` with `--esModuleInterop --skipLibCheck` → exit 0.

---

### Task 5: `sr-apply` + reviews module rewrite

**Files:**
- Rewrite: `apps/api/src/reviews/sr-apply.ts`, `apps/api/src/reviews/sr-apply.spec.ts`
- Modify: `apps/api/src/reviews/reviews.service.ts`, `reviews.service.spec.ts`, `apps/api/src/reviews/dto.ts`

**Interfaces:**
- Consumes: Task 1 engine API; Task 3 client.
- Produces (consumed by Tasks 6, 9):
  ```ts
  // sr-apply.ts
  export interface CardReviewInput {
    userId: string; topicId: string;
    prompt: { id: string } & CardSrStateRow;   // row fields matching CardSrState
    grade: Grade; mode: ReviewMode; durationMin?: number; note?: string; now: Date;
  }
  export function buildCardReviewWrites(input: CardReviewInput): {
    promptUpdate: { where: { id: string }; data: PromptSrData };
    reviewCreate: Prisma.ReviewUncheckedCreateInput;
  };
  export function buildEvidenceReviewWrite(input: Omit<CardReviewInput,'prompt'>): Prisma.ReviewUncheckedCreateInput;
  export async function recomputeTopicDue(tx: Prisma.TransactionClient, topicId: string): Promise<void>;
  ```

- [ ] **Step 1: Write failing tests** (`sr-apply.spec.ts` rewrite):

```ts
// cases (write all):
it('card review: promptUpdate carries applyGrade output mapped to DB fields');
it('card review: reviewCreate has grade, promptId, userId, topicId, intervalBefore/After in days');
it('card review on new card: intervalBefore 0');
it('evidence review: creates review with promptId null and null intervalBefore/After');
it('no graduation fields are ever written');   // assert promptUpdate.data lacks graduated/consecutiveGood
it('recomputeTopicDue sets topic.nextReviewAt to min over non-suspended cards');  // tx mock: aggregate → update
it('recomputeTopicDue sets null when no non-suspended reviewed cards remain');
```

`recomputeTopicDue` tx-mock assertion (real behavior, not echo): stub `tx.prompt.aggregate` to return `{ _min: { nextReviewAt: X } }` and assert `tx.topic.update({ where: { id }, data: { nextReviewAt: X } })`.

- [ ] **Step 2: Run** — `yarn workspace @terrain/api test --testPathPattern=sr-apply` → FAIL.
- [ ] **Step 3: Implement `sr-apply.ts`:**

```ts
import { applyGrade, type CardSrState, type Grade } from '@terrain/sr-engine';
// … types per Interfaces block

const DAY = 86_400_000;
const daysBetween = (a: Date | null, b: Date | null) =>
  a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY)) : 0;

export function buildCardReviewWrites(input: CardReviewInput) {
  const before: CardSrState = {
    stability: input.prompt.stability, difficulty: input.prompt.difficulty,
    reps: input.prompt.reps, lapses: input.prompt.lapses,
    state: input.prompt.state, lastReviewedAt: input.prompt.lastReviewedAt,
    nextReviewAt: input.prompt.nextReviewAt,
  };
  const after = applyGrade(before, input.grade, input.now);
  return {
    promptUpdate: {
      where: { id: input.prompt.id },
      data: {
        stability: after.stability, difficulty: after.difficulty,
        reps: after.reps, lapses: after.lapses, state: after.state,
        lastReviewedAt: after.lastReviewedAt, nextReviewAt: after.nextReviewAt,
      },
    },
    reviewCreate: {
      userId: input.userId, topicId: input.topicId, promptId: input.prompt.id,
      grade: input.grade, mode: input.mode,
      durationMin: input.durationMin ?? null, note: input.note ?? null,
      intervalBefore: daysBetween(before.lastReviewedAt, before.nextReviewAt),
      intervalAfter: daysBetween(input.now, after.nextReviewAt),
      reviewedAt: input.now,
    },
  };
}

export function buildEvidenceReviewWrite(input: Omit<CardReviewInput, 'prompt'>) {
  return {
    userId: input.userId, topicId: input.topicId, promptId: null,
    grade: input.grade, mode: input.mode,
    durationMin: input.durationMin ?? null, note: input.note ?? null,
    intervalBefore: null, intervalAfter: null, reviewedAt: input.now,
  };
}

export async function recomputeTopicDue(tx: Prisma.TransactionClient, topicId: string) {
  const min = await tx.prompt.aggregate({
    where: { topicId, suspended: false, nextReviewAt: { not: null } },
    _min: { nextReviewAt: true },
  });
  await tx.topic.update({ where: { id: topicId }, data: { nextReviewAt: min._min.nextReviewAt ?? null } });
}
```

- [ ] **Step 4: Rewrite `reviews.service.ts logReview`** as ONE interactive `$transaction(async (tx) => …)`: verify topic `tx.topic.findFirst({ where: { id: dto.topicId, userId } })` → 404; if `dto.promptId`: `tx.prompt.findFirst({ where: { id: dto.promptId, topicId: dto.topicId, topic: { userId } } })` → 404 if missing → `buildCardReviewWrites` → `tx.prompt.update` + `tx.review.create` + `recomputeTopicDue(tx, topicId)`; else `tx.review.create(buildEvidenceReviewWrite(...))`. Return `{ review, previewNextReviewAt }`. Update `dto.ts`: `grade` with `@IsIn(GRADES)` replaces `quality`; keep `promptId?/mode/durationMin(@IsInt @Min(0))/note`; update `reviews.service.spec.ts` to the interactive-tx mock shape and grade field (isolation tests keep asserting `userId` inside `where`).
- [ ] **Step 5: Gate** — `yarn workspace @terrain/api test --testPathPattern="reviews|sr-apply"` → pass (full API suite still red until Tasks 6–10; that's expected).

---

### Task 6: Prompts module — dueness, rotation, suspension

**Files:**
- Modify: `apps/api/src/prompts/prompts.service.ts`, `prompts.service.spec.ts`, `prompts.controller.ts`, `apps/api/src/prompts/dto.ts`
- Create: `apps/api/src/prompts/starter-card.ts`

**Interfaces:**
- Consumes: `previewIntervals` (Task 1).
- Produces: `next(userId, topicId)` → `{ prompt, previewIntervals } | null` (due-first, then new; suspended excluded); `setSuspended(userId, promptId, suspended)` (replaces `setGraduated`; recomputes topic due); `starterCardText(title): string` + `STARTER_CARD_DATA(title)` used by Tasks 8, 9.

- [ ] **Step 1: Failing tests:** `next()` prefers overdue over new (`nextReviewAt <= now` ordered asc, then `state: 'new'` by createdAt asc); excludes `suspended: true`; excludes nothing by graduation (field gone); returns `previewIntervals` computed from the row; ownership via `topic: { userId }` in `where`; suspend sets `suspended/suspendedAt` and calls topic-due recompute; unsuspend clears both; delete of a reviewed card → 409 `suspend instead` (reviews count > 0), unreviewed delete OK + recompute.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`starter-card.ts`: `export const starterCardText = (title: string) => \`Explain ${title}: what it is, when to use it, key pitfalls.\`;`). Controller: `PATCH /prompts/:id` body `{ suspended: boolean }` (`@IsBoolean`), `DELETE /prompts/:id`.
- [ ] **Step 4: Gate** — `yarn workspace @terrain/api test --testPathPattern=prompts` → pass.

---

### Task 7: Metrics — due/new split + redefinitions

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts`, `metrics.service.spec.ts`, `metrics.controller.ts`

**Interfaces:**
- Produces: `dueCards(userId, now, domain?)` and `newCardsCount(userId, domain?)` (both scoped `topic: { userId, status: { not: 'archived' }, ...(domain && { domain }) }`, `suspended: false`); dashboard payload gains `newCards: number`; `struggleRatio7d` counts `grade: 'again'`; `masteryStatus(topic, cards, events)` retention condition = `cards.length > 0 && min(stability of non-suspended) >= 30`; `topicLabels` reviewing input = `cards.some(c => c.reps > 0)`; `dueTopics` unchanged (materialized column).

- [ ] **Step 1: Failing tests** for each redefinition (mastery boundary at stability 29.9 vs 30; struggle counts again only — hard is NOT struggle; due/new split; archived excluded, mastered INCLUDED in dueCards).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Gate** — `--testPathPattern=metrics` → pass.

---

### Task 8: Topics module — starter card, cascades, title identity

**Files:**
- Modify: `apps/api/src/topics/topics.service.ts`, `topics.service.spec.ts`, `apps/api/src/topics/dto.ts`

**Interfaces:**
- Consumes: `starterCardText` (Task 6). Produces: `create()` also creates one starter card (`autoGenerated: true`, kind concept) in the same `$transaction`; titles trimmed on create/update; P2002 on the CI index → `ConflictException('a topic with this title already exists')`; `remove()` transaction shrinks — Prisma cascades now delete prompts + prerequisite edges (keep: 409 when reviews/appEvents exist, children `parentId: null`, then `topic.delete`); `getDetail` includes cards with new fields.

- [ ] Steps: failing tests (starter card created with topic; trim; 409 on dup title; remove no longer issues `prompt.deleteMany`/`prerequisite.deleteMany` — assert those mocks NOT called) → run FAIL → implement → gate `--testPathPattern=topics` → pass.

---

### Task 9: Import v2

**Files:**
- Modify: `apps/api/src/import/import.service.ts`, `import.service.spec.ts`, `import.controller.ts`

**Interfaces:**
- Consumes: `parseLearningOs`/`LearningOsParseError` (Task 2), `buildCardReviewWrites`/`buildEvidenceReviewWrite`/`recomputeTopicDue` (Task 5), `starterCardText` (Task 6).
- Produces: v2 preview/apply. Plan resolution: `reviews[].promptId` resolved via `prompt.findFirst({ where: { id, topic: { userId } } })` → miss = unresolved `{ kind: 'prompt', ref: promptId }` blocking apply; `topicTitle`-only reviews → evidence writes (topic resolved by title as today). `proposedPrompts` thread `promptKind/url/problemDifficulty/estimatedMinutes` into `tx.prompt.create`. Starter-card rule at apply time: for each created topic with no batch children and no batch prompts targeting it → create starter card. Card reviews recompute each touched topic's due once (dedupe topicIds). `LearningOsParseError` maps: `unsupported-version`/`schema`/`invalid-json`/`no-block` → 400/422 with the error's own message (no `e.message` passthrough of arbitrary errors).

- [ ] Steps: failing tests (v1 block → 422 `unsupported-version`; promptId unresolved blocks apply; evidence import writes no prompt update; starter-card leaf rule incl. "category with batch children gets none"; new prompt fields persisted; dedup/atomic-claim behaviors preserved from existing suite) → run FAIL → implement → gate `--testPathPattern=import` → pass.

---

### Task 10: Export v2 + output contract

**Files:**
- Modify: `apps/api/src/sessions/output-contract.ts`, `export-generator.service.ts`, `export-generator.service.spec.ts`, `output-contract.spec.ts`, `sessions.service.ts`, `sessions.controller.ts`

**Interfaces:**
- Produces: due section lists due cards per topic as lines `  - card <id> [<kind>] <promptText>` under each due topic; MASTERY CONDITIONS text uses the new retention rule wording (`all active cards at stability ≥ 30d`); `SessionExport` writes `mode: ExportMode` + `domain: string | null` (no `domains`); OUTPUT_CONTRACT replaced with the v2 text below (verbatim):

```ts
export const OUTPUT_CONTRACT = `## OUTPUT CONTRACT — return exactly one fenced block

When the session ends, output ONE fenced code block tagged \`learning-os\` containing this JSON
(prose may surround it; only the LAST such block is parsed):

\`\`\`learning-os
{
  "version": 2,
  "sessionId": "<echo the Session id from this export header>",
  "reviews": [
    { "promptId": "<id from the DUE list above>", "grade": "good", "note": "optional" },
    { "topicTitle": "<exact title — session-level evidence only, moves no schedule>", "grade": "hard" }
  ],
  "proposedTopics": [
    { "title": "...", "type": "pattern", "domain": "DSA", "description": "...",
      "prerequisiteTitles": [], "parentTitle": null, "aiContext": "why proposed" }
  ],
  "proposedPrompts": [
    { "topicTitle": "<exact title, existing or from proposedTopics>",
      "promptText": "...", "answerHint": "optional",
      "promptKind": "concept | code | problem",
      "url": "https://leetcode.com/problems/... (problem kind only)",
      "problemDifficulty": "easy | medium | hard (problem kind only)",
      "estimatedMinutes": 15 }
  ],
  "noteSummaries": [
    { "topicTitle": "...", "keyInsight": "...", "invariant": "...",
      "contradiction": "...", "suggestedNoteRef": "..." }
  ],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: grade is one of again|hard|good|easy — the user's own recall verdict, never yours.
Quiz through the DUE cards listed in this export and reference them by promptId.
Prefer promptId reviews; use topicTitle-only reviews only for work outside any listed card.
Omit arrays you have nothing for (use []). Do not add fields outside this schema — the parser
is strict and will reject the whole block. Keep each prompt atomic — one fact or concept per
prompt. promptKind: "code" = write an implementation from scratch; "problem" = a concrete
practice problem (include url + problemDifficulty + estimatedMinutes).`;
```

- [ ] Steps: failing tests (due card lines rendered with id/kind/text; OUTPUT_CONTRACT still last; mastery wording; `domain` column written for domain mode, null for full; all existing invariants — parked ideas, recent sessions, suggested focus — still pass with updated mocks) → run FAIL → implement → gate: **full API suite** `yarn workspace @terrain/api test` → ALL suites pass; `yarn workspace @terrain/api build` → exit 0 (first green build since Task 3 — this is the integration gate); `yarn lint && yarn format:check` → clean.

---

### Task 11: Web data layer

**Files:**
- Modify: `apps/web/src/api/types.ts`, `apps/web/src/api/client.ts`, `apps/web/src/api/hooks.ts`
- Delete: `apps/web/src/lib/sr.ts`

**Interfaces:**
- Produces: `type Grade = 'again' | 'hard' | 'good' | 'easy'`; `Prompt` type with FSRS/problem/suspension fields; `Review.grade`; `Topic` without `easeFactor/interval/repetitions`; `NextPromptPayload = { prompt: Prompt; previewIntervals: Record<Grade, number> } | null`; `LogReviewInput.grade`; `useSetPromptSuspended(promptId, suspended)` replacing the graduation mutation; `useDeletePrompt`; dashboard type gains `newCards: number`. Also fix the phantom `id: number` on `Settings`/`StreakState` (drift found in review).

- [ ] Steps: update types/client/hooks; delete `lib/sr.ts` and its imports; gate `yarn workspace @terrain/web build` → EXPECTED RED at consumers (screens/components fixed in Tasks 12–13); acceptable task gate: `grep -rn "quality\|graduated\|lib/sr" apps/web/src/api/` → no hits, and the only web-build errors are in `screens/`/`components/`.

---

### Task 12: GradePicker + review flow

**Files:**
- Create: `apps/web/src/components/GradePicker.tsx`
- Delete: `apps/web/src/components/QualityPicker.tsx`
- Modify: `apps/web/src/components/LogReviewForm.tsx`, `apps/web/src/components/ReviewGate.tsx`, `apps/web/src/components/index.ts`, `apps/web/src/screens/Dashboard/index.tsx`

**Interfaces:**
- Consumes: Task 11 types/hooks.
- Produces: `GradePicker({ value, onSelect, previews? })` — four buttons labeled `Again / Hard / Good / Easy`, each with a sub-label from `previews` (`0` → `today`, `1` → `1d`, n → `${n}d`; hidden when `previews` undefined); global keydown 1–4 while mounted (ignores events from inputs/textareas/`.cm-editor`); `LogReviewForm` submits `grade` (+`promptId` when gated) and shows previews only for card reviews; ReviewGate keeps recall→reveal→grade and per-card reset (existing `prompt?.id` effect), evidence fallback when `next` is null; Dashboard shows `New: {newCards}` chip next to the due count.

- [ ] Steps: implement → gate `yarn workspace @terrain/web build` (may still be red only in PromptsPanel/TopicDetailPanel — Task 13) → `grep -rn "QualityPicker" apps/web/src` → no hits.

---

### Task 13: PromptsPanel + TopicDetailPanel

**Files:**
- Modify: `apps/web/src/components/PromptsPanel.tsx`, `apps/web/src/components/TopicDetailPanel.tsx`

**Interfaces:**
- Consumes: Tasks 11–12. Produces: PromptsPanel lists cards with kind badge (`concept/code/problem`), `autoGenerated` marker (`✦ starter`), state/stability/next-due line (`stability 12d · due 2026-07-14`, `new` when unreviewed), Suspend/Unsuspend button per card (replaces the graduation badge/un-graduate UI), problem cards render `url` link + difficulty + `~{estimatedMinutes}m`; TopicDetailPanel SR strip shows `Next review: <topic.nextReviewAt | '—'>` + `cards: N (M due, K new)` instead of EF/interval/repetitions.

- [ ] Steps: implement → gate: **`yarn workspace @terrain/web build` → exit 0 (tsc --noEmit + vite build — full web green)**; `yarn lint && yarn format:check` → clean.

---

### Task 14: Reset (USER-RUN) + live E2E

**Files:** none (verification only; findings go to the ledger).

- [ ] **Step 1: PAUSE — ask the user to run the reset** (deny-ruled for agents): `docker compose up -d` then `yarn workspace @terrain/api exec prisma migrate reset` (drops + re-applies the regenerated init) — seed runs via reset hook or manually: `yarn workspace @terrain/api exec tsx prisma/seed.ts`.
- [ ] **Step 2: Full monorepo gate** — `yarn build && yarn test && yarn lint && yarn format:check` → all green.
- [ ] **Step 3: Fresh stack** — kill stale servers (`kill -9 $(lsof -ti:3000)`, same for 5180), `yarn workspace @terrain/api start &`, `yarn workspace @terrain/web dev &`.
- [ ] **Step 4: Live API smoke** (curl, login as `demo@terrain.local`/`demo-password`):
  1. `GET /topics` → seeded tree; pick `Hashing fundamentals` → topic `nextReviewAt` = its card's (overdue).
  2. `GET /topics/:id/prompts/next` → `{ prompt, previewIntervals }` with 4 keys.
  3. `POST /reviews {topicId, promptId, grade:'good', mode:'app_log'}` → 200; re-GET topic → `nextReviewAt` advanced; `psql` check: Review row has `grade='good'`, prompt `reps` incremented.
  4. `POST /reviews` same body with `grade:'again'` → prompt `lapses+1`, `state='relearning'`, topic due today/soon.
  5. Evidence: `POST /reviews {topicId, grade:'hard', mode:'app_log'}` (no promptId) → 200, prompt states untouched.
  6. `PATCH /prompts/:id {suspended:true}` on the only due card → topic `nextReviewAt` recomputed (null or next card).
  7. `GET /sessions/export?mode=full` → due section shows `card <id> [concept]` lines; OUTPUT CONTRACT v2 (`"version": 2`, grade names) and is the last section.
  8. Import round-trip: POST a v2 block reviewing a listed promptId + proposing 1 problem-kind prompt → preview 0 unresolved → apply 200 → card advanced, new problem card exists with url/difficulty/minutes. POST a v1 block → 422 `unsupported learning-os version 1`.
- [ ] **Step 5: UI smoke** — `node scripts/smoke.mjs` (all routes, 0 console errors) + targeted CDP: open a due topic → GradePicker shows 4 buttons with interval sub-labels, key `3` selects Good, log succeeds; PromptsPanel shows suspend button + starter badge; Dashboard shows New-cards chip.
- [ ] **Step 6: Record results in `.superpowers/sdd/progress.md`** (new ledger section "Scheduling Core / FSRS").

---

## Self-review notes (already applied)

- Spec coverage: every spec section maps to a task (schema→3, engine→1, contract→2, write path→5, queue→6/7, starter cards→6/8/9, suspension→6, export/import→9/10, web→11–13, seed/reset/testing→4/14). Metrics redefinitions (mastery/struggle/labels) → Task 7. `User.role→headline` ripples: seed (T4), auth DTO/profile + export WHO I AM (grep in T10 gate), web Settings form (T13 gate via build).
- Type consistency: `Grade` union duplicated deliberately in three layers (engine, types-package, web types) — engine and contract must not depend on each other; values must match `ReviewGrade` enum exactly (`again|hard|good|easy`).
- The API build is intentionally red between Tasks 3 and 10 (same pattern as the SP1 auth rewrite); per-task gates use scoped jest runs until the Task 10 integration gate.
