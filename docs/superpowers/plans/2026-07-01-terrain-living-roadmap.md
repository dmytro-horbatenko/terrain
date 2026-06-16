# Terrain — Phase 3: Living Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only Phase-2 roadmap into a living, directly-editable knowledge graph — curate imported Claude suggestions in place (Keep / Set aside / Restore / Delete), drag-to-reparent and drag-to-link prerequisites with server-side cycle protection, fully edit nodes from the drawer, and enrich the context export with parked ideas, per-node AI context, and recent-session history.

**Architecture:** The graph stays a pure projection over `Topic` + `Prerequisite` (positions are never persisted; dagre re-lays-out every render). Curation reuses two existing columns (`Topic.aiProposed`, `Topic.status`) — **no migration**. The backend adds cycle-guarded reparent, two prerequisite endpoints, and a history-gated delete on the existing `apps/api/src/topics` module; the web layer adds mutation plumbing and wires React Flow drag/connect/delete gestures to those endpoints with optimistic toasts; the export generator gains three omit-when-empty sections.

**Tech Stack:** NestJS 11 + Prisma 7 (driver adapter, Postgres) for the API; React 19 + Vite 8 + TanStack Router + react-query + `@xyflow/react@12.11` for the web; jest (api) + vitest (packages) for tests; oxlint + oxfmt for lint/format.

## Global Constraints

Every task implicitly includes these:

- Monorepo: Yarn 4 workspaces, Node 24. `apps/api` + `packages/*` are CommonJS (no `"type":"module"`, extensionless imports). `apps/web` is ESM.
- TypeScript 6 everywhere. oxlint + oxfmt (single quotes + trailing commas) — no eslint/prettier.
- API: NestJS 11 + Prisma 7 (driver adapter over `DATABASE_URL`; NO url in `schema.prisma`). Postgres in Docker on host port 5433. `import 'dotenv/config'` stays first import in `main.ts`/`seed.ts`.
- Tests: `apps/api` uses jest (`yarn workspace @terrain/api test`); packages use vitest. Web build check: `yarn workspace @terrain/web build` (tsc --noEmit + vite build) — a passing vite build is the real gate, not just dev.
- NO DATABASE MIGRATION in this plan: curation reuses the existing `Topic.aiProposed` + `Topic.status` fields. Do not touch `schema.prisma` or add a migration.
- NO GIT COMMITS (standing preference). Replace the usual "Step: Commit" with a "Step: Checkpoint" that runs the task's tests + relevant build and states the expected passing output. Note "no commit — uncommitted per standing preference".
- Kill the dev API with `kill -9 $(lsof -ti:3000)` (NOT `pkill -f "nest start"`). Web dev on port 5180, API on 3000. UI smoke via headless Brave/CDP (`scripts/smoke.mjs`), use `.textContent` not `.innerText`.

**State semantics (no migration — the curation lifecycle rides two existing columns):**

| State | `aiProposed` | `status` | Where it shows |
|---|---|---|---|
| Tentative (imported, awaiting curation) | `true` | `planned` (any non-archived) | Active graph, dashed + ✦ |
| Committed (kept, ordinary node) | `false` | any | Active graph |
| Parked (set aside, retained) | `true` | `archived` | Parked shelf only (toggle) |
| Deleted | — | (row gone) | nowhere |

Curation mapping (reuse `updateTopic`, no new endpoints for these):
- **Keep** = `updateTopic(id, { aiProposed: false })`
- **Set aside (park)** = `updateTopic(id, { status: 'archived' })`
- **Restore** = `updateTopic(id, { status: 'planned' })`
- **Delete permanently** = `deleteTopic(id)`

---

## Wave A — Backend (topics module + delete rule)

Ships independently: `yarn workspace @terrain/api test` green + `nest build` 0. All changes live in `apps/api/src/topics`. Throw `422` with `UnprocessableEntityException` from `@nestjs/common` (already used in `apps/api/src/import/import.service.ts`).

### Task 1: Curation field — `aiProposed` on `UpdateTopicDto`

**Files:**
- Modify `apps/api/src/topics/dto.ts` (import list line 1; `UpdateTopicDto` body ~lines 22-33).
- Modify `apps/api/src/topics/topics.service.spec.ts` (append a test).

**Interfaces:**
- Produces: `UpdateTopicDto` gains `@IsOptional() @IsBoolean() aiProposed?: boolean`. `TopicsService.update(id, dto)` continues to forward the field via its existing `...rest` spread (Keep/Park/Restore all ride `PATCH /topics/:id`).
- Covers all three curation transitions at the jest service level (spec §6: "Keep/park/restore: field transitions via `PATCH` produce the expected `aiProposed`/`status`"): Keep (`{ aiProposed: false }`), Set-aside/park (`{ status: 'archived' }`), Restore (`{ status: 'planned' }`).

- [ ] **Step 1: Write the failing tests.** Append to `apps/api/src/topics/topics.service.spec.ts` (before the final closing `});`) — three curation-transition cases:

```ts
it('update forwards aiProposed (keep) through to prisma.topic.update', async () => {
  prisma.topic.findUnique.mockResolvedValue({ id: 't1', parentId: null });
  prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1', aiProposed: false });
  await service.update('t1', { aiProposed: false });
  expect(prisma.topic.update).toHaveBeenCalledWith({
    where: { id: 't1' },
    data: { aiProposed: false },
  });
});

it('update forwards status archived (set aside / park) through to prisma.topic.update', async () => {
  prisma.topic.findUnique.mockResolvedValue({ id: 't1', parentId: null });
  prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1', status: 'archived' });
  await service.update('t1', { status: 'archived' });
  expect(prisma.topic.update).toHaveBeenCalledWith({
    where: { id: 't1' },
    data: { status: 'archived' },
  });
});

it('update forwards status planned (restore) through to prisma.topic.update', async () => {
  prisma.topic.findUnique.mockResolvedValue({ id: 't1', parentId: null });
  prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1', status: 'planned' });
  await service.update('t1', { status: 'planned' });
  expect(prisma.topic.update).toHaveBeenCalledWith({
    where: { id: 't1' },
    data: { status: 'planned' },
  });
});
```

The keep case is red at the **type** level first: `UpdateTopicDto` has no `aiProposed`, so `service.update('t1', { aiProposed: false })` fails ts-jest compilation. The park/restore cases ride the already-valid `status` field — they lock in the transition contract as regression coverage (they pass once the file compiles).

- [ ] **Step 2: Run to fail.** `yarn workspace @terrain/api test topics.service` → expect a TS compile error on the `{ aiProposed: false }` argument (property does not exist on `UpdateTopicDto`).

- [ ] **Step 3: Minimal impl.** In `apps/api/src/topics/dto.ts`, add `IsBoolean` to the import and the field to `UpdateTopicDto`:

```ts
import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
```

```ts
export class UpdateTopicDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsString() topicType?: string;
  @IsOptional() @IsIn(TOPIC_STATUSES) status?: TopicStatus;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() noteRef?: string;
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsInt() interval?: number;
  @IsOptional() @IsString() nextReviewAt?: string;
  @IsOptional() @IsBoolean() aiProposed?: boolean;
}
```

No service change needed: `update()` already spreads `...rest` into `data`, so `aiProposed` flows through. `@IsOptional()` in class-validator skips validation when the value is `null` **or** `undefined` — this is also what lets a later `PATCH { parentId: null }` (un-parent) pass the existing `@IsString() parentId?`.

- [ ] **Step 4: Run to pass.** `yarn workspace @terrain/api test topics.service` → the three new tests pass; the 4 existing `TopicsService` tests stay green.

- [ ] **Step 5: Checkpoint.** `yarn workspace @terrain/api test topics.service` (7 tests green in this file) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

---

### Task 2: Cycle-safe reparent guard

**Files:**
- Modify `apps/api/src/topics/topics.service.ts` (import line 1; `update()` ~lines 110-118; add a private `assertNoParentCycle`).
- Modify `apps/api/src/topics/topics.service.spec.ts` (add tests + import `UnprocessableEntityException`).

**Interfaces:**
- Produces: `private async assertNoParentCycle(id: string, parentId: string): Promise<void>` — 422 on self-parent or ancestor-cycle; 404 if the immediate parent id does not exist; visited-set bounded against pre-existing bad-data cycles.
- Changed: `update(id, dto)` calls `assertNoParentCycle` **only when** `dto.parentId` is a non-empty string **and** differs from the current `parentId`. `parentId: null` (un-parent) is always allowed.

- [ ] **Step 1: Write the failing tests.** In `apps/api/src/topics/topics.service.spec.ts`, extend the top import and append a `describe`:

```ts
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
```

```ts
describe('reparent cycle guard', () => {
  beforeEach(() => {
    // graph: t1 (root) -> c1 (child of t1); p is an unrelated root
    prisma.topic.findUnique.mockImplementation(({ where }: any) => {
      const rows: Record<string, { id: string; parentId: string | null }> = {
        t1: { id: 't1', parentId: null },
        c1: { id: 'c1', parentId: 't1' },
        p: { id: 'p', parentId: null },
      };
      return Promise.resolve(rows[where.id] ?? null);
    });
    prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1' });
  });

  it('rejects self-parent with 422', async () => {
    await expect(service.update('t1', { parentId: 't1' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.topic.update).not.toHaveBeenCalled();
  });

  it('rejects reparenting under a descendant with 422', async () => {
    await expect(service.update('t1', { parentId: 'c1' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(prisma.topic.update).not.toHaveBeenCalled();
  });

  it('allows a valid move and forwards parentId', async () => {
    await service.update('t1', { parentId: 'p' });
    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { parentId: 'p' },
    });
  });

  it('allows un-parenting (parentId null) without a cycle check', async () => {
    await service.update('c1', { parentId: null } as any);
    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { parentId: null },
    });
  });

  it('rejects a non-existent parent with 404', async () => {
    await expect(service.update('t1', { parentId: 'ghost' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.topic.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to fail.** `yarn workspace @terrain/api test topics.service` → the self-parent / descendant / 404 cases fail (no guard exists; `update` calls `prisma.topic.update` unconditionally).

- [ ] **Step 3: Minimal impl.** In `apps/api/src/topics/topics.service.ts` add `UnprocessableEntityException` to the import, add the private method, and gate it in `update()`:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
```

```ts
private async assertNoParentCycle(id: string, parentId: string): Promise<void> {
  if (parentId === id) {
    throw new UnprocessableEntityException('A topic cannot be its own parent.');
  }
  let cursor: string | null = parentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === id) {
      throw new UnprocessableEntityException('Reparenting would create a cycle.');
    }
    if (visited.has(cursor)) break; // pre-existing bad-data cycle upstream — stop
    visited.add(cursor);
    const node = await this.prisma.topic.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!node) {
      if (cursor === parentId) {
        throw new NotFoundException(`Topic ${parentId} not found`);
      }
      break; // broken ancestor chain — nothing more to walk
    }
    cursor = node.parentId;
  }
}
```

Rewrite `update()`:

```ts
async update(id: string, dto: UpdateTopicDto) {
  const existing = await this.findOne(id);
  if (
    typeof dto.parentId === 'string' &&
    dto.parentId.length > 0 &&
    dto.parentId !== existing.parentId
  ) {
    await this.assertNoParentCycle(id, dto.parentId);
  }
  if (dto.topicType) await this.registerType(dto.topicType);
  const { nextReviewAt, ...rest } = dto;
  return this.prisma.topic.update({
    where: { id },
    data: { ...rest, ...(nextReviewAt ? { nextReviewAt: new Date(nextReviewAt) } : {}) },
  });
}
```

- [ ] **Step 4: Run to pass.** `yarn workspace @terrain/api test topics.service` → all reparent tests + the Task 1 test + the 4 originals pass.

- [ ] **Step 5: Checkpoint.** `yarn workspace @terrain/api test topics.service` (12 tests green) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

---

### Task 3: Prerequisite endpoints (DTO + service + controller + cycle guard)

**Files:**
- Modify `apps/api/src/topics/dto.ts` (add `AddPrerequisiteDto`).
- Modify `apps/api/src/topics/topics.service.ts` (add `addPrerequisite`, `removePrerequisite`, `assertNoPrereqCycle`).
- Modify `apps/api/src/topics/topics.controller.ts` (2 new routes + import).
- Modify `apps/api/src/topics/topics.service.spec.ts` (add a `describe`).

**Interfaces:**
- Produces DTO: `class AddPrerequisiteDto { @IsString() prerequisiteId!: string }`.
- Produces service:
  - `async addPrerequisite(topicId: string, prerequisiteId: string)` — 404 missing topic (either side), 422 self, 422 DAG cycle, idempotent on duplicate (composite PK via `upsert`).
  - `private async assertNoPrereqCycle(topicId: string, prerequisiteId: string): Promise<void>` — cycle iff `prerequisiteId` already transitively requires `topicId` (walk the requires-closure from `prerequisiteId` following `Prerequisite.prerequisiteId`; if it reaches `topicId`, throw 422).
  - `async removePrerequisite(topicId: string, prerequisiteId: string)` — idempotent (`deleteMany`), never 404.
- Produces controller routes:
  - `@Post(':id/prerequisites') addPrerequisite(@Param('id') id, @Body() dto: AddPrerequisiteDto)`
  - `@Delete(':id/prerequisites/:prerequisiteId') removePrerequisite(@Param('id') id, @Param('prerequisiteId') prerequisiteId)`

Direction convention: `Prerequisite(topicId=:id, prerequisiteId)` means **":id requires prerequisiteId"** (edge source = prerequisite → target = dependent).

- [ ] **Step 1: Write the failing tests.** First widen the `prisma` mock's type annotation at `apps/api/src/topics/topics.service.spec.ts:9` so the new delegates type-check under ts-jest (the tests below assign `prisma.prerequisite`, and Task 4 assigns `prisma.$transaction`; neither is on the current `{ topic; topicType; review }` annotation, so ts-jest would raise TS2339 and fail the whole spec to compile):

```ts
  let prisma: { topic: any; topicType: any; review: any; prerequisite: any; $transaction: any };
```

Then append the failing `describe`:

```ts
describe('prerequisite editing', () => {
  beforeEach(() => {
    prisma.topic.findUnique.mockImplementation(({ where }: any) => {
      const known = new Set(['t1', 'p', 'q']);
      return Promise.resolve(known.has(where.id) ? { id: where.id } : null);
    });
    prisma.prerequisite = {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ topicId: 't1', prerequisiteId: 'p' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
  });

  it('rejects a self-prerequisite with 422', async () => {
    await expect(service.addPrerequisite('t1', 't1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('404s when a topic is missing', async () => {
    await expect(service.addPrerequisite('ghost', 'p')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a direct cycle with 422 (p already requires t1)', async () => {
    prisma.prerequisite.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where.topicId === 'p' ? [{ prerequisiteId: 't1' }] : []),
    );
    await expect(service.addPrerequisite('t1', 'p')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a transitive cycle with 422 (p requires q requires t1)', async () => {
    prisma.prerequisite.findMany.mockImplementation(({ where }: any) => {
      if (where.topicId === 'p') return Promise.resolve([{ prerequisiteId: 'q' }]);
      if (where.topicId === 'q') return Promise.resolve([{ prerequisiteId: 't1' }]);
      return Promise.resolve([]);
    });
    await expect(service.addPrerequisite('t1', 'p')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('adds a valid edge via upsert (idempotent on duplicate)', async () => {
    await service.addPrerequisite('t1', 'p');
    expect(prisma.prerequisite.upsert).toHaveBeenCalledWith({
      where: { topicId_prerequisiteId: { topicId: 't1', prerequisiteId: 'p' } },
      create: { topicId: 't1', prerequisiteId: 'p' },
      update: {},
    });
    // a repeat call is still a no-op upsert, never a throw
    await expect(service.addPrerequisite('t1', 'p')).resolves.toBeDefined();
  });

  it('removes an edge idempotently via deleteMany', async () => {
    await service.removePrerequisite('t1', 'p');
    expect(prisma.prerequisite.deleteMany).toHaveBeenCalledWith({
      where: { topicId: 't1', prerequisiteId: 'p' },
    });
  });
});
```

- [ ] **Step 2: Run to fail.** `yarn workspace @terrain/api test topics.service` → fails to compile (`service.addPrerequisite` / `removePrerequisite` do not exist).

- [ ] **Step 3: Impl the DTO.** In `apps/api/src/topics/dto.ts` add (below `CreateAppEventDto`):

```ts
export class AddPrerequisiteDto {
  @IsString() prerequisiteId!: string;
}
```

- [ ] **Step 4: Impl the service.** In `apps/api/src/topics/topics.service.ts` add three methods (after `update`):

```ts
async addPrerequisite(topicId: string, prerequisiteId: string) {
  await this.findOne(topicId); // 404 if the dependent is missing
  await this.findOne(prerequisiteId); // 404 if the prerequisite is missing
  if (prerequisiteId === topicId) {
    throw new UnprocessableEntityException('A topic cannot be its own prerequisite.');
  }
  await this.assertNoPrereqCycle(topicId, prerequisiteId);
  return this.prisma.prerequisite.upsert({
    where: { topicId_prerequisiteId: { topicId, prerequisiteId } },
    create: { topicId, prerequisiteId },
    update: {},
  });
}

private async assertNoPrereqCycle(topicId: string, prerequisiteId: string): Promise<void> {
  // A cycle forms iff prerequisiteId already (transitively) requires topicId.
  // Walk the requires-closure outward from prerequisiteId.
  const visited = new Set<string>();
  const stack = [prerequisiteId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === topicId) {
      throw new UnprocessableEntityException('Adding this prerequisite would create a cycle.');
    }
    if (visited.has(current)) continue;
    visited.add(current);
    const edges = await this.prisma.prerequisite.findMany({
      where: { topicId: current },
      select: { prerequisiteId: true },
    });
    for (const e of edges) stack.push(e.prerequisiteId);
  }
}

async removePrerequisite(topicId: string, prerequisiteId: string) {
  await this.prisma.prerequisite.deleteMany({ where: { topicId, prerequisiteId } });
}
```

- [ ] **Step 5: Impl the controller routes.** In `apps/api/src/topics/topics.controller.ts` import the DTO and add two handlers (after `addAppEvent`):

```ts
import { CreateAppEventDto, CreateTopicDto, AddPrerequisiteDto, UpdateTopicDto } from './dto';
```

```ts
  @Post(':id/prerequisites') addPrerequisite(
    @Param('id') id: string,
    @Body() dto: AddPrerequisiteDto,
  ) {
    return this.service.addPrerequisite(id, dto.prerequisiteId);
  }
  @Delete(':id/prerequisites/:prerequisiteId') removePrerequisite(
    @Param('id') id: string,
    @Param('prerequisiteId') prerequisiteId: string,
  ) {
    return this.service.removePrerequisite(id, prerequisiteId);
  }
```

- [ ] **Step 6: Run to pass.** `yarn workspace @terrain/api test topics.service` → all prerequisite tests green.

- [ ] **Step 7: Checkpoint.** `yarn workspace @terrain/api test topics.service` (18 tests green) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

---

### Task 4: Delete rule rewrite (history-gated + cascade)

**Files:**
- Modify `apps/api/src/topics/topics.service.ts` (`remove()` ~lines 120-132).
- Modify `apps/api/src/topics/topics.service.spec.ts` (add a `describe`).

**Interfaces:**
- Changed: `remove(id)` — load the topic with `_count` of `reviews` + `appEvents`; if either `> 0` throw `ConflictException` (409); else in one `$transaction` (array form) delete `Prerequisite` where `topicId == id` **or** `prerequisiteId == id`, `updateMany` children `parentId = null`, then `delete` the topic. Missing topic → 404 (unchanged behavior).

- [ ] **Step 1: Write the failing tests.** In `apps/api/src/topics/topics.service.spec.ts` append:

```ts
describe('delete rule', () => {
  it('409s when the topic has review history', async () => {
    prisma.topic.findUnique.mockResolvedValue({
      id: 't1',
      _count: { reviews: 1, appEvents: 0 },
    });
    await expect(service.remove('t1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s when the topic has application-event history', async () => {
    prisma.topic.findUnique.mockResolvedValue({
      id: 't1',
      _count: { reviews: 0, appEvents: 2 },
    });
    await expect(service.remove('t1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('deletes a history-free topic, cascading edges and nulling children', async () => {
    prisma.topic.findUnique.mockResolvedValue({
      id: 't1',
      _count: { reviews: 0, appEvents: 0 },
    });
    prisma.prerequisite = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
    prisma.topic.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.topic.delete = jest.fn().mockResolvedValue({ id: 't1' });
    prisma.$transaction = jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));

    await service.remove('t1');

    expect(prisma.prerequisite.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ topicId: 't1' }, { prerequisiteId: 't1' }] },
    });
    expect(prisma.topic.updateMany).toHaveBeenCalledWith({
      where: { parentId: 't1' },
      data: { parentId: null },
    });
    expect(prisma.topic.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
```

No import change is needed in the spec file's SUT import: after Task 2 the top `@nestjs/common` import already reads `import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';` for the spec's assertions — extend it to include `ConflictException` (the delete tests assert `ConflictException`):

```ts
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
```

The `prisma` annotation at `topics.service.spec.ts:9` already includes `$transaction` and `prerequisite` from Task 3's widening, so `prisma.$transaction = ...` and `prisma.prerequisite = ...` in the test below type-check with no further change.

- [ ] **Step 2: Run to fail.** `yarn workspace @terrain/api test topics.service` → the delete tests fail (current `remove()` calls `findOne` + `topic.delete` and only maps P2003; it never reads `_count` and never cascades).

- [ ] **Step 3: Minimal impl.** Replace `remove()` in `apps/api/src/topics/topics.service.ts`:

```ts
async remove(id: string) {
  const topic = await this.prisma.topic.findUnique({
    where: { id },
    include: { _count: { select: { reviews: true, appEvents: true } } },
  });
  if (!topic) throw new NotFoundException(`Topic ${id} not found`);
  if (topic._count.reviews > 0 || topic._count.appEvents > 0) {
    throw new ConflictException(
      `Topic ${id} has review or application history — archive it instead of deleting.`,
    );
  }
  await this.prisma.$transaction([
    this.prisma.prerequisite.deleteMany({
      where: { OR: [{ topicId: id }, { prerequisiteId: id }] },
    }),
    this.prisma.topic.updateMany({ where: { parentId: id }, data: { parentId: null } }),
    this.prisma.topic.delete({ where: { id } }),
  ]);
}
```

The array `$transaction` form matches `apps/api/src/reviews/reviews.service.ts`; the builder calls run synchronously, so the mocks record their args.

- [ ] **Step 4: Run to pass.** `yarn workspace @terrain/api test topics.service` → all delete tests green.

- [ ] **Step 5: Checkpoint.** `yarn workspace @terrain/api test` (full api suite green: 47 originals + 17 new = **64**; `TopicsService` spec 4 → 21) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

---

## Wave B — Web (Roadmap editing surfaces)

Ships independently: `yarn workspace @terrain/web build` (tsc --noEmit + vite build) exit 0, plus the live headless-Brave/CDP smoke described per task. All paths under `apps/web/src`. The toast primitive already exists and is mounted — reuse it (Task 6 confirms this).

### Task 5: API client + hooks (prerequisite mutations + nullable parentId)

**Files:**
- Modify `apps/web/src/api/types.ts` (`UpdateTopicInput.parentId` + add `aiProposed`).
- Modify `apps/web/src/api/client.ts` (add two methods to `api`).
- Modify `apps/web/src/api/hooks.ts` (add two hooks).

**Interfaces:**
- Produces client: `addPrerequisite(topicId, prerequisiteId)` → `POST /topics/:id/prerequisites` `{ prerequisiteId }`; `removePrerequisite(topicId, prerequisiteId)` → `DELETE /topics/:id/prerequisites/:prerequisiteId`.
- Produces hooks: `useAddPrerequisite`, `useRemovePrerequisite` (object variables `{ topicId, prerequisiteId }`, `onSuccess: (_d, vars) => invalidate(vars.topicId)`), mirroring `useUpdateTopic`.
- Changed type: `UpdateTopicInput.parentId?: string | null` (so drag-to-empty can send `parentId: null`) **and** `UpdateTopicInput.aiProposed?: boolean` (so the Keep control in Task 9 can send `{ aiProposed: false }` without a TS2353 excess-property error). `updateTopic` / `useUpdateTopic` are reused unchanged for keep/park/restore/reparent/full-edit.

- [ ] **Step 1: Widen the reparent type + add the curation field.** In `apps/web/src/api/types.ts`, change the `UpdateTopicInput.parentId` field and add `aiProposed` (mirroring the backend `UpdateTopicDto` from Wave A Task 1):

```ts
  parentId?: string | null;
  summary?: string;
  interval?: number;
  nextReviewAt?: string;
  aiProposed?: boolean;
```

The existing `UpdateTopicInput` already lists `summary`/`interval`/`nextReviewAt` after `parentId` — keep them; only `parentId` is widened to `string | null` and `aiProposed?: boolean` is appended. (Leave `CreateTopicInput.parentId?: string` as-is; note `aiProposed` already exists on the read types `Topic`/`TopicWithMeta`, so `TopicNode`'s `topic.aiProposed` is unaffected — this change is only on the mutation input type.)

- [ ] **Step 2: Add client methods.** In `apps/web/src/api/client.ts`, inside the `api` object under the `// topics` group (after `addAppEvent`), add:

```ts
  addPrerequisite: (topicId: string, prerequisiteId: string) =>
    req<{ topicId: string; prerequisiteId: string }>(`/topics/${topicId}/prerequisites`, {
      method: 'POST',
      ...json({ prerequisiteId }),
    }),
  removePrerequisite: (topicId: string, prerequisiteId: string) =>
    req<void>(`/topics/${topicId}/prerequisites/${prerequisiteId}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Add hooks.** In `apps/web/src/api/hooks.ts`, after `useUpdateTopic` (or near the topic mutations), add:

```ts
export function useAddPrerequisite() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ topicId, prerequisiteId }: { topicId: string; prerequisiteId: string }) =>
      api.addPrerequisite(topicId, prerequisiteId),
    onSuccess: (_data, vars) => invalidate(vars.topicId),
  });
}

export function useRemovePrerequisite() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ topicId, prerequisiteId }: { topicId: string; prerequisiteId: string }) =>
      api.removePrerequisite(topicId, prerequisiteId),
    onSuccess: (_data, vars) => invalidate(vars.topicId),
  });
}
```

- [ ] **Step 4: Checkpoint.** `yarn workspace @terrain/web build` (exit 0 — tsc --noEmit + vite build). No commit — uncommitted per standing preference.

---

### Task 6: Confirm & reuse the toast primitive (no new file)

**Files:**
- Read-only verify `apps/web/src/components/Toast.tsx` and `apps/web/src/app/Layout.tsx`.

**Interfaces:**
- Consumes: existing `ToastProvider` (already mounted at the app root in `apps/web/src/app/Layout.tsx`) and `useToast(): { toast: (msg: string, kind?: 'info'|'success'|'error') => void }` exported from `apps/web/src/components/Toast.tsx` (barrel-exported via `components/index.ts`).

The shared contract's "new `components/Toast.tsx` with `{ success, error }`" is **already satisfied** by the existing primitive — do **not** create a second one. All Wave-B call sites use `const { toast } = useToast();` then `toast(msg, 'success')` / `toast(msg, 'error')`. This maps 1:1 onto the contract's intent (`success(msg)` → `toast(msg,'success')`, `error(msg)` → `toast(msg,'error')`).

- [ ] **Step 1: Verify the provider is mounted.** Confirm `apps/web/src/app/Layout.tsx` wraps the tree in `<ToastProvider>` (it does, lines 2/30/54) and `apps/web/src/components/index.ts` re-exports `./Toast`. No code change.

- [ ] **Step 2: Checkpoint.** `yarn workspace @terrain/web build` (exit 0). No commit — uncommitted per standing preference.

---

### Task 7: `TopicNode` — tentative + parked affordances, tooltip, handles

**Files:**
- Modify `apps/web/src/screens/Roadmap/TopicNode.tsx` (extend `TopicNodeData`; add dashed/greyed styling + hover controls + `aiContext` tooltip; keep the existing source/target `Handle`s).

**Interfaces:**
- Produces: `TopicNodeData` gains optional callbacks:
  ```ts
  onKeep?: (id: string) => void;
  onSetAside?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
  ```
- Consumes (from Task 9): the Roadmap index supplies those callbacks per node.
- Derived per node: `tentative = topic.aiProposed && topic.status !== 'archived'`; `parked = topic.aiProposed && topic.status === 'archived'`.

- [ ] **Step 1: Replace `TopicNode.tsx`.** Full file:

```tsx
import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { TopicWithMeta } from '../../api/types';
import { topicColor, topicGlyph } from '../../components';

export type TopicNodeData = {
  topic: TopicWithMeta;
  selected: boolean;
  onKeep?: (id: string) => void;
  onSetAside?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDelete?: (id: string) => void;
};

export type TopicNodeType = Node<TopicNodeData, 'topic'>;

/**
 * Custom @xyflow/react node ("topic"). Status glyph + title + meta row.
 * Tentative (imported, un-curated) nodes get a dashed border, a ✦ marker and
 * hover Keep / Set-aside controls; parked (set-aside) nodes render muted with
 * Restore / Delete controls. aiContext surfaces as the node tooltip.
 */
export default function TopicNode({ data }: NodeProps<TopicNodeType>) {
  const { topic, selected, onKeep, onSetAside, onRestore, onDelete } = data;
  const [hover, setHover] = useState(false);
  const blocked = topic.labels.blocked;
  const color = topicColor(topic.status, blocked);
  const glyph = topicGlyph(topic.status, blocked);

  const tentative = topic.aiProposed && topic.status !== 'archived';
  const parked = topic.aiProposed && topic.status === 'archived';

  return (
    <div
      className={'rf-node' + (selected ? ' selected' : '')}
      title={topic.aiContext ?? undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderLeft: `4px solid ${color}`,
        border: tentative ? `1px dashed ${color}` : undefined,
        borderLeftWidth: 4,
        opacity: parked ? 0.55 : 1,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="rf-title">
        <span style={{ color, marginRight: 6 }}>{glyph}</span>
        {topic.title}
      </div>
      <div className="rf-meta">
        <span>{topic.topicType}</span>
        {topic.aiProposed && (
          <span title="Imported from Claude" style={{ marginLeft: 6, color: 'var(--st-active)' }}>
            ✦
          </span>
        )}
      </div>

      {tentative && hover && (onKeep || onSetAside) && (
        <div className="rf-actions row gap-1" style={{ marginTop: 6 }}>
          {onKeep && (
            <button
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onKeep(topic.id);
              }}
            >
              ✓ Keep
            </button>
          )}
          {onSetAside && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onSetAside(topic.id);
              }}
            >
              ✗ Set aside
            </button>
          )}
        </div>
      )}

      {parked && hover && (onRestore || onDelete) && (
        <div className="rf-actions row gap-1" style={{ marginTop: 6 }}>
          {onRestore && (
            <button
              className="btn btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onRestore(topic.id);
              }}
            >
              ↩ Restore
            </button>
          )}
          {onDelete && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(topic.id);
              }}
            >
              🗑 Delete
            </button>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

`e.stopPropagation()` on the buttons prevents the node's `onNodeClick` (drawer open) from firing when curating. The tooltip uses the native `title` attribute (works headless).

- [ ] **Step 2: Checkpoint.** `yarn workspace @terrain/web build` (exit 0). No commit — uncommitted per standing preference. (Full behavior is verified in Task 9's smoke, once the index supplies the callbacks.)

---

### Task 8: `TopicDetailPanel` — full node editor

**Files:**
- Modify `apps/web/src/components/TopicDetailPanel.tsx` (add editable `title`/`domain`/`topicType`/`description` + a Save button; import `TypeAutocomplete`).

**Interfaces:**
- Consumes: existing `useUpdateTopic()` (object variables) and `useToast()`.
- Produces: a `saveFields()` that PATCHes `{ title, domain, topicType, description }`. Keeps existing status `<select>`, `Mark mastered`, and notes/summary controls.

- [ ] **Step 1: Add editor state + a save handler.** In `apps/web/src/components/TopicDetailPanel.tsx`, extend the import from `./TypeAutocomplete` (via the local module or the barrel — this file imports siblings directly, so add a direct import) and add fields to the existing state block:

```ts
import { TypeAutocomplete } from './TypeAutocomplete';
```

Extend the state declared after `const [summary, setSummary] = useState('');`:

```ts
  const [title, setTitle] = useState('');
  const [domain, setDomain] = useState('');
  const [topicType, setTopicType] = useState('');
  const [description, setDescription] = useState('');
```

Extend the re-seed effect (the existing `useEffect(() => { if (t) { ... } }, [t?.id]);`) to also seed the new fields:

```ts
  useEffect(() => {
    if (t) {
      setNoteRef(t.noteRef ?? '');
      setSummary(t.summary ?? '');
      setTitle(t.title);
      setDomain(t.domain);
      setTopicType(t.topicType);
      setDescription(t.description ?? '');
    }
  }, [t?.id]); // re-seed when a different topic loads
```

Add a save handler next to `saveNotes`:

```ts
  const saveFields = () =>
    update.mutate(
      {
        id: t.id,
        input: {
          title: title.trim(),
          domain: domain.trim(),
          topicType: topicType.trim(),
          description: description.trim(),
        },
      },
      {
        onSuccess: () => toast('Topic updated', 'success'),
        onError: (e) => toast(e instanceof Error ? e.message : 'Update failed', 'error'),
      },
    );
```

- [ ] **Step 2: Render the editor.** Insert an "Edit topic" card between the header block (closing `</div>` of the `col gap-2` header at ~line 119) and the SR-state stat-strip. Add:

```tsx
      {/* editable fields */}
      <div className="col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Edit topic
        </div>
        <input
          className="input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="row gap-3">
          <input
            className="input grow"
            placeholder="Domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <div className="grow">
            <TypeAutocomplete value={topicType} onChange={setTopicType} />
          </div>
        </div>
        <textarea
          className="textarea"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={update.isPending || !title.trim()}
          onClick={saveFields}
        >
          Save changes
        </button>
      </div>
```

Status/park still ride the existing status `<select>` (Set aside = choose `Archived`; Restore = choose `Planned`). The dedicated graph curation controls live on the node (Task 7) + toolbar (Task 9).

- [ ] **Step 3: Checkpoint.** `yarn workspace @terrain/web build` (exit 0). No commit — uncommitted per standing preference.

- [ ] **Step 4: Live smoke.** `docker compose up -d`; `yarn workspace @terrain/api start &` (`:3000`); `yarn workspace @terrain/web dev &` (`:5180`). Drive headless Brave via `scripts/smoke.mjs` (CDP WebSocket, `.textContent`): open `/roadmap`, click a node, in the drawer change the title, click **Save changes**, confirm the toast "Topic updated" and that the node title updates after invalidation. Kill the API with `kill -9 $(lsof -ti:3000)`.

---

### Task 9: Roadmap index — curation, parked shelf, drag-reparent, connect/delete edges

**Files:**
- Modify `apps/web/src/screens/Roadmap/index.tsx` (filtering, toolbar toggle, node-data callbacks, React Flow gesture handlers, toasts).

**Interfaces:**
- Consumes: `useUpdateTopic`, `useDeleteTopic`, `useAddPrerequisite`, `useRemovePrerequisite` (Task 5), `useToast` (Task 6), the `TopicNodeData` callback fields (Task 7).
- Produces: a parked-ideas toggle (default off), active-graph filtering (hide `status==='archived'` except parked when toggled), and `onNodeDragStop` / `onConnect` / `onEdgesDelete` wired to the mutations. Prerequisite edges are selectable/deletable; parent edges are not.

Curation mapping (all via `useUpdateTopic` / `useDeleteTopic`):
- Keep → `{ aiProposed: false }`; Set aside → `{ status: 'archived' }`; Restore → `{ status: 'planned' }`; Delete permanently → `deleteTopic(id)` (with `window.confirm`).
- Reparent: drop on exactly one node → `{ parentId: target }`; drop on empty → `{ parentId: null }`; drop on >1 → no-op.
- Connect A→B → `addPrerequisite(target=B, prerequisiteId=source=A)` ("B requires A").
- Delete a prereq edge → `removePrerequisite(target, source)`.

- [ ] **Step 1: Replace `index.tsx`.** Full file:

```tsx
import '@xyflow/react/dist/style.css';

import { useCallback, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, MarkerType } from '@xyflow/react';
import type {
  Edge,
  NodeMouseHandler,
  NodeTypes,
  OnConnect,
  OnEdgesDelete,
  OnNodeDrag,
  ReactFlowInstance,
} from '@xyflow/react';

import {
  useTopics,
  useUpdateTopic,
  useDeleteTopic,
  useAddPrerequisite,
  useRemovePrerequisite,
} from '../../api/hooks';
import type { TopicWithMeta } from '../../api/types';
import {
  Loading,
  EmptyState,
  ErrorBox,
  TopicDetailPanel,
  STATUS_META,
  BLOCKED_COLOR,
  useToast,
} from '../../components';
import TopicNode, { type TopicNodeData, type TopicNodeType } from './TopicNode';
import { layoutGraph } from './layout';

const nodeTypes = { topic: TopicNode } as NodeTypes;

const LEGEND: { glyph: string; label: string; color: string }[] = [
  { glyph: STATUS_META.planned.glyph, label: 'Planned', color: STATUS_META.planned.color },
  { glyph: STATUS_META.active.glyph, label: 'Active', color: STATUS_META.active.color },
  { glyph: STATUS_META.mastered.glyph, label: 'Mastered', color: STATUS_META.mastered.color },
  { glyph: '✗', label: 'Blocked', color: BLOCKED_COLOR },
];

export default function Roadmap() {
  const { data: topics, isLoading, isError, error } = useTopics();
  const [domain, setDomain] = useState<string>('__all__');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false);

  const update = useUpdateTopic();
  const del = useDeleteTopic();
  const addPre = useAddPrerequisite();
  const removePre = useRemovePrerequisite();
  const { toast } = useToast();
  const rf = useRef<ReactFlowInstance<TopicNodeType, Edge> | null>(null);

  const err = (e: unknown, fallback: string) =>
    toast(e instanceof Error ? e.message : fallback, 'error');

  const keep = useCallback(
    (id: string) =>
      update.mutate(
        { id, input: { aiProposed: false } },
        { onSuccess: () => toast('Kept', 'success'), onError: (e) => err(e, 'Keep failed') },
      ),
    [update, toast],
  );
  const setAside = useCallback(
    (id: string) =>
      update.mutate(
        { id, input: { status: 'archived' } },
        { onSuccess: () => toast('Set aside', 'success'), onError: (e) => err(e, 'Failed') },
      ),
    [update, toast],
  );
  const restore = useCallback(
    (id: string) =>
      update.mutate(
        { id, input: { status: 'planned' } },
        { onSuccess: () => toast('Restored', 'success'), onError: (e) => err(e, 'Restore failed') },
      ),
    [update, toast],
  );
  const removePermanently = useCallback(
    (id: string) => {
      if (!window.confirm('Delete this idea permanently? This cannot be undone.')) return;
      del.mutate(id, {
        onSuccess: () => toast('Deleted', 'success'),
        onError: (e) => err(e, 'Delete failed'),
      });
    },
    [del, toast],
  );

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const t of topics ?? []) set.add(t.domain);
    return Array.from(set).sort();
  }, [topics]);

  const parkedCount = useMemo(
    () => (topics ?? []).filter((t) => t.aiProposed && t.status === 'archived').length,
    [topics],
  );

  const { nodes, edges } = useMemo(() => {
    const all = topics ?? [];
    const filtered = all.filter((t) => {
      if (domain !== '__all__' && t.domain !== domain) return false;
      const parked = t.aiProposed && t.status === 'archived';
      if (t.status === 'archived') return parked && showParked; // parked only, only when toggled
      return true; // active graph (incl. tentative)
    });
    const visible = new Set(filtered.map((t) => t.id));

    const baseNodes: TopicNodeType[] = filtered.map((t: TopicWithMeta) => ({
      id: t.id,
      type: 'topic',
      position: { x: 0, y: 0 },
      data: {
        topic: t,
        selected: t.id === selectedId,
        onKeep: keep,
        onSetAside: setAside,
        onRestore: restore,
        onDelete: removePermanently,
      } satisfies TopicNodeData,
    }));

    const builtEdges: Edge[] = [];
    for (const t of filtered) {
      for (const preId of t.prerequisiteIds) {
        if (!visible.has(preId)) continue;
        builtEdges.push({
          id: `${preId}-${t.id}`,
          source: preId,
          target: t.id,
          data: { kind: 'prereq' },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
      if (t.parentId && visible.has(t.parentId)) {
        builtEdges.push({
          id: `parent-${t.parentId}-${t.id}`,
          source: t.parentId,
          target: t.id,
          data: { kind: 'parent' },
          selectable: false,
          deletable: false,
          animated: true,
          style: { strokeDasharray: '5 5', stroke: 'var(--st-archived)' },
          markerEnd: { type: MarkerType.ArrowClosed },
        });
      }
    }

    const laidOut = layoutGraph(baseNodes, builtEdges);
    return { nodes: laidOut, edges: builtEdges };
  }, [topics, domain, selectedId, showParked, keep, setAside, restore, removePermanently]);

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    setSelectedId(node.id);
  };

  const onNodeDragStop: OnNodeDrag<TopicNodeType> = (_e, node) => {
    const inst = rf.current;
    if (!inst) return;
    const hits = inst.getIntersectingNodes(node).filter((n) => n.id !== node.id);
    if (hits.length > 1) return; // ambiguous — ignore; node snaps back on next layout
    const targetId = hits.length === 1 ? hits[0].id : null;
    if (targetId === (node.data.topic.parentId ?? null)) return; // no structural change
    const title = node.data.topic.title;
    update.mutate(
      { id: node.id, input: { parentId: targetId } },
      {
        onSuccess: () =>
          toast(targetId ? `Moved ${title}` : `Un-parented ${title}`, 'success'),
        onError: (e) => err(e, 'Move rejected'),
      },
    );
  };

  const onConnect: OnConnect = (c) => {
    if (!c.source || !c.target || c.source === c.target) return;
    addPre.mutate(
      { topicId: c.target, prerequisiteId: c.source },
      {
        onSuccess: () => toast('Prerequisite added', 'success'),
        onError: (e) => err(e, 'Could not add prerequisite'),
      },
    );
  };

  const onEdgesDelete: OnEdgesDelete<Edge> = (deleted) => {
    for (const e of deleted) {
      if ((e.data as { kind?: string } | undefined)?.kind !== 'prereq') continue;
      removePre.mutate(
        { topicId: e.target, prerequisiteId: e.source },
        {
          onSuccess: () => toast('Prerequisite removed', 'success'),
          onError: (er) => err(er, 'Could not remove prerequisite'),
        },
      );
    }
  };

  if (isLoading) return <Loading label="Loading roadmap…" />;
  if (isError) {
    return (
      <div className="page">
        <h1 className="page-title">Roadmap</h1>
        <ErrorBox error={error} />
      </div>
    );
  }

  const hasTopics = (topics ?? []).length > 0;

  return (
    <div className="page">
      <div className="row wrap gap-3" style={{ alignItems: 'center' }}>
        <h1 className="page-title" style={{ marginRight: 'auto' }}>
          Roadmap
        </h1>
        <button
          className={'btn btn-sm' + (showParked ? ' btn-primary' : '')}
          onClick={() => setShowParked((v) => !v)}
        >
          Parked ideas ({parkedCount})
        </button>
        <div className="seg">
          <button className={domain === '__all__' ? 'on' : ''} onClick={() => setDomain('__all__')}>
            All
          </button>
          {domains.map((d) => (
            <button key={d} className={domain === d ? 'on' : ''} onClick={() => setDomain(d)}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="row wrap gap-3" style={{ alignItems: 'center', marginTop: 8 }}>
        {LEGEND.map((l) => (
          <span key={l.label} className="row gap-1" style={{ alignItems: 'center' }}>
            <span style={{ color: l.color }}>{l.glyph}</span>
            <span className="faint">{l.label}</span>
          </span>
        ))}
        <span className="row gap-1" style={{ alignItems: 'center' }}>
          <span style={{ color: 'var(--st-active)' }}>✦</span>
          <span className="faint">Imported (tentative)</span>
        </span>
      </div>

      {!hasTopics ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="No topics yet"
            hint="Create topics to see them connected on the roadmap."
          />
        </div>
      ) : nodes.length === 0 ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState title="No topics in this domain" hint="Pick a different domain filter." />
        </div>
      ) : (
        <div
          style={{
            height: 'calc(100vh - 120px)',
            width: '100%',
            marginTop: 12,
            border: '1px solid var(--line, #e5e7eb)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(inst) => {
              rf.current = inst;
            }}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      )}

      {selectedId && (
        <div className="drawer-overlay" onMouseDown={() => setSelectedId(null)}>
          <div className="drawer" onMouseDown={(e) => e.stopPropagation()}>
            <TopicDetailPanel topicId={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
```

Notes: `rf.current` is captured via `onInit` (no `ReactFlowProvider` restructuring needed). `getIntersectingNodes(node)` returns overlapped nodes; we exclude the dragged node itself. Because the memo re-runs `layoutGraph` on every `topics` change, a successful mutation + `useInvalidateAll` refetch snaps the dragged node to its correct dagre position (spec §0/§7: positions are never persisted). A 422/409 surfaces as an error toast and the refetch restores truth.

- [ ] **Step 2: Checkpoint.** `yarn workspace @terrain/web build` (exit 0 — tsc --noEmit + vite build). No commit — uncommitted per standing preference.

- [ ] **Step 3: Live smoke (spec §6 web checklist).** Boot the stack (`docker compose up -d`; `yarn workspace @terrain/api start &`; `yarn workspace @terrain/web dev &`) and drive headless Brave via `scripts/smoke.mjs` (CDP WebSocket; `.textContent`):
  - Import a `learning-os` block on `/import`, then on `/roadmap` confirm tentative nodes render dashed + ✦.
  - Hover a tentative node → **✓ Keep** (node loses dashed/✦) and, on another, **✗ Set aside** (disappears from the active graph).
  - Toggle **Parked ideas (N)** → the set-aside node appears muted; **↩ Restore** returns it to the active graph; **🗑 Delete** (confirm) removes it.
  - Drag a node onto another → toast "Moved …", persists after reload; drag onto empty canvas → toast "Un-parented …".
  - Drag from a node's right handle to another's left handle → prerequisite edge appears + toast; select the edge and press Delete → edge gone + toast. Attempt a cycle → error toast, no edge.
  - Kill the API with `kill -9 $(lsof -ti:3000)`.

---

## Wave C — Export enrichment (`ExportGeneratorService`)

Ships independently: `yarn workspace @terrain/api test` green + `nest build` 0, closed by the live export-screen smoke in Task 12 Step 7 (spec §6). TDD against `apps/api/src/sessions/export-generator.service.spec.ts`. Each new section is a `## HEADER` string pushed into `sections`, **omitted entirely when empty**; the header block stays first and `OUTPUT_CONTRACT` stays last. Do not emit a second `Session: <set-on-persist>` or a second `learning-os` fence, and never emit the literal `SESSION GOAL` outside the existing focus branch.

### Task 10: PARKED IDEAS section

**Files:**
- Modify `apps/api/src/sessions/export-generator.service.ts` (add `parkedIdeas`, push into `generate()`).
- Modify `apps/api/src/sessions/export-generator.service.spec.ts` (add tests).

**Interfaces:**
- Produces: `private parkedIdeas(topics: TopicWithPrereqs[]): string` — `''` when there are none; else `## PARKED IDEAS\n` + one `- <title> (<type>, <domain>)[ — <aiContext>]` line per topic where `aiProposed && status === 'archived'`. Uses the already-loaded `topics` array (no new query). Domain-scoped because `generate()` already filters `topics` by `domain:` mode.

- [ ] **Step 1: Write the failing tests.** In `apps/api/src/sessions/export-generator.service.spec.ts` append inside the `describe('ExportGeneratorService', ...)`:

```ts
it('renders PARKED IDEAS for aiProposed+archived topics (and omits when none)', async () => {
  const prisma: any = {
    topic: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'z',
          title: 'Skip lists',
          domain: 'DSA',
          topicType: 'concept',
          status: 'archived',
          repetitions: 0,
          interval: 0,
          nextReviewAt: null,
          noteRef: null,
          summary: null,
          parentId: null,
          aiProposed: true,
          aiContext: 'came up while discussing balanced trees',
          prerequisites: [],
        },
      ]),
    },
    applicationEvent: { count: jest.fn().mockResolvedValue(0) },
    sessionExport: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  };
  const metrics = makeMetrics(prisma);
  const mod = await Test.createTestingModule({
    providers: [
      ExportGeneratorService,
      { provide: PrismaService, useValue: prisma },
      { provide: MetricsService, useValue: metrics },
    ],
  }).compile();
  const svc = mod.get(ExportGeneratorService);
  const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z') });
  expect(md).toContain('## PARKED IDEAS');
  expect(md).toContain('- Skip lists (concept, DSA) — came up while discussing balanced trees');
});

it('omits PARKED IDEAS when there are no parked topics', async () => {
  const md = await service.generate({ now: new Date('2026-01-08T09:00:00Z') });
  expect(md).not.toContain('PARKED IDEAS');
});
```

(The `findMany: ...` on `sessionExport` is added here in anticipation of Task 12 — harmless now.)

- [ ] **Step 2: Run to fail.** `yarn workspace @terrain/api test export-generator` → the PARKED-IDEAS render test fails (no section emitted).

- [ ] **Step 3: Impl.** In `apps/api/src/sessions/export-generator.service.ts` add a private method (after `roadmap`):

```ts
private parkedIdeas(topics: TopicWithPrereqs[]): string {
  const parked = topics.filter((t) => t.aiProposed && t.status === 'archived');
  if (parked.length === 0) return '';
  const lines = parked.map(
    (t) =>
      `- ${t.title} (${t.topicType}, ${t.domain})${t.aiContext ? ` — ${t.aiContext}` : ''}`,
  );
  return `## PARKED IDEAS\n${lines.join('\n')}`;
}
```

Wire it in `generate()` right after the roadmap push:

```ts
    sections.push(this.roadmap(topics));
    const parked = this.parkedIdeas(topics);
    if (parked) sections.push(parked);
```

- [ ] **Step 4: Run to pass.** `yarn workspace @terrain/api test export-generator` → new tests green; the 8 existing export tests stay green (their mock topics have no `aiProposed`, so `parkedIdeas` returns `''`).

- [ ] **Step 5: Checkpoint.** `yarn workspace @terrain/api test export-generator` (10 tests green) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

---

### Task 11: AI CONTEXT annotations in the ROADMAP tree

**Files:**
- Modify `apps/api/src/sessions/export-generator.service.ts` (annotate `render()` head; add `aiAnnotation`).
- Modify `apps/api/src/sessions/export-generator.service.spec.ts` (add a test).

**Interfaces:**
- Produces: `private aiAnnotation(t: TopicWithPrereqs, depth: number): string` — `''` unless `t` is tentative (`aiProposed && status !== 'archived'`) with a non-empty `aiContext`; else an indented `↳ AI context: <aiContext>` line. Rendered under the node's head line so Claude sees why each ✦ suggestion was made. No new query (`t.aiContext` is already on every loaded topic).

- [ ] **Step 1: Write the failing test.** In `apps/api/src/sessions/export-generator.service.spec.ts` append:

```ts
it('annotates tentative nodes with their aiContext in the ROADMAP', async () => {
  const prisma: any = {
    topic: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'q',
          title: 'Fenwick trees',
          domain: 'DSA',
          topicType: 'pattern',
          status: 'planned',
          repetitions: 0,
          interval: 0,
          nextReviewAt: null,
          noteRef: null,
          summary: null,
          parentId: null,
          aiProposed: true,
          aiContext: 'suggested for prefix-sum problems',
          prerequisites: [],
        },
      ]),
    },
    applicationEvent: { count: jest.fn().mockResolvedValue(0) },
    sessionExport: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  };
  const metrics = makeMetrics(prisma);
  const mod = await Test.createTestingModule({
    providers: [
      ExportGeneratorService,
      { provide: PrismaService, useValue: prisma },
      { provide: MetricsService, useValue: metrics },
    ],
  }).compile();
  const svc = mod.get(ExportGeneratorService);
  const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z') });
  expect(md).toContain('Fenwick trees');
  expect(md).toContain('↳ AI context: suggested for prefix-sum problems');
});
```

- [ ] **Step 2: Run to fail.** `yarn workspace @terrain/api test export-generator` → the annotation test fails (no `↳ AI context:` emitted).

- [ ] **Step 3: Impl.** In `apps/api/src/sessions/export-generator.service.ts` add the helper (near `reviewingTag`):

```ts
private aiAnnotation(t: TopicWithPrereqs, depth: number): string {
  const tentative = t.aiProposed && t.status !== 'archived';
  if (!tentative || !t.aiContext) return '';
  return `${'  '.repeat(depth + 1)}↳ AI context: ${t.aiContext}`;
}
```

In `roadmap()`, splice the annotation into the `render` closure's head handling:

```ts
      const render = (t: TopicWithPrereqs, depth: number): string => {
        if (visited.has(t.id)) return '';
        visited.add(t.id);
        const prefix = depth === 0 ? '' : '  '.repeat(depth) + '├─ ';
        const head = `${prefix}${this.glyph(t)} ${t.title}${this.reviewingTag(t)}`;
        const annotation = this.aiAnnotation(t, depth);
        const headBlock = annotation ? `${head}\n${annotation}` : head;
        const kids = childrenOf(t.id)
          .map((c) => render(c, depth + 1))
          .filter((s) => s.length > 0);
        return kids.length ? `${headBlock}\n${kids.join('\n')}` : headBlock;
      };
```

- [ ] **Step 4: Run to pass.** `yarn workspace @terrain/api test export-generator` → annotation test green; existing tests unaffected (their mock topics have `aiProposed` undefined → `aiAnnotation` returns `''`).

- [ ] **Step 5: Checkpoint.** `yarn workspace @terrain/api test export-generator` (11 tests green) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

---

### Task 12: RECENT SESSIONS section

**Files:**
- Modify `apps/api/src/sessions/export-generator.service.ts` (add `recentSessions`, push into `generate()`).
- Modify `apps/api/src/sessions/export-generator.service.spec.ts` (add a test **and** extend every existing prisma mock with `sessionExport.findMany`).

**Interfaces:**
- Produces: `private async recentSessions(): Promise<string>` — queries the last 3 `SessionExport` rows (`orderBy: { generatedAt: 'desc' }, take: 3`), global (not domain-scoped); `''` when none; else `## RECENT SESSIONS\n` + one line per row: `- <YYYY-MM-DD> — <imported YYYY-MM-DD | not imported>; <newTopicsCreated.length> topics created[; next focus: <nextFocusTitle>]`. Pushed just before `OUTPUT_CONTRACT`.

**Critical:** this adds a NEW prisma call (`sessionExport.findMany`). The existing spec mocks only stub `sessionExport.findFirst`, so `findMany` would be `undefined` and throw. Every prisma mock in the spec must gain `findMany: jest.fn().mockResolvedValue([])` (Tasks 10/11's new mocks already include it; the pre-existing ones do not).

- [ ] **Step 1: Extend all existing spec mocks.** In `apps/api/src/sessions/export-generator.service.spec.ts`, add `findMany: jest.fn().mockResolvedValue([])` to the `sessionExport` mock in each of these blocks:
  - the main `beforeEach` `prisma` (currently `sessionExport: { findFirst: jest.fn().mockResolvedValue(null) }`);
  - `prisma2` (deep-tree test);
  - `prisma3` (blocked-glyph test);
  - `prisma4` (reviewing-tag test);
  - the SUGGESTED-NEXT-FOCUS test's `prisma`.

  Each becomes:

```ts
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
```

  (In the SUGGESTED-NEXT-FOCUS test, keep its `findFirst` mock returning the Heaps row and add `findMany: jest.fn().mockResolvedValue([])`.)

- [ ] **Step 2: Write the failing test.** Append inside `describe('ExportGeneratorService', ...)`:

```ts
it('renders RECENT SESSIONS from recent SessionExport rows (omits when none)', async () => {
  const prisma: any = {
    topic: { findMany: jest.fn().mockResolvedValue([]) },
    applicationEvent: { count: jest.fn().mockResolvedValue(0) },
    sessionExport: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([
        {
          generatedAt: new Date('2026-01-05T10:00:00Z'),
          importedAt: new Date('2026-01-06T08:00:00Z'),
          newTopicsCreated: ['a', 'b'],
          nextFocusTitle: 'Segment trees',
        },
        {
          generatedAt: new Date('2026-01-02T10:00:00Z'),
          importedAt: null,
          newTopicsCreated: [],
          nextFocusTitle: null,
        },
      ]),
    },
  };
  const metrics = makeMetrics(prisma);
  const mod = await Test.createTestingModule({
    providers: [
      ExportGeneratorService,
      { provide: PrismaService, useValue: prisma },
      { provide: MetricsService, useValue: metrics },
    ],
  }).compile();
  const svc = mod.get(ExportGeneratorService);
  const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z') });
  expect(md).toContain('## RECENT SESSIONS');
  expect(md).toContain('- 2026-01-05 — imported 2026-01-06; 2 topics created; next focus: Segment trees');
  expect(md).toContain('- 2026-01-02 — not imported; 0 topics created');
  expect(prisma.sessionExport.findMany).toHaveBeenCalledWith({
    orderBy: { generatedAt: 'desc' },
    take: 3,
  });
});
```

- [ ] **Step 3: Run to fail.** `yarn workspace @terrain/api test export-generator` → the RECENT-SESSIONS test fails (no section). Confirm the mock extensions from Step 1 keep the other tests green (they no longer throw on `findMany`).

- [ ] **Step 4: Impl.** In `apps/api/src/sessions/export-generator.service.ts` add:

```ts
private async recentSessions(): Promise<string> {
  const rows = await this.prisma.sessionExport.findMany({
    orderBy: { generatedAt: 'desc' },
    take: 3,
  });
  if (rows.length === 0) return '';
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const lines = rows.map((r) => {
    const imported = r.importedAt ? `imported ${day(r.importedAt)}` : 'not imported';
    const created = r.newTopicsCreated?.length ?? 0;
    const focus = r.nextFocusTitle ? `; next focus: ${r.nextFocusTitle}` : '';
    return `- ${day(r.generatedAt)} — ${imported}; ${created} topics created${focus}`;
  });
  return `## RECENT SESSIONS\n${lines.join('\n')}`;
}
```

Wire it in `generate()` immediately before the final `OUTPUT_CONTRACT` push:

```ts
    const recent = await this.recentSessions();
    if (recent) sections.push(recent);
    sections.push(OUTPUT_CONTRACT);
    return sections.join('\n\n');
```

- [ ] **Step 5: Run to pass.** `yarn workspace @terrain/api test export-generator` → RECENT-SESSIONS test green; all other export tests green.

- [ ] **Step 6: Checkpoint.** `yarn workspace @terrain/api test` (full api suite green: 47 originals + 17 (Wave A) + 4 (Wave C: 2+1+1) = **68**) and `yarn workspace @terrain/api build` (exit 0). No commit — uncommitted per standing preference.

- [ ] **Step 7: Live smoke (spec §6 export checklist).** This closes the spec's end-to-end export check: "Generate an export with parked ideas present → PARKED IDEAS + RECENT SESSIONS sections appear." Boot the stack (`docker compose up -d`; `yarn workspace @terrain/api start &` on `:3000`; `yarn workspace @terrain/web dev &` on `:5180`) and drive headless Brave via `scripts/smoke.mjs` (CDP WebSocket; `.textContent`, not `.innerText`):
  - On `/roadmap`, hover a tentative (imported ✦) node and **✗ Set aside** it so a parked idea exists (or park one via the drawer status `<select>` → Archived).
  - Open the Export generator, click Generate, and read the rendered markdown's `.textContent`.
  - Assert it contains `## PARKED IDEAS` (the set-aside topic listed) and `## RECENT SESSIONS` (the just-persisted export row appears on a subsequent generate).
  - Kill the API with `kill -9 $(lsof -ti:3000)`.

---

## Verification

**Wave A gate (backend curation/reparent/prereq/delete):**
- `yarn workspace @terrain/api test` green — `TopicsService` spec grows from 4 → **21** tests (Task 1: +3, Task 2: +5, Task 3: +6, Task 4: +3). Overall api suite 47 → **64**.
- `yarn workspace @terrain/api build` exit 0.

**Wave B gate (web editing surfaces):**
- `yarn workspace @terrain/web build` (tsc --noEmit + vite build) exit 0 — the real gate (Rolldown prod bundle, not just dev).
- Live headless-Brave/CDP smoke (spec §6): import → tentative ✦ nodes → Keep/Set aside → toggle Parked → Restore/Delete; drag-reparent onto a node and onto empty canvas; connect a prerequisite edge, delete it, and attempt a cycle (error toast, no edge); edit a node's title/domain/type/description in the drawer. Kill the dev API with `kill -9 $(lsof -ti:3000)`.

**Wave C gate (export enrichment):**
- `yarn workspace @terrain/api test` green — `ExportGeneratorService` spec grows from 8 → **12** tests (Task 10: +2, Task 11: +1, Task 12: +1). Overall api suite **68**.
- Invariants preserved: `## WHO I AM`, `OUTPUT CONTRACT` (with the `learning-os` fence), `## ROADMAP`, and `SESSION GOAL` only on focus. PARKED IDEAS / AI CONTEXT / RECENT SESSIONS render when data is present and are omitted when empty.
- `yarn workspace @terrain/api build` exit 0.
- Live headless-Brave/CDP smoke (spec §6 export checklist): with a parked idea present (park a tentative node on `/roadmap` first), open the Export generator, generate, and assert the rendered markdown `.textContent` contains `## PARKED IDEAS` and `## RECENT SESSIONS`. Kill the dev API with `kill -9 $(lsof -ti:3000)`.

**Full-suite gate:** `yarn build` (topological, all workspaces) exit 0; `yarn test` all workspaces green; `yarn lint` + `yarn format:check` clean. No git commits — all work stays uncommitted per standing preference.
</content>
</invoke>
