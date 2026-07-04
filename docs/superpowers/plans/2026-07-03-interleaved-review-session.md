# Interleaved Review Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Review all" session — one endpoint builds an interleaved cross-topic queue of due cards (round-robin by chapter), and the web review modal auto-advances through it with progress, skip, and an end-of-session summary.

**Architecture:** A pure `interleaveQueue()` function (deterministic, unit-tested) orders cards grouped by chapter; `MetricsService.sessionQueue()` assembles due cards + up to 5 new cards from active topics and exposes the queue via `GET /reviews/session-queue`; a new `GET /prompts/:id` serves each card with fresh FSRS previews; the web `ReviewSession` component drives the loop reusing the existing recall/reveal UI (`PromptRecall`, extracted from `ReviewGate`) and `LogReviewForm`.

**Tech Stack:** NestJS 11 + Prisma 7 (jest), React 19 + TanStack react-query (vitest), no schema changes, no new deps.

**Spec:** `docs/superpowers/specs/2026-07-03-interleaved-review-session-design.md`

## Global Constraints

- **NO GIT COMMITS** — repo policy. Work stays uncommitted in the working tree. Where this plan template would normally say "commit", instead just verify and stop; the controller takes tree snapshots between tasks.
- Monorepo is CommonJS for `apps/api` (extensionless imports, no `"type":"module"`); `apps/web` is ESM.
- Lint/format gate for every task: `yarn lint` (oxlint) and `yarn format:check` (oxfmt) must pass from repo root.
- API tests: `yarn workspace @terrain/api test` (jest). Web unit tests: `yarn workspace @terrain/web test` (vitest). Web build check: `yarn workspace @terrain/web build` (tsc --noEmit + vite build).
- New-cards-per-session cap: **5** (constant `NEW_CARDS_PER_SESSION`).
- Chapter key: topic's parent title, falling back to the topic's `domain` (domain is a required column, so no further fallback needed).
- Determinism: no `Math.random()`/randomness anywhere in queue construction.

---

### Task 1: `interleaveQueue` pure module (API)

**Files:**
- Create: `apps/api/src/metrics/interleave.ts`
- Test: `apps/api/src/metrics/interleave.spec.ts`

**Interfaces:**
- Consumes: nothing (pure module, zero imports).
- Produces:
  ```ts
  export interface SessionQueueItem {
    promptId: string;
    topicId: string;
    topicTitle: string;
    chapterTitle: string;
    kind: string;           // promptKind: 'concept' | 'code' | 'problem'
    isNew: boolean;         // state === 'new'
    nextReviewAt: Date | null; // null for new cards
    createdAt: Date;
  }
  export function interleaveQueue(items: SessionQueueItem[]): SessionQueueItem[]
  ```
  Task 2 imports both. The function must be deterministic and length-preserving (same multiset in and out).

**Algorithm (implement exactly):**
1. Bucket items by `chapterTitle`.
2. Sort each bucket: due cards first by `nextReviewAt` asc, then new cards (`nextReviewAt === null` sorts as `+Infinity`), tie-broken by `createdAt` asc then `promptId` (localeCompare) for full determinism.
3. Order the buckets by their first item's sort key (most-overdue chapter first; all-new chapters last), tie-broken by chapter title.
4. Round-robin: emit index 0 of every bucket in bucket order, then index 1, etc., skipping exhausted buckets, until all items are emitted.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/metrics/interleave.spec.ts`:

```ts
import { interleaveQueue, type SessionQueueItem } from './interleave';

function item(overrides: Partial<SessionQueueItem> & { promptId: string }): SessionQueueItem {
  return {
    topicId: 't1',
    topicTitle: 'Topic',
    chapterTitle: 'Chapter A',
    kind: 'concept',
    isNew: false,
    nextReviewAt: new Date('2026-07-01T00:00:00Z'),
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

describe('interleaveQueue', () => {
  it('round-robins across chapters, most-overdue chapter first', () => {
    const items = [
      item({ promptId: 'a1', chapterTitle: 'A', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'a2', chapterTitle: 'A', nextReviewAt: new Date('2026-07-02T00:00:00Z') }),
      item({ promptId: 'b1', chapterTitle: 'B', nextReviewAt: new Date('2026-06-28T00:00:00Z') }),
      item({ promptId: 'b2', chapterTitle: 'B', nextReviewAt: new Date('2026-07-03T00:00:00Z') }),
      item({ promptId: 'c1', chapterTitle: 'C', nextReviewAt: new Date('2026-06-30T00:00:00Z') }),
    ];
    // B holds the most-overdue card (06-28), then C (06-30), then A (07-01).
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual([
      'b1', 'c1', 'a1',
      'b2', 'a2',
    ]);
  });

  it('degenerates to nextReviewAt asc for a single chapter', () => {
    const items = [
      item({ promptId: 'p2', nextReviewAt: new Date('2026-07-02T00:00:00Z') }),
      item({ promptId: 'p1', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'p3', nextReviewAt: new Date('2026-07-03T00:00:00Z') }),
    ];
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('sorts new cards (null nextReviewAt) after due cards within a chapter, by createdAt', () => {
    const items = [
      item({ promptId: 'new2', isNew: true, nextReviewAt: null, createdAt: new Date('2026-06-20T00:00:00Z') }),
      item({ promptId: 'due1', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'new1', isNew: true, nextReviewAt: null, createdAt: new Date('2026-06-10T00:00:00Z') }),
    ];
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['due1', 'new1', 'new2']);
  });

  it('mixes new cards mid-queue via round-robin, not appended at the end', () => {
    const items = [
      item({ promptId: 'a1', chapterTitle: 'A', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'aNew', chapterTitle: 'A', isNew: true, nextReviewAt: null }),
      item({ promptId: 'b1', chapterTitle: 'B', nextReviewAt: new Date('2026-06-30T00:00:00Z') }),
      item({ promptId: 'b2', chapterTitle: 'B', nextReviewAt: new Date('2026-07-01T06:00:00Z') }),
      item({ promptId: 'b3', chapterTitle: 'B', nextReviewAt: new Date('2026-07-01T12:00:00Z') }),
    ];
    const order = interleaveQueue(items).map((i) => i.promptId);
    // Round 0: b1, a1. Round 1: b2, aNew. Round 2: b3.
    expect(order).toEqual(['b1', 'a1', 'b2', 'aNew', 'b3']);
    expect(order[order.length - 1]).not.toBe('aNew');
  });

  it('an all-new chapter sorts after chapters with due cards', () => {
    const items = [
      item({ promptId: 'nNew', chapterTitle: 'N', isNew: true, nextReviewAt: null }),
      item({ promptId: 'a1', chapterTitle: 'A', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
    ];
    expect(interleaveQueue(items).map((i) => i.promptId)).toEqual(['a1', 'nNew']);
  });

  it('is deterministic and length-preserving', () => {
    const items = [
      item({ promptId: 'x', chapterTitle: 'A' }),
      item({ promptId: 'y', chapterTitle: 'B', nextReviewAt: new Date('2026-07-01T00:00:00Z') }),
      item({ promptId: 'z', chapterTitle: 'B', isNew: true, nextReviewAt: null }),
    ];
    const first = interleaveQueue(items);
    const second = interleaveQueue(items);
    expect(second).toEqual(first);
    expect(first).toHaveLength(items.length);
  });

  it('handles an empty input', () => {
    expect(interleaveQueue([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @terrain/api test --testPathPatterns interleave`
Expected: FAIL — `Cannot find module './interleave'`.

(If `--testPathPatterns` is rejected by the installed jest, use `--testPathPattern interleave`.)

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/metrics/interleave.ts`:

```ts
/**
 * Interleaving for the review-session queue (learning-science Stage 3).
 * Pure and deterministic: cards are bucketed by chapter, ordered within each
 * bucket (due by nextReviewAt asc, then new cards), and emitted round-robin
 * across buckets so consecutive cards differ in chapter wherever the due set
 * allows it.
 */

export interface SessionQueueItem {
  promptId: string;
  topicId: string;
  topicTitle: string;
  chapterTitle: string;
  kind: string;
  isNew: boolean;
  nextReviewAt: Date | null;
  createdAt: Date;
}

/** New cards (null nextReviewAt) sort after every due card. */
function dueKey(item: SessionQueueItem): number {
  return item.nextReviewAt ? item.nextReviewAt.getTime() : Number.POSITIVE_INFINITY;
}

export function interleaveQueue(items: SessionQueueItem[]): SessionQueueItem[] {
  const buckets = new Map<string, SessionQueueItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.chapterTitle);
    if (bucket) bucket.push(item);
    else buckets.set(item.chapterTitle, [item]);
  }

  for (const bucket of buckets.values()) {
    bucket.sort(
      (a, b) =>
        dueKey(a) - dueKey(b) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.promptId.localeCompare(b.promptId),
    );
  }

  const ordered = [...buckets.entries()]
    .sort((a, b) => dueKey(a[1][0]) - dueKey(b[1][0]) || a[0].localeCompare(b[0]))
    .map(([, bucket]) => bucket);

  const out: SessionQueueItem[] = [];
  for (let round = 0; out.length < items.length; round++) {
    for (const bucket of ordered) {
      if (round < bucket.length) out.push(bucket[round]);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @terrain/api test --testPathPatterns interleave`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify gate**

Run: `yarn lint && yarn format:check`
Expected: 0 findings, format clean. Do NOT commit (repo policy).

---

### Task 2: `sessionQueue` service method + `GET /reviews/session-queue` + dashboard count

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts` (add `sessionQueue`, extend `dashboard`)
- Modify: `apps/api/src/reviews/reviews.controller.ts` (new route)
- Modify: `apps/api/src/reviews/reviews.module.ts` (import MetricsModule)
- Test: `apps/api/src/metrics/metrics.service.spec.ts` (extend)

**Interfaces:**
- Consumes: `interleaveQueue`, `SessionQueueItem` from `./interleave` (Task 1).
- Produces:
  ```ts
  // MetricsService
  async sessionQueue(userId: string, now: Date, domain?: string): Promise<{ items: SessionQueueItem[] }>
  // dashboard() payload gains: sessionQueueCount: number
  // HTTP: GET /reviews/session-queue?domain=… → { items: SessionQueueItem[] }  (dates serialize to ISO strings)
  ```
  Task 4's web types mirror the serialized item shape. `NEW_CARDS_PER_SESSION = 5`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/metrics/metrics.service.spec.ts` (inside the top-level `describe('MetricsService', …)`, reusing its `service`/`prisma` from `beforeEach`; the existing mock already stubs `prisma.prompt.findMany`):

```ts
  describe('sessionQueue', () => {
    function queuePrompt(overrides: Record<string, unknown> = {}) {
      return {
        id: 'p1',
        promptKind: 'concept',
        state: 'review',
        nextReviewAt: new Date('2026-07-01T00:00:00Z'),
        createdAt: new Date('2026-06-01T00:00:00Z'),
        topic: { id: 't1', title: 'Two Sum', domain: 'DSA', parent: { title: 'Arrays & Hashing' } },
        ...overrides,
      };
    }

    it('queries due cards and capped new cards with the right predicates', async () => {
      prisma.prompt.findMany
        .mockResolvedValueOnce([]) // due
        .mockResolvedValueOnce([]); // new
      const now = new Date('2026-07-03T10:00:00');

      const result = await service.sessionQueue('u1', now);
      expect(result).toEqual({ items: [] });
      expect(prisma.prompt.findMany).toHaveBeenCalledTimes(2);

      // due query: same predicate family as dueCards (suspended:false, lt endOfToday, non-archived topics)
      expect(prisma.prompt.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          suspended: false,
          nextReviewAt: { not: null, lt: expect.any(Date) },
          topic: { userId: 'u1', status: { not: 'archived' } },
        },
        orderBy: { nextReviewAt: 'asc' },
      });

      // new-cards query: active topics only, capped at 5, stable order
      expect(prisma.prompt.findMany.mock.calls[1][0]).toMatchObject({
        where: {
          suspended: false,
          state: 'new',
          topic: { userId: 'u1', status: 'active' },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 5,
      });
    });

    it('maps prompts to queue items with parent title as chapter, domain as fallback', async () => {
      prisma.prompt.findMany
        .mockResolvedValueOnce([
          queuePrompt(),
          queuePrompt({
            id: 'p2',
            nextReviewAt: new Date('2026-07-02T00:00:00Z'),
            topic: { id: 't2', title: 'Orphan topic', domain: 'Systems', parent: null },
          }),
        ])
        .mockResolvedValueOnce([
          queuePrompt({ id: 'p3', state: 'new', nextReviewAt: null }),
        ]);

      const { items } = await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'));
      const byId = new Map(items.map((i) => [i.promptId, i]));

      expect(byId.get('p1')).toMatchObject({
        topicId: 't1',
        topicTitle: 'Two Sum',
        chapterTitle: 'Arrays & Hashing',
        kind: 'concept',
        isNew: false,
      });
      expect(byId.get('p2')!.chapterTitle).toBe('Systems'); // domain fallback
      expect(byId.get('p3')).toMatchObject({ isNew: true, nextReviewAt: null });
      expect(items).toHaveLength(3);
    });

    it('passes the domain filter into both queries', async () => {
      prisma.prompt.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'), 'DSA');
      expect(prisma.prompt.findMany.mock.calls[0][0].where.topic).toMatchObject({ domain: 'DSA' });
      expect(prisma.prompt.findMany.mock.calls[1][0].where.topic).toMatchObject({ domain: 'DSA' });
    });
  });

  it('dashboard includes sessionQueueCount', async () => {
    // beforeEach stubs every findMany to [] — dashboard resolves with an empty queue.
    const dash = await service.dashboard('u1', new Date('2026-07-03T10:00:00'));
    expect(dash.sessionQueueCount).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test --testPathPatterns metrics.service`
Expected: FAIL — `service.sessionQueue is not a function` and `sessionQueueCount` undefined. Pre-existing tests still PASS.

- [ ] **Step 3: Implement `sessionQueue` and extend `dashboard`**

In `apps/api/src/metrics/metrics.service.ts`:

Add the import at the top (after the existing imports):

```ts
import { interleaveQueue, type SessionQueueItem } from './interleave';
```

Add the constant next to `DAY_MS`:

```ts
const NEW_CARDS_PER_SESSION = 5;
```

Add the method after `dueCards` (around line 137):

```ts
  /**
   * Interleaved review-session queue: every due card (same predicate as
   * `dueCards`, kept separate because this query needs topic/parent joins)
   * plus up to NEW_CARDS_PER_SESSION new cards from *active* topics only —
   * starting planned topics stays a deliberate act via Next Up.
   */
  async sessionQueue(
    userId: string,
    now: Date,
    domain?: string,
  ): Promise<{ items: SessionQueueItem[] }> {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    const topicJoin = {
      select: {
        id: true,
        title: true,
        domain: true,
        parent: { select: { title: true } },
      },
    };
    const [due, fresh] = await Promise.all([
      this.prisma.prompt.findMany({
        where: {
          suspended: false,
          nextReviewAt: { not: null, lt: endOfToday },
          topic: { userId, status: { not: 'archived' }, ...(domain ? { domain } : {}) },
        },
        orderBy: { nextReviewAt: 'asc' },
        include: { topic: topicJoin },
      }),
      this.prisma.prompt.findMany({
        where: {
          suspended: false,
          state: 'new',
          topic: { userId, status: 'active', ...(domain ? { domain } : {}) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: NEW_CARDS_PER_SESSION,
        include: { topic: topicJoin },
      }),
    ]);
    const items = [...due, ...fresh].map(
      (p): SessionQueueItem => ({
        promptId: p.id,
        topicId: p.topic.id,
        topicTitle: p.topic.title,
        chapterTitle: p.topic.parent?.title ?? p.topic.domain,
        kind: p.promptKind,
        isNew: p.state === 'new',
        nextReviewAt: p.nextReviewAt,
        createdAt: p.createdAt,
      }),
    );
    return { items: interleaveQueue(items) };
  }
```

Extend `dashboard()` — add `sessionQueue` to the `Promise.all` and the return value:

```ts
  async dashboard(userId: string, now: Date, domain?: string) {
    const [struggleRatio7d, due, grouped, newCards, nextUp, sessionQueue] = await Promise.all([
      this.struggleRatio7d(userId, now),
      this.dueTopics(userId, now, domain),
      this.prisma.topic.groupBy({
        by: ['status'],
        _count: true,
        where: { userId, ...(domain ? { domain } : {}) },
      }),
      this.newCardsCount(userId, domain),
      this.nextUp(userId, domain),
      this.sessionQueue(userId, now, domain),
    ]);
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count ?? 0;
    return {
      generatedAt: now.toISOString(),
      struggleRatio7d,
      due,
      newCards,
      nextUp,
      sessionQueueCount: sessionQueue.items.length,
      counts: {
        total: grouped.reduce((sum, g) => sum + g._count, 0),
        planned: countOf('planned'),
        active: countOf('active'),
        mastered: countOf('mastered'),
        archived: countOf('archived'),
        dueToday: due.dueToday.length,
        overdue: due.overdue.length,
      },
    };
  }
```

- [ ] **Step 4: Wire the endpoint**

Replace `apps/api/src/reviews/reviews.controller.ts` with:

```ts
import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { LogReviewDto } from './dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { MetricsService } from '../metrics/metrics.service';

@Controller('reviews')
export class ReviewsController {
  constructor(
    private service: ReviewsService,
    private metrics: MetricsService,
  ) {}
  @Post() log(@CurrentUser() userId: string, @Body() dto: LogReviewDto) {
    return this.service.logReview(userId, dto);
  }
  @Get() byTopic(@CurrentUser() userId: string, @Query('topicId') topicId?: string) {
    if (!topicId) throw new BadRequestException('topicId query param is required');
    return this.service.findByTopic(userId, topicId);
  }
  @Get('session-queue') sessionQueue(
    @CurrentUser() userId: string,
    @Query('domain') domain?: string,
  ) {
    return this.metrics.sessionQueue(userId, new Date(), domain);
  }
}
```

Replace `apps/api/src/reviews/reviews.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [MetricsModule],
  providers: [ReviewsService],
  controllers: [ReviewsController],
  exports: [ReviewsService],
})
export class ReviewsModule {}
```

(`MetricsModule` already `exports: [MetricsService]`; no circular import — MetricsModule imports only PrismaModule.)

- [ ] **Step 5: Run the full API suite**

Run: `yarn workspace @terrain/api test`
Expected: PASS. If any controller spec for reviews exists and fails on the new constructor arg, provide `{ provide: MetricsService, useValue: { sessionQueue: jest.fn() } }` in that spec's testing module — check `apps/api/src/reviews/reviews.controller.spec.ts` existence first (it may not exist).

- [ ] **Step 6: Verify gate**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format:check`
Expected: build 0 errors, lint 0 findings, format clean. Do NOT commit.

---

### Task 3: `GET /prompts/:id` with FSRS previews

**Files:**
- Modify: `apps/api/src/prompts/prompts.service.ts` (add `getOne`)
- Modify: `apps/api/src/prompts/prompts.controller.ts` (add route on `PromptController`)
- Test: `apps/api/src/prompts/prompts.service.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `NextPrompt` interface, `previewIntervals`/`CardSrState` from `@terrain/sr-engine` (already imported in the file).
- Produces:
  ```ts
  // PromptsService
  async getOne(userId: string, id: string): Promise<NextPrompt>  // throws NotFoundException
  // HTTP: GET /prompts/:id → { prompt: Prompt, previewIntervals: Record<Grade, number> }
  // Exactly the shape GET /topics/:id/prompts/next returns (non-null variant).
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/prompts/prompts.service.spec.ts` (top level; reuse the file's existing `promptRow` helper):

```ts
describe('PromptsService.getOne', () => {
  it('returns the prompt with preview intervals, scoped to the user', async () => {
    const findFirst = jest.fn().mockResolvedValue(promptRow({ id: 'p9' }));
    const prisma: any = { prompt: { findFirst } };
    const service = new PromptsService(prisma);

    const result = await service.getOne('userA', 'p9');

    expect(result.prompt.id).toBe('p9');
    expect(result.previewIntervals).toMatchObject({
      again: expect.any(Number),
      hard: expect.any(Number),
      good: expect.any(Number),
      easy: expect.any(Number),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'p9', topic: { userId: 'userA' } },
    });
  });

  it('404s when the prompt does not exist or belongs to another user', async () => {
    const prisma: any = { prompt: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PromptsService(prisma);
    await expect(service.getOne('userA', 'nope')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test --testPathPatterns prompts.service`
Expected: FAIL — `service.getOne is not a function`. Existing tests PASS.

- [ ] **Step 3: Implement**

In `apps/api/src/prompts/prompts.service.ts`, add after the `next` method:

```ts
  /** One specific card with fresh grade-preview intervals — same payload shape
   *  as `next`, used by the review session which addresses cards by id. */
  async getOne(userId: string, id: string): Promise<NextPrompt> {
    const prompt = await this.prisma.prompt.findFirst({
      where: { id, topic: { userId } },
    });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);

    const state: CardSrState = {
      stability: prompt.stability,
      difficulty: prompt.difficulty,
      reps: prompt.reps,
      lapses: prompt.lapses,
      state: prompt.state,
      lastReviewedAt: prompt.lastReviewedAt,
      nextReviewAt: prompt.nextReviewAt,
    };
    return { prompt, previewIntervals: previewIntervals(state, new Date()) };
  }
```

In `apps/api/src/prompts/prompts.controller.ts`, add `Get` to the existing `@nestjs/common` import (already there) and add to `PromptController` (the `@Controller('prompts')` class), above `setSuspended`:

```ts
  @Get(':id')
  getOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.getOne(userId, id);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test --testPathPatterns prompts.service`
Expected: PASS (2 new tests green).

- [ ] **Step 5: Verify gate**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 4: Web plumbing — types, client, hooks, session reducer

**Files:**
- Modify: `apps/web/src/api/types.ts` (SessionQueueItem/SessionQueue, Dashboard.sessionQueueCount)
- Modify: `apps/web/src/api/client.ts` (getSessionQueue, getPrompt)
- Modify: `apps/web/src/api/hooks.ts` (usePrompt + query key)
- Create: `apps/web/src/screens/Dashboard/session.ts`
- Test: `apps/web/src/screens/Dashboard/session.test.ts`

**Interfaces:**
- Consumes: API shapes from Tasks 2–3 (dates arrive as ISO strings over JSON).
- Produces (Task 5 relies on all of these):
  ```ts
  // types.ts
  export interface SessionQueueItem {
    promptId: string; topicId: string; topicTitle: string; chapterTitle: string;
    kind: PromptKind; isNew: boolean; nextReviewAt: string | null; createdAt: string;
  }
  export interface SessionQueue { items: SessionQueueItem[] }
  // Dashboard gains: sessionQueueCount: number;

  // client.ts
  api.getSessionQueue: () => Promise<SessionQueue>          // GET /reviews/session-queue
  api.getPrompt: (id: string) => Promise<NextPromptPayload>  // GET /prompts/:id

  // hooks.ts
  qk.prompt = (id: string) => ['prompt', id] as const
  usePrompt(id: string | null)  // useQuery, retry: false (so a 404 skips fast)

  // session.ts
  export interface SessionProgress { cursor: number; reviewed: number; newStarted: number }
  export const initialProgress: SessionProgress
  export type SessionAction = { type: 'graded'; isNew: boolean } | { type: 'skip' }
  export function sessionReducer(s: SessionProgress, a: SessionAction): SessionProgress
  ```

- [ ] **Step 1: Write the failing reducer test**

Create `apps/web/src/screens/Dashboard/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initialProgress, sessionReducer } from './session';

describe('sessionReducer', () => {
  it('starts at the first card with zero counters', () => {
    expect(initialProgress).toEqual({ cursor: 0, reviewed: 0, newStarted: 0 });
  });

  it('graded advances the cursor and counts the review', () => {
    const s = sessionReducer(initialProgress, { type: 'graded', isNew: false });
    expect(s).toEqual({ cursor: 1, reviewed: 1, newStarted: 0 });
  });

  it('grading a new card also counts newStarted', () => {
    const s = sessionReducer(initialProgress, { type: 'graded', isNew: true });
    expect(s).toEqual({ cursor: 1, reviewed: 1, newStarted: 1 });
  });

  it('skip advances without counting', () => {
    const s = sessionReducer(initialProgress, { type: 'skip' });
    expect(s).toEqual({ cursor: 1, reviewed: 0, newStarted: 0 });
  });

  it('accumulates across a mixed session', () => {
    let s = initialProgress;
    s = sessionReducer(s, { type: 'graded', isNew: false });
    s = sessionReducer(s, { type: 'skip' });
    s = sessionReducer(s, { type: 'graded', isNew: true });
    expect(s).toEqual({ cursor: 3, reviewed: 2, newStarted: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @terrain/web test`
Expected: FAIL — cannot resolve `./session`. Existing projection tests PASS.

- [ ] **Step 3: Implement the reducer**

Create `apps/web/src/screens/Dashboard/session.ts`:

```ts
/** Pure cursor/counters state for a review session. The queue itself is
 *  fetched once at session start and never mutated; `cursor` walks it.
 *  "Done" is derived by the component as `cursor >= items.length`. */

export interface SessionProgress {
  cursor: number;
  reviewed: number;
  newStarted: number;
}

export const initialProgress: SessionProgress = { cursor: 0, reviewed: 0, newStarted: 0 };

export type SessionAction = { type: 'graded'; isNew: boolean } | { type: 'skip' };

export function sessionReducer(s: SessionProgress, a: SessionAction): SessionProgress {
  switch (a.type) {
    case 'graded':
      return {
        cursor: s.cursor + 1,
        reviewed: s.reviewed + 1,
        newStarted: s.newStarted + (a.isNew ? 1 : 0),
      };
    case 'skip':
      return { ...s, cursor: s.cursor + 1 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @terrain/web test`
Expected: PASS (5 new tests, 13 total).

- [ ] **Step 5: Add API types**

In `apps/web/src/api/types.ts`:

Add to the `Dashboard` interface, after `nextUp: NextUp | null;`:

```ts
  sessionQueueCount: number;
```

Add after the `NextPromptPayload` interface:

```ts
/** GET /reviews/session-queue — interleaved review-session queue (metadata
 *  only; card text + previews come per-card from GET /prompts/:id). */
export interface SessionQueueItem {
  promptId: string;
  topicId: string;
  topicTitle: string;
  chapterTitle: string;
  kind: PromptKind;
  isNew: boolean;
  nextReviewAt: string | null;
  createdAt: string;
}

export interface SessionQueue {
  items: SessionQueueItem[];
}
```

- [ ] **Step 6: Add client methods**

In `apps/web/src/api/client.ts`:

Add `SessionQueue` to the type-import list at the top (alphabetical position, after `Settings`).

Add to the `api` object, in the `// reviews` section after `getNextPrompt`:

```ts
  getSessionQueue: () => req<SessionQueue>('/reviews/session-queue'),
  getPrompt: (id: string) => req<NextPromptPayload>(`/prompts/${id}`),
```

- [ ] **Step 7: Add the hook**

In `apps/web/src/api/hooks.ts`:

Add to `qk` after `nextPrompt`:

```ts
  prompt: (id: string) => ['prompt', id] as const,
```

Add after `useNextPrompt`:

```ts
/** One card by id, for the review session. retry:false so a 404 (card
 *  deleted mid-session) surfaces immediately and the session can skip it. */
export function usePrompt(id: string | null) {
  return useQuery({
    queryKey: qk.prompt(id ?? ''),
    queryFn: () => api.getPrompt(id!),
    enabled: !!id,
    retry: false,
  });
}
```

- [ ] **Step 8: Verify web build + gate**

Run: `yarn workspace @terrain/web build && yarn workspace @terrain/web test && yarn lint && yarn format:check`
Expected: tsc + vite build clean, vitest green, lint/format clean.
Note: `apps/web/src/api/types.ts` `Dashboard` now requires `sessionQueueCount` — the web build stays green because nothing constructs a `Dashboard` literal client-side; it only consumes API responses. Do NOT commit.

---

### Task 5: `ReviewSession` component, Dashboard wiring, deep link, Telegram URL

**Files:**
- Modify: `apps/web/src/components/ReviewGate.tsx` (extract `PromptRecall`)
- Create: `apps/web/src/screens/Dashboard/ReviewSession.tsx`
- Modify: `apps/web/src/screens/Dashboard/index.tsx` (button, modal, deep link)
- Modify: `apps/api/src/telegram/telegram.cron.ts` (digest CTA deep link)
- Test: `apps/api/src/telegram/telegram.cron.spec.ts` (URL assertion — check and update)

**Interfaces:**
- Consumes: `usePrompt`, `api.getSessionQueue`, `SessionQueueItem`, `sessionReducer`/`initialProgress` (Task 4); `GET /prompts/:id` (Task 3); queue endpoint (Task 2); existing `LogReviewForm`, `Modal`, `Loading`, `ErrorBox`.
- Produces:
  ```tsx
  // ReviewGate.tsx additionally exports:
  export function PromptRecall({ prompt, previewIntervals, children }: {
    prompt: Prompt;
    previewIntervals: Record<Grade, number>;
    children: (promptId?: string, previewIntervals?: Record<Grade, number>) => ReactNode;
  })
  // ReviewSession.tsx (default export):
  export default function ReviewSession({ onClose }: { onClose: () => void })
  ```

- [ ] **Step 1: Extract `PromptRecall` from `ReviewGate`**

Replace `apps/web/src/components/ReviewGate.tsx` with:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { useNextPrompt } from '../api/hooks';
import type { Grade, Prompt } from '../api/types';

const tabKeymap = keymap.of([indentWithTab]);

/** The recall-then-reveal step for one card: shows the prompt, a scratch
 *  area, and only renders `children` (the grade form) after Reveal. Used by
 *  ReviewGate (topic-scoped fetch) and ReviewSession (card-scoped fetch). */
export function PromptRecall({
  prompt,
  previewIntervals,
  children,
}: {
  prompt: Prompt;
  previewIntervals: Record<Grade, number>;
  children: (promptId?: string, previewIntervals?: Record<Grade, number>) => ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [scratch, setScratch] = useState('');

  useEffect(() => {
    setRevealed(false);
    setScratch('');
  }, [prompt.id]);

  return (
    <div className="col gap-3">
      <div className="card card-pad col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Recall
        </div>
        <div>{prompt.promptText}</div>
        {!revealed && (
          <>
            {prompt.promptKind === 'code' ? (
              <CodeMirror
                value={scratch}
                onChange={setScratch}
                extensions={[tabKeymap]}
                height="160px"
                placeholder="Write the solution before revealing (not saved)"
              />
            ) : (
              <textarea
                className="textarea"
                style={{ minHeight: 56 }}
                placeholder="Try to answer before revealing (not saved)"
                value={scratch}
                onChange={(e) => setScratch(e.target.value)}
              />
            )}
            <button className="btn btn-primary right" onClick={() => setRevealed(true)}>
              Reveal
            </button>
          </>
        )}
        {revealed && prompt.answerHint && <div className="faint">{prompt.answerHint}</div>}
      </div>
      {revealed && children(prompt.id, previewIntervals)}
    </div>
  );
}

/** Gates review submission behind a recall-then-reveal step when the topic
 *  has a due/new prompt. Falls back to rendering `children` immediately when
 *  the topic has none (evidence-only review), so today's review flow is
 *  unaffected. */
export function ReviewGate({
  topic,
  children,
}: {
  topic: { id: string };
  children: (promptId?: string, previewIntervals?: Record<Grade, number>) => ReactNode;
}) {
  const { data, isLoading } = useNextPrompt(topic.id);

  if (isLoading) return null;
  if (!data) return <>{children()}</>;

  return (
    <PromptRecall prompt={data.prompt} previewIntervals={data.previewIntervals}>
      {children}
    </PromptRecall>
  );
}
```

(`components/index.ts` already does `export * from './ReviewGate'`, so `PromptRecall` is exported automatically.)

- [ ] **Step 2: Verify the refactor is behavior-neutral**

Run: `yarn workspace @terrain/web build`
Expected: clean. The recall reset-on-rotation effect now keys off `prompt.id` inside `PromptRecall` — same behavior as before (it previously keyed off `data?.prompt.id`).

- [ ] **Step 3: Create `ReviewSession`**

Create `apps/web/src/screens/Dashboard/ReviewSession.tsx`:

```tsx
import { useEffect, useReducer, useState } from 'react';
import { api, type ApiError } from '../../api/client';
import { usePrompt } from '../../api/hooks';
import type { SessionQueueItem } from '../../api/types';
import { ErrorBox, Loading, LogReviewForm, PromptRecall } from '../../components';
import { initialProgress, sessionReducer } from './session';

/** Interleaved cross-topic review session. Fetches the queue once on mount
 *  (deliberately NOT a react-query query: each grade invalidates dashboard
 *  queries, and a cached queue refetching mid-session would shift the
 *  cursor under the user). Every grade persists immediately, so closing
 *  mid-session loses nothing. */
export default function ReviewSession({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<SessionQueueItem[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [progress, dispatch] = useReducer(sessionReducer, initialProgress);

  useEffect(() => {
    let alive = true;
    api.getSessionQueue().then(
      (q) => alive && setItems(q.items),
      (e) => alive && setError(e instanceof Error ? e : new Error('Failed to load queue')),
    );
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!items) return <Loading label="Building your session…" />;

  const item = items[progress.cursor];

  if (!item) {
    return (
      <div className="col gap-3" style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ fontSize: 40 }} aria-hidden>
          {items.length === 0 ? '🌤️' : '🎉'}
        </div>
        <div className="card-title" style={{ margin: 0 }}>
          {items.length === 0 ? 'Nothing due — all caught up' : 'Session complete'}
        </div>
        {items.length > 0 && (
          <div className="muted">
            {progress.reviewed} card{progress.reviewed === 1 ? '' : 's'} reviewed
            {progress.newStarted > 0 && ` · ${progress.newStarted} new started`}
          </div>
        )}
        <button className="btn btn-primary" style={{ alignSelf: 'center' }} onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="col gap-3">
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="pill nowrap">
          {progress.cursor + 1} / {items.length}
        </span>
        <span className="faint nowrap" style={{ marginLeft: 8 }}>
          {item.chapterTitle}
        </span>
        {item.isNew && (
          <span className="pill nowrap" style={{ marginLeft: 8 }}>
            new
          </span>
        )}
        <button className="btn btn-ghost btn-sm right" onClick={() => dispatch({ type: 'skip' })}>
          Skip
        </button>
      </div>
      <div className="card-title" style={{ margin: 0 }}>
        {item.topicTitle}
      </div>
      <SessionCard
        key={item.promptId}
        item={item}
        onGraded={() => dispatch({ type: 'graded', isNew: item.isNew })}
        onMissing={() => dispatch({ type: 'skip' })}
      />
    </div>
  );
}

function SessionCard({
  item,
  onGraded,
  onMissing,
}: {
  item: SessionQueueItem;
  onGraded: () => void;
  onMissing: () => void;
}) {
  const promptQ = usePrompt(item.promptId);
  const missing = promptQ.isError && (promptQ.error as ApiError).status === 404;

  // Card deleted since the queue was built — skip it silently.
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  if (promptQ.isLoading || missing) return <Loading label="Loading card…" />;
  if (promptQ.isError) return <ErrorBox error={promptQ.error} />;
  if (!promptQ.data) return null;

  return (
    <PromptRecall prompt={promptQ.data.prompt} previewIntervals={promptQ.data.previewIntervals}>
      {(promptId, previewIntervals) => (
        <LogReviewForm
          topic={{ id: item.topicId, title: item.topicTitle }}
          promptId={promptId}
          previewIntervals={previewIntervals}
          onLogged={onGraded}
        />
      )}
    </PromptRecall>
  );
}
```

Note: `ErrorBox`'s prop signature is in `apps/web/src/components/Feedback.tsx` — it accepts `error` as `unknown`/`Error | string` in current usage (`<ErrorBox error={dashboardQ.error} />`). Check its actual prop type before finishing and match it.

- [ ] **Step 4: Wire the Dashboard**

In `apps/web/src/screens/Dashboard/index.tsx`:

1. Add imports:

```tsx
import { useEffect, useState } from 'react';
import ReviewSession from './ReviewSession';
```

(`useState` is already imported — merge into one line: `import { useEffect, useState } from 'react';`)

2. Add state next to `logTopic`:

```tsx
const [sessionOpen, setSessionOpen] = useState(false);
```

3. Add the deep-link effect right after the state declarations (before the early returns, to respect hooks rules):

```tsx
  // Telegram digest deep link: /?session=1 auto-opens the review session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session') !== '1') return;
    setSessionOpen(true);
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);
```

4. Render the "Review all" button directly above the "Due for review" heading (before the `<h2 className="card-title" …>Due for review</h2>` block):

```tsx
      {dash.sessionQueueCount > 0 && (
        <button
          className="btn btn-primary"
          style={{ marginBottom: 14 }}
          onClick={() => setSessionOpen(true)}
        >
          ▶ Review all ({dash.sessionQueueCount})
        </button>
      )}
```

5. Add the session modal next to the existing log modal (children conditionally mounted so the queue fetch only fires when opened; `Modal` already unmounts on close, the guard is belt-and-braces for a fresh session per open):

```tsx
      <Modal open={sessionOpen} onClose={() => setSessionOpen(false)} title="Review session">
        {sessionOpen && <ReviewSession onClose={() => setSessionOpen(false)} />}
      </Modal>
```

- [ ] **Step 5: Telegram digest deep link**

In `apps/api/src/telegram/telegram.cron.ts`, in `sendDigest` only (leave `maybeSendNudge` unchanged), change the button:

```ts
    await this.telegram.sendTo(s.userId, s.telegramChatId!, html, {
      text: 'Start review',
      url: `${this.webUrl()}/?session=1`,
    });
```

Then check `apps/api/src/telegram/telegram.cron.spec.ts` for an assertion on the digest button URL (search for `Start review` / `webUrl` / `localhost:5180`). If one exists, update its expected URL to `http://localhost:5180/?session=1`. The nudge's URL assertion stays as-is.

- [ ] **Step 6: Run the full test suites**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/web test && yarn workspace @terrain/web build`
Expected: all green; web build (tsc + Rolldown) 0 errors.

- [ ] **Step 7: Verify gate**

Run: `yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 6: Full verification sweep + live CDP smoke

**Files:**
- No new source files. Smoke script goes in the session scratchpad only — never committed.

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: verified feature; evidence in the task report.

- [ ] **Step 1: Full monorepo gate**

Run from repo root:

```bash
yarn build && yarn test && yarn lint && yarn format:check
```

Expected: every workspace builds; all suites pass (API should be 213 + ~7 new = ~220; web vitest 8 + 5 = 13; sr-engine 4; types 10); lint 0 findings; format clean.

- [ ] **Step 2: Stack up**

```bash
docker compose up -d
# kill any stale API on :3000 first — pkill does NOT work for nest:
kill -9 $(lsof -ti:3000) 2>/dev/null
yarn workspace @terrain/api start &   # :3000
yarn workspace @terrain/web dev &     # :5180
```

Wait for the API to log its listening line before smoking. (A leftover zombie on :3000 makes `start` fail silently with EADDRINUSE and serves stale code — per CLAUDE.md.)

- [ ] **Step 3: API-level sanity check**

Log in via `POST /api/auth/login` (same-origin fetch through the :5180 proxy, credentials from the user's `.env`/session — ask the user if not available; the demo seed account `demo@terrain.local` works if the real account's password isn't at hand). Then:

- `GET /api/reviews/session-queue` → 200, `items` non-empty for an account with due cards; verify no two consecutive items share `chapterTitle` where the due set allows it (assert programmatically: count adjacent same-chapter pairs and check it's far below what `nextReviewAt asc` ordering would produce, or simply assert the first N items span ≥2 chapters when ≥2 chapters are due).
- Verify at most 5 items with `isNew: true`, all from active topics.
- `GET /api/prompts/<first item's promptId>` → 200 with `prompt` + 4-key `previewIntervals`.
- `GET /api/metrics/dashboard` → `sessionQueueCount === items.length` (same instant; tiny drift acceptable if a review happens between calls).
- `GET /api/prompts/nonexistent-id` → 404.

- [ ] **Step 4: UI smoke via headless Brave CDP**

Write a scratchpad-only script following `scripts/smoke.mjs` patterns (`--remote-debugging-port` + CDP WebSocket; use `.textContent`, not `.innerText`). Assert:

1. Dashboard shows the "▶ Review all (N)" button with N > 0.
2. Click it → modal titled "Review session" appears; progress pill reads "1 / N"; a chapter label is visible.
3. Recall card shows prompt text; click "Reveal"; grade form appears; select a grade and submit → progress advances to "2 / N" and (when the queue has ≥2 chapters) the chapter label changed between card 1 and card 2.
4. Grade one more card, then click "Skip" once → cursor advances without a review logged (verify via `GET /api/reviews?topicId=` count for the skipped card's topic, or simply that progress advanced and no toast fired).
5. Reload the Dashboard with `/?session=1` → session modal auto-opens; URL param is stripped (`window.location.search` no longer contains `session=1`).
6. 0 console errors throughout.

This logs 2 real reviews on the account used — acceptable (same as prior smokes); note it in the report.

- [ ] **Step 5: Report**

Report results with evidence (assertion counts, sample queue chapter sequence, screenshots if useful). Leave the dev stack running. Do NOT commit.

---

## Self-Review (completed)

- **Spec coverage:** queue endpoint + interleave (Tasks 1–2), `sessionQueueCount` on dashboard (Task 2), `GET /prompts/:id` (Task 3), web types/client/hooks/reducer (Task 4), ReviewSession + button + deep link + Telegram URL (Task 5), edge cases (404-skip in Task 5's SessionCard, empty-queue end screen, stale-item grading is inherently allowed by `POST /reviews`), testing plan incl. CDP smoke (Task 6). Evidence-only topics: intentionally untouched (Dashboard due list unchanged). ✅
- **Placeholder scan:** no TBDs; every code step shows the code. Two deliberate "check first" instructions remain (reviews.controller.spec existence, telegram.cron.spec URL assertion, ErrorBox prop type) — these are verification instructions against existing files, not placeholders. ✅
- **Type consistency:** `SessionQueueItem` field names identical across interleave.ts (Date) and web types.ts (ISO string) — the Date→string shift at the JSON boundary is called out in both tasks. `usePrompt`/`qk.prompt`, `sessionReducer`/`initialProgress`, `PromptRecall` signature match between defining and consuming tasks. `NEW_CARDS_PER_SESSION = 5` consistent with the take:5 test assertion. ✅
