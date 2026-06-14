# Prompt Graduation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically retire a `Prompt` from review rotation after 3 consecutive quality ≥ 4 reviews, with a manual un-graduate override, so the queue stops testing prompts you've clearly mastered.

**Architecture:** Two new `Prompt` columns (`graduated`, `consecutiveGood`) computed inside the existing `buildReviewWrites()` (shared by `ReviewsService` and `ImportService`), read by `PromptsService.next()` to exclude graduated prompts from rotation, with a new `PATCH /prompts/:id` endpoint for the manual override and a `PromptsPanel` web component to see/toggle it.

**Tech Stack:** Prisma 7 (Postgres, driver adapter), NestJS 11, class-validator, React 19, `@tanstack/react-query`.

## Global Constraints

- `GOOD_QUALITY = 4`, `GRADUATION_STREAK = 3` (spec: Graduation rule) — exact values, not configurable in this stage.
- Graduation is sticky through the normal review flow: `prompt.graduated || consecutiveGood >= GRADUATION_STREAK` — a later low-quality review must NOT silently un-graduate a prompt (spec: Graduation rule).
- A manual toggle (either direction) via `PATCH /prompts/:id` always resets `consecutiveGood` to `0` in the same write (spec: Manual un-graduate).
- `Prompt` has no `userId` column — ownership must be checked via the `topic: { userId }` relation filter, the same pattern `Prerequisite` already uses (spec: Manual un-graduate; this repo's established multi-user isolation convention).
- Per the user's standing "still initial setup" preference: edit `schema.prisma` and the single consolidated `apps/api/prisma/migrations/20260701113254_init/migration.sql` directly — do NOT create a new migration file. The user re-applies it themselves via `prisma migrate reset` when told to.
- Repo convention: no git commits or `git add` unless the user explicitly asks (`CLAUDE.md`) — treat plan-template "commit" steps as "leave the diff for review."
- Out of scope: any change to `Topic.status = 'mastered'` / `MetricsService.masteryStatus()`; the SM-2 algorithm itself.

---

### Task 1: `Prompt.graduated` / `Prompt.consecutiveGood` schema fields

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`model Prompt`)
- Modify: `apps/api/prisma/migrations/20260701113254_init/migration.sql` (the `CREATE TABLE "Prompt"` block)

**Interfaces:**
- Produces: `Prompt.graduated: boolean` (default `false`), `Prompt.consecutiveGood: number` (default `0`) — every later task reads/writes these two column names exactly.

- [ ] **Step 1: Add the fields to the schema**

In `apps/api/prisma/schema.prisma`, find `model Prompt` (it currently has `promptKind`, `easeFactor`, `interval`, `repetitions`, `nextReviewAt`, `reviews`, `createdAt`). Add the two new fields after `promptKind`:

```prisma
model Prompt {
  id              String    @id @default(uuid())
  topicId         String
  topic           Topic     @relation(fields: [topicId], references: [id])
  promptText      String
  answerHint      String?
  promptKind      String    @default("concept") // "concept" | "code"
  graduated       Boolean   @default(false)
  consecutiveGood Int       @default(0)
  easeFactor      Float     @default(2.5)
  interval        Int       @default(0)
  repetitions     Int       @default(0)
  nextReviewAt    DateTime?
  reviews         Review[]
  createdAt       DateTime  @default(now())

  @@index([topicId])
}
```

- [ ] **Step 2: Update the consolidated init migration**

In `apps/api/prisma/migrations/20260701113254_init/migration.sql`, find the `CREATE TABLE "Prompt" (...)` block. Add the two new columns after `"promptKind"`:

```sql
-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "answerHint" TEXT,
    "promptKind" TEXT NOT NULL DEFAULT 'concept',
    "graduated" BOOLEAN NOT NULL DEFAULT false,
    "consecutiveGood" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);
```

- [ ] **Step 3: Validate the schema**

Run: `yarn workspace @terrain/api exec prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

Run: `yarn workspace @terrain/api exec prisma generate`
Expected: exits 0 (regenerates `@prisma/client` types to include `graduated`/`consecutiveGood`; this does not touch the live database).

- [ ] **Step 4: Stage the diff for review**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git status
```

Do NOT run any `prisma migrate` command against the live database in this task — later tasks' tests use mocked Prisma clients and don't need it. The live database is updated once, at the start of Task 6.

---

### Task 2: Graduation rule in `buildReviewWrites()`

**Files:**
- Modify: `apps/api/src/reviews/sr-apply.ts`
- Test: `apps/api/src/reviews/sr-apply.spec.ts`

**Interfaces:**
- Consumes: `Prompt.graduated: boolean`, `Prompt.consecutiveGood: number` (Task 1).
- Produces: `buildReviewWrites()`'s returned `prompt` write (`Prisma.PromptUpdateInput`) now includes `consecutiveGood` and `graduated` alongside the existing SM-2 fields — Task 3's `PromptsService.next()` reads the persisted `graduated` column this write produces.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/reviews/sr-apply.spec.ts`, inside the existing `describe('buildReviewWrites', ...)` block (after the last `it(...)`):

```typescript
  it('increments consecutiveGood on a quality >= 4 prompt review', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: false,
      consecutiveGood: 1,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      4,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(2);
    expect(promptWrite!.graduated).toBe(false);
  });

  it('resets consecutiveGood to 0 on a quality < 4 prompt review', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: false,
      consecutiveGood: 2,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      3,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(0);
    expect(promptWrite!.graduated).toBe(false);
  });

  it('graduates a prompt once consecutiveGood reaches 3', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: false,
      consecutiveGood: 2,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      5,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(3);
    expect(promptWrite!.graduated).toBe(true);
  });

  it('keeps an already-graduated prompt graduated even after a later low-quality review', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: true,
      consecutiveGood: 3,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      1,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(0);
    expect(promptWrite!.graduated).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test sr-apply.spec`
Expected: FAIL — `promptWrite!.consecutiveGood` is `undefined` (the property doesn't exist on the returned object yet).

- [ ] **Step 3: Implement the graduation rule**

In `apps/api/src/reviews/sr-apply.ts`, add two constants near the top (after the imports):

```typescript
const GOOD_QUALITY = 4;
const GRADUATION_STREAK = 3;
```

Replace the `if (prompt) { ... }` block:

```typescript
  let promptWrite: Prisma.PromptUpdateInput | undefined;
  if (prompt) {
    const promptBefore: SRState = {
      easeFactor: prompt.easeFactor,
      interval: prompt.interval,
      repetitions: prompt.repetitions,
      nextReviewAt: prompt.nextReviewAt,
    };
    const promptAfter = sm2(quality, promptBefore, now);
    const consecutiveGood = quality >= GOOD_QUALITY ? prompt.consecutiveGood + 1 : 0;
    const graduated = prompt.graduated || consecutiveGood >= GRADUATION_STREAK;
    promptWrite = {
      easeFactor: promptAfter.easeFactor,
      interval: promptAfter.interval,
      repetitions: promptAfter.repetitions,
      nextReviewAt: promptAfter.nextReviewAt,
      consecutiveGood,
      graduated,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test sr-apply.spec`
Expected: PASS (all 9 cases — 5 existing + 4 new).

- [ ] **Step 5: Stage the diff for review**

```bash
git add apps/api/src/reviews/sr-apply.ts apps/api/src/reviews/sr-apply.spec.ts
git status
```

---

### Task 3: Exclude graduated prompts from rotation + manual un-graduate endpoint

**Files:**
- Modify: `apps/api/src/prompts/prompts.service.ts`
- Modify: `apps/api/src/prompts/prompts.controller.ts`
- Create: `apps/api/src/prompts/dto.ts`
- Modify: `apps/api/src/prompts/prompts.module.ts`
- Test: `apps/api/src/prompts/prompts.service.spec.ts`

**Interfaces:**
- Consumes: `Prompt.graduated` (Task 1); `buildReviewWrites()`'s `graduated`/`consecutiveGood` writes (Task 2, via `ReviewsService`/`ImportService` — unchanged in this task).
- Produces: `PromptsService.setGraduated(userId: string, id: string, graduated: boolean): Promise<Prompt>` — Task 5's web hook calls the `PATCH /prompts/:id` endpoint this method backs.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/prompts/prompts.service.spec.ts`, after the existing `describe('PromptsService.next', ...)` block closes:

```typescript
describe('PromptsService.setGraduated', () => {
  it('sets graduated and resets consecutiveGood to 0', async () => {
    const prisma: any = {
      prompt: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p1', topicId: 't1', topic: { userId: 'userA' } }),
        update: jest.fn().mockResolvedValue({ id: 'p1', graduated: false, consecutiveGood: 0 }),
      },
    };
    const service = new PromptsService(prisma);
    await service.setGraduated('userA', 'p1', false);
    expect(prisma.prompt.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', topic: { userId: 'userA' } },
    });
    expect(prisma.prompt.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { graduated: false, consecutiveGood: 0 },
    });
  });

  it('404s when the prompt does not belong to the user', async () => {
    const prisma: any = { prompt: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PromptsService(prisma);
    await expect(service.setGraduated('userA', 'not-mine', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

Also update the two existing `next()` tests that assert on `prisma.prompt.findMany` calls — add the `graduated: false` filter to the fixture's own `where` expectation is not needed (they only mock the resolved value, not assert the call args), but add one new case to that `describe` block confirming the filter is actually applied:

```typescript
  it('excludes graduated prompts from candidate selection', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PromptsService(prisma);
    await service.next('userA', 't1');
    expect(prisma.prompt.findMany).toHaveBeenCalledWith({
      where: { topicId: 't1', graduated: false },
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test prompts.service.spec`
Expected: FAIL — `setGraduated` doesn't exist on `PromptsService`; the `findMany` call-args assertion fails because `next()` doesn't yet filter by `graduated`.

- [ ] **Step 3: Implement `setGraduated` and the rotation filter**

Replace `apps/api/src/prompts/prompts.service.ts` in full:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prompt } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromptsService {
  constructor(private prisma: PrismaService) {}

  async next(userId: string, topicId: string): Promise<Prompt | null> {
    const topic = await this.prisma.topic.findFirst({ where: { id: topicId, userId } });
    if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

    const prompts = await this.prisma.prompt.findMany({ where: { topicId, graduated: false } });
    if (prompts.length === 0) return null;

    const dueTime = (p: Prompt) => (p.nextReviewAt ? p.nextReviewAt.getTime() : -Infinity);
    return prompts.reduce((most, p) => (dueTime(p) < dueTime(most) ? p : most));
  }

  async setGraduated(userId: string, id: string, graduated: boolean): Promise<Prompt> {
    const prompt = await this.prisma.prompt.findFirst({ where: { id, topic: { userId } } });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);
    return this.prisma.prompt.update({ where: { id }, data: { graduated, consecutiveGood: 0 } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test prompts.service.spec`
Expected: PASS (all cases — 4 existing + 3 new).

- [ ] **Step 5: Add the DTO**

Create `apps/api/src/prompts/dto.ts`:

```typescript
import { IsBoolean } from 'class-validator';

export class SetGraduatedDto {
  @IsBoolean() graduated!: boolean;
}
```

- [ ] **Step 6: Add the controller route**

Replace `apps/api/src/prompts/prompts.controller.ts` in full:

```typescript
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SetGraduatedDto } from './dto';

@Controller('topics')
export class PromptsController {
  constructor(private service: PromptsService) {}

  @Get(':id/prompts/next')
  next(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.next(userId, id);
  }
}

@Controller('prompts')
export class PromptGraduationController {
  constructor(private service: PromptsService) {}

  @Patch(':id')
  setGraduated(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetGraduatedDto,
  ) {
    return this.service.setGraduated(userId, id, dto.graduated);
  }
}
```

- [ ] **Step 7: Register the new controller**

In `apps/api/src/prompts/prompts.module.ts`, add `PromptGraduationController` to the `controllers` array:

```typescript
import { Module } from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { PromptsController, PromptGraduationController } from './prompts.controller';

@Module({
  providers: [PromptsService],
  controllers: [PromptsController, PromptGraduationController],
  exports: [PromptsService],
})
export class PromptsModule {}
```

- [ ] **Step 8: Build and run the full suite**

Run: `yarn workspace @terrain/api build`
Expected: exit 0.

Run: `yarn workspace @terrain/api test`
Expected: full suite green, no regressions.

- [ ] **Step 9: Stage the diff for review**

```bash
git add apps/api/src/prompts
git status
```

---

### Task 4: Embed `prompts` in `TopicsService.getDetail()`

**Files:**
- Modify: `apps/api/src/topics/topics.service.ts`
- Test: `apps/api/src/topics/topics.service.spec.ts`

**Interfaces:**
- Consumes: `Prompt` rows via Prisma's `topic.prompts` relation (Task 1's schema — `Prompt.topicId` relation already existed pre-Task-1, only the two new columns are new).
- Produces: `getDetail()`'s returned object gains a `prompts: Prompt[]` key — Task 5's web `TopicDetail` type and `PromptsPanel` consume this exact key name.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/topics/topics.service.spec.ts`, right after the existing `'getDetail maps prerequisites/dependents/parent/children/mastery'` test:

```typescript
  it('getDetail includes the topic\'s prompts', async () => {
    prisma.topic.findFirst.mockResolvedValue({
      id: 't1',
      title: 'T1',
      status: 'active',
      repetitions: 2,
      interval: 30,
      noteRef: 'ref',
      summary: null,
      parent: null,
      children: [],
      prerequisites: [],
      dependents: [],
      reviews: [],
      appEvents: [],
      prompts: [
        { id: 'pr1', promptText: 'Q1', graduated: false, consecutiveGood: 1 },
        { id: 'pr2', promptText: 'Q2', graduated: true, consecutiveGood: 0 },
      ],
    });
    const result = await service.getDetail('userA', 't1');
    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[1]).toMatchObject({ id: 'pr2', graduated: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @terrain/api test topics.service.spec`
Expected: FAIL — `result.prompts` is `undefined`.

- [ ] **Step 3: Add `prompts` to the include and the returned object**

In `apps/api/src/topics/topics.service.ts`, in `getDetail()`, update the `include` block:

```typescript
      include: {
        parent: { select: { id: true, title: true, status: true } },
        children: { select: { id: true, title: true, status: true } },
        prerequisites: {
          include: { prerequisite: { select: { id: true, title: true, status: true } } },
        },
        dependents: { include: { topic: { select: { id: true, title: true, status: true } } } },
        reviews: { orderBy: { reviewedAt: 'desc' } },
        appEvents: { orderBy: { appliedAt: 'desc' } },
        prompts: { orderBy: { createdAt: 'asc' } },
      },
```

Update the destructure and return:

```typescript
    const { parent, children, prerequisites, dependents, reviews, appEvents, prompts, ...scalars } =
      topic;
    const prerequisiteTopics = prerequisites.map((p) => p.prerequisite);
    return {
      ...scalars,
      prerequisiteIds: prerequisiteTopics.map((p) => p.id),
      prerequisites: prerequisiteTopics,
      dependents: dependents.map((d) => d.topic),
      parent: parent ?? null,
      children,
      reviews,
      appEvents,
      appEventCount: appEvents.length,
      prompts,
      labels: this.metrics.topicLabels({
        status: scalars.status,
        repetitions: scalars.repetitions,
        prerequisiteStatuses: prerequisiteTopics.map((p) => p.status),
      }),
      mastery: this.metrics.masteryStatus({
        interval: scalars.interval,
        appEventCount: appEvents.length,
        noteRef: scalars.noteRef,
        summary: scalars.summary,
      }),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test topics.service.spec`
Expected: PASS (all cases, including the existing `getDetail` tests — they don't assert on `prompts` so an `undefined` value there was harmless before and a defined array is harmless now).

Run: `yarn workspace @terrain/api build`
Expected: exit 0.

- [ ] **Step 5: Stage the diff for review**

```bash
git add apps/api/src/topics/topics.service.ts apps/api/src/topics/topics.service.spec.ts
git status
```

---

### Task 5: Web `PromptsPanel` + graduation mutation

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/hooks.ts`
- Create: `apps/web/src/components/PromptsPanel.tsx`
- Modify: `apps/web/src/components/TopicDetailPanel.tsx`
- Modify: `apps/web/src/components/index.ts` (barrel export, if `AppEventsPanel` is exported there — check the file; add `PromptsPanel` alongside it using the same pattern)

**Interfaces:**
- Consumes: `GET /topics/:id` response's `prompts: Prompt[]` field (Task 4); `PATCH /prompts/:id` (Task 3).
- Produces: nothing consumed by later tasks — this is the terminal UI change for this plan.

- [ ] **Step 1: Add `graduated`/`consecutiveGood` to the web `Prompt` type, and `prompts` to `TopicDetail`**

In `apps/web/src/api/types.ts`, update the `Prompt` interface:

```typescript
export interface Prompt {
  id: string;
  topicId: string;
  promptText: string;
  answerHint: string | null;
  promptKind: string;
  graduated: boolean;
  consecutiveGood: number;
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: string | null;
  createdAt: string;
}
```

Update `TopicDetail` to add `prompts`:

```typescript
export interface TopicDetail extends TopicWithMeta {
  prerequisites: TopicRef[];
  dependents: TopicRef[];
  parent: TopicRef | null;
  children: TopicRef[];
  reviews: Review[];
  appEvents: AppEvent[];
  appEventCount: number;
  prompts: Prompt[];
  mastery: Mastery;
}
```

- [ ] **Step 2: Add the client call**

In `apps/web/src/api/client.ts`, add near `getNextPrompt`:

```typescript
  setPromptGraduated: (id: string, graduated: boolean) =>
    req<Prompt>(`/prompts/${id}`, { method: 'PATCH', ...json({ graduated }) }),
```

(`json` is this file's existing helper that sets the JSON body/headers — used identically by `updateTopic`/`addAppEvent` above it.)

- [ ] **Step 3: Add the mutation hook**

In `apps/web/src/api/hooks.ts`, add after `useAddAppEvent`:

```typescript
export function usePromptGraduation(topicId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, graduated }: { id: string; graduated: boolean }) =>
      api.setPromptGraduated(id, graduated),
    onSuccess: () => invalidate(topicId),
  });
}
```

- [ ] **Step 4: Create `PromptsPanel`**

Create `apps/web/src/components/PromptsPanel.tsx`:

```tsx
import type { Prompt } from '../api/types';
import { usePromptGraduation } from '../api/hooks';
import { useToast } from './Toast';

const GRADUATION_STREAK = 3;

/**
 * A topic's prompts (the recall questions used by ReviewGate): each shows its
 * progress toward automatic graduation, or a graduated badge with a manual
 * un-graduate toggle once retired from rotation.
 */
export function PromptsPanel({ topicId, prompts }: { topicId: string; prompts: Prompt[] }) {
  const setGraduated = usePromptGraduation(topicId);
  const { toast } = useToast();

  const toggle = (id: string, graduated: boolean) => {
    setGraduated.mutate(
      { id, graduated },
      {
        onSuccess: () => toast(graduated ? 'Prompt graduated' : 'Prompt un-graduated', 'success'),
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not update prompt', 'error'),
      },
    );
  };

  return (
    <div className="card card-pad col gap-3">
      <div className="card-title" style={{ margin: 0 }}>
        Prompts ({prompts.length})
      </div>

      {prompts.length === 0 ? (
        <span className="faint">No prompts yet for this topic.</span>
      ) : (
        <div className="col gap-2">
          {prompts.map((p) => (
            <div key={p.id} className="row gap-2" style={{ alignItems: 'center' }}>
              <span className="grow">{p.promptText}</span>
              {p.graduated ? (
                <>
                  <span className="pill nowrap">🎓 Graduated</span>
                  <button
                    className="btn btn-sm"
                    disabled={setGraduated.isPending}
                    onClick={() => toggle(p.id, false)}
                  >
                    Un-graduate
                  </button>
                </>
              ) : (
                <span className="faint nowrap" style={{ fontSize: 12 }}>
                  {p.consecutiveGood}/{GRADUATION_STREAK}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount `PromptsPanel` in `TopicDetailPanel`**

In `apps/web/src/components/TopicDetailPanel.tsx`, add the import alongside the existing component imports:

```typescript
import { PromptsPanel } from './PromptsPanel';
```

Add the mount right after the existing `<AppEventsPanel topicId={t.id} events={t.appEvents} />` line:

```tsx
      {/* application events */}
      <AppEventsPanel topicId={t.id} events={t.appEvents} />

      {/* prompts */}
      <PromptsPanel topicId={t.id} prompts={t.prompts} />
```

- [ ] **Step 6: Export from the barrel**

In `apps/web/src/components/index.ts`, add a line after `export * from './AppEventsPanel';`:

```typescript
export * from './PromptsPanel';
```

- [ ] **Step 7: Build**

Run: `yarn workspace @terrain/web build`
Expected: exit 0 (`tsc --noEmit` then `vite build`).

- [ ] **Step 8: Stage the diff for review**

```bash
git add apps/web/src/api/types.ts apps/web/src/api/client.ts apps/web/src/api/hooks.ts apps/web/src/components/PromptsPanel.tsx apps/web/src/components/TopicDetailPanel.tsx apps/web/src/components/index.ts
git status
```

---

### Task 6: End-to-end verification

**Files:** none (verification only).

**Interfaces:** none — this task exercises Tasks 1-5 together.

- [ ] **Step 1: Full monorepo gate**

Run: `yarn build && yarn test`
Expected: every workspace builds and tests pass (`@terrain/sr-engine` 7, `@terrain/types` 8, `@terrain/api` full suite with the new sr-apply/prompts.service/topics.service cases, `@terrain/web` typecheck+vite build 0).

Run: `yarn lint && yarn format:check`
Expected: both clean.

- [ ] **Step 2: Ask the user to apply the schema to the live database**

Before any live smoke, tell the user the schema/migration changes from Task 1 are ready and ask them to run the dev-DB reset themselves (same reason as the prior write-from-scratch stage: `prisma migrate reset` is hook-blocked for the agent). Wait for their confirmation before proceeding to Step 3.

- [ ] **Step 3: Live import + graduation smoke**

With the stack up (`docker compose up -d`, API on :3000, web on :5180 per `docs/ops/local-dev.md`), log in as the seeded demo user and import a fresh `'code'` or `'concept'` prompt against an existing topic (e.g. via `POST /sessions/import/preview` then `/sessions/import`, reusing the pattern from the write-from-scratch stage's own Task 5 smoke).

Log 3 reviews against that prompt via `POST /reviews` with `promptId` set, each with `quality: 5`.
Expected: after the 3rd, `GET /topics/:id/prompts/next` no longer returns that prompt (either returns a different prompt on the same topic, or `null` if it was the only one).

Call `PATCH /prompts/:id` with `{ "graduated": false }` on that prompt's id.
Expected: 200, and `GET /topics/:id/prompts/next` returns it again with `consecutiveGood: 0`.

- [ ] **Step 4: Live UI smoke**

Open the web app, navigate to the topic used above.
Expected: `PromptsPanel` shows the prompt with a "🎓 Graduated" badge and an "Un-graduate" button before Step 3's un-graduate call, and a `0/3` (or current count) progress readout after.

- [ ] **Step 5: Record the outcome**

Append a completion entry to `.superpowers/sdd/progress.md` under a new `# Prompt Graduation — SDD Progress Ledger` heading, following the existing entries' format/style (test counts, smoke results, a closing `=== ... COMPLETE ===` line).
