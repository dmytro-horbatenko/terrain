# Disable a Course from Active Scheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pause a course (e.g. DSA) so its topics stop being scheduled anywhere — dashboard, Next Up, due cards, new-card counts, AI session export, Telegram digest/nudges — while remaining fully visible/editable in the Roadmap screen, and fix the Courses screen's `imported` flag to reflect actual DB state instead of a possibly-missing tracking row.

**Architecture:** One new `Settings.disabledDomains: String[]` column is the single source of truth (a course maps 1:1 to a `domain`). `MetricsService` — the chokepoint every scheduling surface goes through, directly or via `export-generator.service.ts` / `telegram.cron.ts` — resolves it internally and excludes those domains from every query that doesn't already have an explicit `domain` filter. `CoursesService` gains a toggle endpoint and switches `imported` from the `CourseImport` tracking table to a live `Topic` count.

**Tech Stack:** NestJS 11 + Prisma 7 (Postgres) on the API; React 19 + react-query on the web. Jest (api) / Vitest (web) for tests.

## Global Constraints

- Postgres runs via `docker compose up -d` (host port 5433) before any Prisma command.
- Migrations are generated via `prisma migrate dev`, never hand-authored SQL — the schema/migration must match exactly what Prisma emits.
- No git commits happen automatically per this repo's `CLAUDE.md` policy — every commit step below assumes the user has confirmed committing is wanted. If unsure, stop and ask before running `git commit`.
- oxfmt/oxlint conventions: single quotes, trailing commas — match surrounding code exactly, don't run a formatter tool, just write in that style.

---

## Task 1: Add `Settings.disabledDomains` column

**Files:**
- Modify: `apps/api/prisma/schema.prisma:248-258` (the `Settings` model)
- Create: `apps/api/prisma/migrations/<timestamp>_settings_disabled_domains/migration.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `Settings.disabledDomains: string[]` (Prisma `String[] @default([])`), available on every `PrismaClient` `settings` query from Task 2 onward.

- [ ] **Step 1: Add the field to the schema**

Edit `apps/api/prisma/schema.prisma`, inside `model Settings`:

```prisma
model Settings {
  userId                     String    @id
  user                       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  obsidianVault               String?
  telegramChatId              String?
  timezone                    String    @default("UTC")
  digestHour                  Int?      @default(9)
  nudgeHour                   Int?      @default(20)
  telegramLinkToken           String?   @unique
  telegramLinkTokenExpiresAt  DateTime?
  disabledDomains              String[]  @default([])
}
```

(Match the existing file's alignment style exactly — don't introduce new whitespace conventions; the block above is illustrative of content, not column spacing.)

- [ ] **Step 2: Start Postgres if it isn't running**

Run: `docker compose up -d`
Expected: `terrain_pg` container is `Up` (check with `docker compose ps`).

- [ ] **Step 3: Generate the migration**

Run: `yarn workspace @terrain/api exec prisma migrate dev --name settings_disabled_domains`
Expected: Prisma reports a new migration applied, e.g. `Applying migration '<timestamp>_settings_disabled_domains'`, and regenerates the client. Verify the created `migration.sql` contains an `ALTER TABLE "Settings" ADD COLUMN "disabledDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];` statement (or equivalent Prisma-generated form).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat: add Settings.disabledDomains for pausing course scheduling"
```

---

## Task 2: `MetricsService` excludes disabled domains

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts`
- Modify: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Consumes: `Settings.disabledDomains` (Task 1).
- Produces: unchanged public signatures for `dueTopics`, `dueCards`, `sessionQueue`, `newCardsCount`, `nextUp`, `dashboard` — behavior only. Callers in `export-generator.service.ts` and `telegram.cron.ts` need no changes since none of them pass an explicit `domain` today, so the new exclusion applies to them automatically.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/metrics/metrics.service.spec.ts`, inside the `beforeEach` block, extend `prisma` with a `settings` mock (needed by every test from here on, since the new helper always calls it):

```ts
    prisma = {
      review: { findMany: jest.fn().mockResolvedValue([]) },
      topic: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      prompt: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      sessionExport: { findFirst: jest.fn().mockResolvedValue(null) },
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
```

Then add these new test cases (place them near their sibling tests — e.g. the disabled-domain `dueTopics` test right after the existing `'dueTopics scopes the query by user and domain when provided'` test):

```ts
  it('dueTopics excludes disabled domains when no explicit domain is given', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    await service.dueTopics('userA', new Date('2026-01-08T00:00:00Z'));
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domain: { notIn: ['DSA'] } }),
      }),
    );
  });

  it('dueTopics ignores disabledDomains when an explicit domain is given', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    await service.dueTopics('userA', new Date('2026-01-08T00:00:00Z'), 'DSA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domain: 'DSA' }),
      }),
    );
  });

  it('dueCards excludes disabled domains when no explicit domain is given', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['Web3'] });
    await service.dueCards('userA', new Date('2026-01-08T12:00:00Z'));
    expect(prisma.prompt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          topic: { userId: 'userA', status: { not: 'archived' }, domain: { notIn: ['Web3'] } },
        }),
      }),
    );
  });

  it('newCardsCount excludes disabled domains from both the startable-planned query and the count query', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    prisma.prompt.count.mockResolvedValue(2);
    const result = await service.newCardsCount('userA');
    expect(result).toBe(2);
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA', status: 'planned', domain: { notIn: ['DSA'] } },
      }),
    );
    expect(prisma.prompt.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ topic: { userId: 'userA', domain: { notIn: ['DSA'] } } }),
      }),
    );
  });

  it('nextUp excludes disabled domains from the candidate query', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    prisma.topic.findMany.mockResolvedValue([]);
    await service.nextUp('userA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA', status: 'planned', domain: { notIn: ['DSA'] } },
      }),
    );
  });

  it('sessionQueue excludes disabled domains from both the due and new-card queries', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    prisma.prompt.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'));
    expect(prisma.prompt.findMany.mock.calls[0][0].where.topic).toMatchObject({
      domain: { notIn: ['DSA'] },
    });
    expect(prisma.prompt.findMany.mock.calls[1][0].where.topic).toMatchObject({
      domain: { notIn: ['DSA'] },
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test metrics.service.spec.ts`
Expected: the six new tests FAIL (either `prisma.settings.findUnique` mock not called as expected, or `domain: { notIn: [...] }` not present in the actual `where`) — the other, unmodified tests should still PASS since the `settings` mock addition is inert until Step 3 wires it in.

- [ ] **Step 3: Implement the exclusion in `metrics.service.ts`**

Add two private helpers right after the `localDateKey` function (before the `@Injectable()` class, or as private methods on the class — add them as private methods, first two methods of the class body, before `topicLabels`):

```ts
  private async disabledDomains(userId: string): Promise<string[]> {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { disabledDomains: true },
    });
    return settings?.disabledDomains ?? [];
  }

  private domainFilter(
    domain: string | undefined,
    disabledDomains: string[],
  ): { domain?: string | { notIn: string[] } } {
    if (domain) return { domain };
    return disabledDomains.length ? { domain: { notIn: disabledDomains } } : {};
  }
```

Replace `dueTopics`:

```ts
  async dueTopics(
    userId: string,
    now: Date,
    domain?: string,
  ): Promise<{ overdue: Topic[]; dueToday: Topic[] }> {
    const disabled = await this.disabledDomains(userId);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    const active = await this.prisma.topic.findMany({
      where: {
        userId,
        status: 'active',
        nextReviewAt: { not: null, lt: endOfToday },
        ...this.domainFilter(domain, disabled),
      },
      orderBy: { nextReviewAt: 'asc' },
    });
    const overdue = active.filter((t) => t.nextReviewAt! < startOfToday);
    const dueToday = active.filter((t) => t.nextReviewAt! >= startOfToday);
    return { overdue, dueToday };
  }
```

Replace `dueCards`:

```ts
  async dueCards(userId: string, now: Date, domain?: string): Promise<Prompt[]> {
    const disabled = await this.disabledDomains(userId);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    return this.prisma.prompt.findMany({
      where: {
        suspended: false,
        nextReviewAt: { not: null, lt: endOfToday },
        topic: { userId, status: { not: 'archived' }, ...this.domainFilter(domain, disabled) },
      },
      orderBy: { nextReviewAt: 'asc' },
    });
  }
```

Replace `sessionQueue`:

```ts
  async sessionQueue(
    userId: string,
    now: Date,
    domain?: string,
  ): Promise<{ items: SessionQueueItem[]; estimatedMinutes: number }> {
    const disabled = await this.disabledDomains(userId);
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
          topic: { userId, status: { not: 'archived' }, ...this.domainFilter(domain, disabled) },
        },
        orderBy: { nextReviewAt: 'asc' },
        include: { topic: topicJoin },
      }),
      this.prisma.prompt.findMany({
        where: {
          suspended: false,
          state: 'new',
          topic: { userId, status: 'active', ...this.domainFilter(domain, disabled) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: NEW_CARDS_PER_SESSION,
        include: { topic: topicJoin },
      }),
    ]);
    const raw = [...due, ...fresh];
    const items = raw.map(
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
    return {
      items: interleaveQueue(items),
      estimatedMinutes: estimateMinutes(
        raw.map((p) => ({ promptKind: p.promptKind, estimatedMinutes: p.estimatedMinutes })),
      ),
    };
  }
```

Replace `startablePlannedIds` (private) — now takes the already-resolved `disabledDomains` instead of fetching it itself, so callers control when the settings lookup happens:

```ts
  private async startablePlannedIds(
    userId: string,
    domain: string | undefined,
    disabledDomains: string[],
  ): Promise<string[]> {
    const planned = await this.prisma.topic.findMany({
      where: { userId, status: 'planned', ...this.domainFilter(domain, disabledDomains) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        prerequisites: { select: { prerequisite: { select: { status: true } } } },
        children: { select: { id: true }, take: 1 },
      },
    });
    return planned
      .filter((t) => t.children.length === 0)
      .filter((t) =>
        t.prerequisites.every(
          (p) => p.prerequisite.status === 'active' || p.prerequisite.status === 'mastered',
        ),
      )
      .map((t) => t.id);
  }
```

Replace `newCardsCount`:

```ts
  async newCardsCount(userId: string, domain?: string): Promise<number> {
    const disabled = await this.disabledDomains(userId);
    const startableIds = await this.startablePlannedIds(userId, domain, disabled);
    return this.prisma.prompt.count({
      where: {
        suspended: false,
        state: 'new',
        topic: { userId, ...this.domainFilter(domain, disabled) },
        OR: [
          { topic: { status: { in: ['active', 'mastered'] } } },
          { topicId: { in: startableIds } },
        ],
      },
    });
  }
```

Replace `nextUp`:

```ts
  async nextUp(userId: string, domain?: string): Promise<NextUp | null> {
    const disabled = await this.disabledDomains(userId);
    const [firstId] = await this.startablePlannedIds(userId, domain, disabled);
    if (!firstId) return null;
    const topic = await this.prisma.topic.findFirst({ where: { id: firstId, userId } });
    if (!topic) return null;
    if (!topic.parentId) return { topic, chapterTitle: null, chapterProgress: null };
    const parent = await this.prisma.topic.findFirst({
      where: { id: topic.parentId, userId },
      select: { title: true, children: { select: { status: true } } },
    });
    if (!parent) return { topic, chapterTitle: null, chapterProgress: null };
    const started = parent.children.filter(
      (c) => c.status === 'active' || c.status === 'mastered',
    ).length;
    return {
      topic,
      chapterTitle: parent.title,
      chapterProgress: { started, total: parent.children.length },
    };
  }
```

`dashboard` and `struggleRatio7d`/`heatmap`/`pendingSessions` are unchanged — `dashboard`'s own `topic.groupBy` status counts stay unfiltered by design (they're inventory totals, not scheduling), and it already calls `dueTopics`/`newCardsCount`/`nextUp`/`sessionQueue`, which now exclude disabled domains internally.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test metrics.service.spec.ts`
Expected: all tests PASS, including the six new ones and every pre-existing test (the pre-existing ones still pass because `prisma.settings.findUnique` defaults to resolving `null`, so `disabledDomains` resolves to `[]`, and `domainFilter` then behaves exactly like the old inline `...(domain ? { domain } : {})`).

- [ ] **Step 5: Run the full API test suite**

Run: `yarn workspace @terrain/api test`
Expected: all suites PASS with no further changes needed. `telegram.cron.spec.ts` and `export-generator.service.spec.ts` both provide `MetricsService` as a fully mocked collaborator (`{ provide: MetricsService, useValue: metrics }` with `dueTopics`/`dueCards`/`nextUp`/`sessionQueue` as `jest.fn()`s) rather than a real instance touching `PrismaService.settings` — `export-generator.service.spec.ts` does construct one real `MetricsService` via `new MetricsService(prisma as any)`, but only to bind its synchronous `masteryStatus`/`topicLabels` methods, neither of which this task touches.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/metrics/metrics.service.ts apps/api/src/metrics/metrics.service.spec.ts
git commit -m "feat: exclude disabled domains from scheduling queries in MetricsService"
```

---

## Task 3: `CoursesService` — real `imported` flag + disable toggle

**Files:**
- Modify: `apps/api/src/courses/courses.service.ts`
- Modify: `apps/api/src/courses/courses.service.spec.ts`

**Interfaces:**
- Consumes: `Settings.disabledDomains` (Task 1), `COURSE_MANIFEST` (existing, `apps/api/src/courses/course-manifest.ts`).
- Produces: `CourseSummary` now includes `disabled: boolean`; new method `setDisabled(userId: string, courseId: string, disabled: boolean): Promise<CourseSummary>`. `CoursesController` (Task 4) calls this.

- [ ] **Step 1: Write the failing tests**

Replace the `CoursesService.list` describe block in `apps/api/src/courses/courses.service.spec.ts` (it currently asserts `imported` via a `courseImport.findMany` mock — that mock and assertion are being replaced by a `topic.count` based one), and add a new `CoursesService.setDisabled` describe block. Also extend the shared `build()` helper with `topic.count` and `settings` mocks:

```ts
function build(prismaOver: any = {}, importOver: any = {}) {
  const prisma: any = {
    courseImport: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    topic: {
      count: jest.fn().mockResolvedValue(0),
    },
    settings: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sessionExport: {
      create: jest.fn().mockResolvedValue({ id: 'exp-1' }),
    },
    ...prismaOver,
  };
  const importService: any = {
    apply: jest
      .fn()
      .mockResolvedValue({ topicsCreated: ['t1'], promptsCreated: 2, topicsActivated: 0 }),
    ...importOver,
  };
  return { prisma, importService };
}
```

Replace the `CoursesService.list` describe block:

```ts
describe('CoursesService.list', () => {
  it('computes imported from actual Topic rows per domain, not the CourseImport table', async () => {
    const { prisma, importService } = build({
      topic: {
        count: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.domain === 'DSA' ? 18 : 0),
        ),
      },
    });
    const service = await svc(prisma, importService);
    const courses = await service.list('u1');

    expect(courses).toHaveLength(2);
    const dsa = courses.find((c) => c.id === 'dsa')!;
    const web3 = courses.find((c) => c.id === 'web3')!;
    expect(dsa.domain).toBe('DSA');
    expect(dsa.imported).toBe(true); // topics exist even though no CourseImport row was ever written
    expect(dsa.topicCount).toBeGreaterThan(0);
    expect(web3.domain).toBe('Web3');
    expect(web3.imported).toBe(false);
    expect(web3.topicCount).toBeGreaterThan(0);
  });

  it('flags a course as disabled when its domain is in Settings.disabledDomains', async () => {
    const { prisma, importService } = build({
      settings: {
        findUnique: jest.fn().mockResolvedValue({ disabledDomains: ['DSA'] }),
        upsert: jest.fn(),
      },
    });
    const service = await svc(prisma, importService);
    const courses = await service.list('u1');

    expect(courses.find((c) => c.id === 'dsa')!.disabled).toBe(true);
    expect(courses.find((c) => c.id === 'web3')!.disabled).toBe(false);
  });
});

describe('CoursesService.setDisabled', () => {
  it('adds the course domain to Settings.disabledDomains when disabling', async () => {
    const { prisma, importService } = build({
      settings: {
        findUnique: jest.fn().mockResolvedValue({ disabledDomains: [] }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    const service = await svc(prisma, importService);

    const result = await service.setDisabled('u1', 'dsa', true);

    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', disabledDomains: ['DSA'] },
      update: { disabledDomains: ['DSA'] },
    });
    expect(result.disabled).toBe(true);
    expect(result.id).toBe('dsa');
  });

  it('removes the course domain from Settings.disabledDomains when enabling, preserving other disabled domains', async () => {
    const { prisma, importService } = build({
      settings: {
        findUnique: jest.fn().mockResolvedValue({ disabledDomains: ['DSA', 'Other'] }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    const service = await svc(prisma, importService);

    const result = await service.setDisabled('u1', 'dsa', false);

    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', disabledDomains: ['Other'] },
      update: { disabledDomains: ['Other'] },
    });
    expect(result.disabled).toBe(false);
  });

  it('throws NotFoundException for an unknown course id', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);
    await expect(service.setDisabled('u1', 'nope', true)).rejects.toThrow(NotFoundException);
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });
});
```

The `CoursesService.importCourse` describe block is untouched — leave its `courseImport.findFirst`/`upsert` assertions as-is (that logic doesn't change), but note it now relies on `build()`'s updated defaults above, which already keep `courseImport.findFirst` resolving `null` by default.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test courses.service.spec.ts`
Expected: FAIL — `service.setDisabled is not a function`, and the `list` tests fail because `imported` is still computed from `courseImport.findMany` (which no longer exists on the mock).

- [ ] **Step 3: Implement in `courses.service.ts`**

Replace the full file:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ImportService } from '../import/import.service';
import { COURSE_MANIFEST, type CourseManifestEntry } from './course-manifest';
import { CONTENT_DIR } from './content-dir';

export interface CourseSummary {
  id: string;
  domain: string;
  title: string;
  description: string;
  topicCount: number;
  imported: boolean;
  disabled: boolean;
}

export interface CourseImportSummary {
  topicsCreated: number;
  promptsCreated: number;
  topicsActivated: number;
}

@Injectable()
export class CoursesService {
  constructor(
    private prisma: PrismaService,
    private importService: ImportService,
  ) {}

  private findEntry(courseId: string): CourseManifestEntry {
    const entry = COURSE_MANIFEST.find((c) => c.id === courseId);
    if (!entry) throw new NotFoundException(`Unknown course: ${courseId}`);
    return entry;
  }

  private async readDoc(file: string): Promise<Record<string, unknown>> {
    const text = await readFile(join(CONTENT_DIR, file), 'utf-8');
    return JSON.parse(text);
  }

  private async topicCount(entry: CourseManifestEntry): Promise<number> {
    let total = 0;
    for (const file of entry.files) {
      const doc = await this.readDoc(file);
      const topics = doc.proposedTopics;
      total += Array.isArray(topics) ? topics.length : 0;
    }
    return total;
  }

  private async disabledDomains(userId: string): Promise<Set<string>> {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { disabledDomains: true },
    });
    return new Set(settings?.disabledDomains ?? []);
  }

  /** `imported` is derived from actual Topic rows for the course's domain, not
   *  the CourseImport tracking table — topics seeded outside the Courses UI
   *  import flow (e.g. via a script) would otherwise show as not-imported. */
  private async toSummary(
    userId: string,
    entry: CourseManifestEntry,
    disabledDomains: Set<string>,
  ): Promise<CourseSummary> {
    const [topicCount, importedCount] = await Promise.all([
      this.topicCount(entry),
      this.prisma.topic.count({ where: { userId, domain: entry.domain } }),
    ]);
    return {
      id: entry.id,
      domain: entry.domain,
      title: entry.title,
      description: entry.description,
      topicCount,
      imported: importedCount > 0,
      disabled: disabledDomains.has(entry.domain),
    };
  }

  async list(userId: string): Promise<CourseSummary[]> {
    const disabledDomains = await this.disabledDomains(userId);
    return Promise.all(
      COURSE_MANIFEST.map((entry) => this.toSummary(userId, entry, disabledDomains)),
    );
  }

  async setDisabled(userId: string, courseId: string, disabled: boolean): Promise<CourseSummary> {
    const entry = this.findEntry(courseId);
    const domains = await this.disabledDomains(userId);
    if (disabled) domains.add(entry.domain);
    else domains.delete(entry.domain);
    const disabledDomains = [...domains];
    await this.prisma.settings.upsert({
      where: { userId },
      create: { userId, disabledDomains },
      update: { disabledDomains },
    });
    return this.toSummary(userId, entry, domains);
  }

  async importCourse(userId: string, courseId: string): Promise<CourseImportSummary> {
    const entry = this.findEntry(courseId);
    const summary: CourseImportSummary = {
      topicsCreated: 0,
      promptsCreated: 0,
      topicsActivated: 0,
    };

    const existing = await this.prisma.courseImport.findFirst({
      where: { userId, courseId },
    });
    if (existing) {
      return summary;
    }

    for (const file of entry.files) {
      const doc = await this.readDoc(file);
      const exp = await this.prisma.sessionExport.create({
        data: { mode: 'full', exportMd: `Prepared course import: ${entry.id}/${file}`, userId },
      });
      const raw = '```learning-os\n' + JSON.stringify({ ...doc, sessionId: exp.id }) + '\n```';
      const result = await this.importService.apply(userId, raw);
      summary.topicsCreated += result.topicsCreated.length;
      summary.promptsCreated += result.promptsCreated;
      summary.topicsActivated += result.topicsActivated;
    }

    await this.prisma.courseImport.upsert({
      where: { userId_courseId: { userId, courseId } },
      update: { importedAt: new Date() },
      create: { userId, courseId },
    });

    return summary;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test courses.service.spec.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/courses/courses.service.ts apps/api/src/courses/courses.service.spec.ts
git commit -m "feat: derive Course.imported from Topic rows, add setDisabled"
```

---

## Task 4: `CoursesController` PATCH endpoint

**Files:**
- Create: `apps/api/src/courses/dto.ts`
- Modify: `apps/api/src/courses/courses.controller.ts`

**Interfaces:**
- Consumes: `CoursesService.setDisabled` (Task 3).
- Produces: `PATCH /courses/:id/disabled` with body `{ disabled: boolean }`, returning the updated `CourseSummary` as JSON — consumed by the web client in Task 5.

- [ ] **Step 1: Create the DTO**

Create `apps/api/src/courses/dto.ts`:

```ts
import { IsBoolean } from 'class-validator';

export class SetCourseDisabledDto {
  @IsBoolean() disabled!: boolean;
}
```

- [ ] **Step 2: Add the endpoint**

Replace `apps/api/src/courses/courses.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SetCourseDisabledDto } from './dto';

@Controller('courses')
export class CoursesController {
  constructor(private service: CoursesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.service.list(userId);
  }

  @Post(':id/import')
  import(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.service.importCourse(userId, id);
  }

  @Patch(':id/disabled')
  setDisabled(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetCourseDisabledDto,
  ) {
    return this.service.setDisabled(userId, id, dto.disabled);
  }
}
```

- [ ] **Step 3: Run the API build to catch type errors**

Run: `yarn workspace @terrain/api build`
Expected: builds cleanly, no TypeScript errors.

- [ ] **Step 4: Manual smoke check**

With `docker compose up -d`, `yarn workspace @terrain/api start` running, and a logged-in session cookie (or via an already-authenticated browser hitting the dev API):

```bash
curl -i -X PATCH http://localhost:3000/courses/dsa/disabled \
  -H 'Content-Type: application/json' \
  -b '<your session cookie>' \
  -d '{"disabled": true}'
```

Expected: `200 OK` with a JSON body including `"disabled":true`. (Skip this step if there's no convenient way to get a session cookie in this environment — Task 7's UI smoke test covers the same path end-to-end.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/courses/dto.ts apps/api/src/courses/courses.controller.ts
git commit -m "feat: add PATCH /courses/:id/disabled endpoint"
```

---

## Task 5: Web API layer — types, client, hooks

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/hooks.ts`

**Interfaces:**
- Consumes: `PATCH /courses/:id/disabled` (Task 4).
- Produces: `Course.disabled: boolean`; `api.setCourseDisabled(id: string, disabled: boolean): Promise<Course>`; `useSetCourseDisabled(): UseMutationResult` with `mutate({ id, disabled })` — consumed by the Courses screen in Task 7.

- [ ] **Step 1: Add `disabled` to the `Course` type**

In `apps/web/src/api/types.ts`, update the `Course` interface (around line 366):

```ts
export interface Course {
  id: string;
  domain: string;
  title: string;
  description: string;
  topicCount: number;
  imported: boolean;
  disabled: boolean;
}
```

- [ ] **Step 2: Add the client method**

In `apps/web/src/api/client.ts`, replace the `// prepared courses` block:

```ts
  // prepared courses
  getCourses: () => req<Course[]>('/courses'),
  importCourse: (id: string) =>
    req<CourseImportSummary>(`/courses/${id}/import`, { method: 'POST' }),
  setCourseDisabled: (id: string, disabled: boolean) =>
    req<Course>(`/courses/${id}/disabled`, { method: 'PATCH', ...json({ disabled }) }),
```

- [ ] **Step 3: Add the hook**

In `apps/web/src/api/hooks.ts`, replace `useImportCourse` and the block after it:

```ts
export function useImportCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.importCourse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}

export function useSetCourseDisabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      api.setCourseDisabled(id, disabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.courses });
      // disabling/enabling a course changes what's due/next-up/queued
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
```

- [ ] **Step 4: Run the web build to catch type errors**

Run: `yarn workspace @terrain/web build`
Expected: builds cleanly (this runs `tsc --noEmit` first, per this repo's build script) — no TypeScript errors. This is the real check for `recharts`' transitive `react-is` resolution too, per this repo's tooling notes, even though this change doesn't touch recharts.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/types.ts apps/web/src/api/client.ts apps/web/src/api/hooks.ts
git commit -m "feat: add web API layer for course disable/enable"
```

---

## Task 6: `buttonState.ts` — pause/resume button state

**Files:**
- Modify: `apps/web/src/screens/Courses/buttonState.ts`
- Modify: `apps/web/src/screens/Courses/buttonState.test.ts`

**Interfaces:**
- Consumes: `Course.disabled` (Task 5).
- Produces: `CourseDisableButtonState = 'pause' | 'pausing' | 'resume' | 'resuming'`; `courseDisableButtonState(course: { disabled: boolean }, isPending: boolean): CourseDisableButtonState` — consumed by the Courses screen in Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/screens/Courses/buttonState.test.ts`:

```ts
import { courseButtonState, courseDisableButtonState } from './buttonState';

describe('courseDisableButtonState', () => {
  it('returns "pause" when enabled and not pending', () => {
    expect(courseDisableButtonState({ disabled: false }, false)).toBe('pause');
  });

  it('returns "resume" when disabled and not pending', () => {
    expect(courseDisableButtonState({ disabled: true }, false)).toBe('resume');
  });

  it('returns "pausing" when currently enabled and a toggle is pending (heading toward disabled)', () => {
    expect(courseDisableButtonState({ disabled: false }, true)).toBe('pausing');
  });

  it('returns "resuming" when currently disabled and a toggle is pending (heading toward enabled)', () => {
    expect(courseDisableButtonState({ disabled: true }, true)).toBe('resuming');
  });
});
```

(Replace only the `import` line at the top of the file — `courseButtonState` stays imported since the existing `describe('courseButtonState', ...)` block above it is untouched.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @terrain/web test buttonState.test.ts`
Expected: FAIL — `courseDisableButtonState is not a function` / import error.

- [ ] **Step 3: Implement in `buttonState.ts`**

Replace `apps/web/src/screens/Courses/buttonState.ts`:

```ts
export type CourseButtonState = 'import' | 'importing' | 'added';

export function courseButtonState(
  course: { imported: boolean },
  isPending: boolean,
): CourseButtonState {
  if (isPending) return 'importing';
  return course.imported ? 'added' : 'import';
}

export type CourseDisableButtonState = 'pause' | 'pausing' | 'resume' | 'resuming';

/** `course.disabled` reflects the pre-mutation (server) state, so while a
 *  toggle is pending it still tells us which direction the toggle is going. */
export function courseDisableButtonState(
  course: { disabled: boolean },
  isPending: boolean,
): CourseDisableButtonState {
  if (isPending) return course.disabled ? 'resuming' : 'pausing';
  return course.disabled ? 'resume' : 'pause';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @terrain/web test buttonState.test.ts`
Expected: all tests PASS, including the pre-existing `courseButtonState` ones.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/screens/Courses/buttonState.ts apps/web/src/screens/Courses/buttonState.test.ts
git commit -m "feat: add courseDisableButtonState for course pause/resume UI"
```

---

## Task 7: Courses screen — Pause/Resume control

**Files:**
- Modify: `apps/web/src/screens/Courses/index.tsx`

**Interfaces:**
- Consumes: `useSetCourseDisabled` (Task 5), `courseDisableButtonState` (Task 6).

- [ ] **Step 1: Implement the UI**

Replace `apps/web/src/screens/Courses/index.tsx`:

```tsx
import { useCourses, useImportCourse, useSetCourseDisabled } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { Course } from '../../api/types';
import { courseButtonState, courseDisableButtonState } from './buttonState';

function CourseCard({ course }: { course: Course }) {
  const { toast } = useToast();
  const importCourse = useImportCourse();
  const setDisabled = useSetCourseDisabled();
  const isImportPending = importCourse.isPending && importCourse.variables === course.id;
  const importState = courseButtonState(course, isImportPending);
  const isTogglePending = setDisabled.isPending && setDisabled.variables?.id === course.id;
  const toggleState = courseDisableButtonState(course, isTogglePending);

  const onImport = () => {
    importCourse.mutate(course.id, {
      onSuccess: (summary) =>
        toast(
          `${course.title}: ${summary.topicsCreated} topics, ${summary.promptsCreated} cards added`,
          'success',
        ),
      onError: (e) => toast(e instanceof Error ? e.message : 'Import failed', 'error'),
    });
  };

  const onToggleDisabled = () => {
    const next = !course.disabled;
    setDisabled.mutate(
      { id: course.id, disabled: next },
      {
        onSuccess: () => toast(`${course.title} ${next ? 'paused' : 'resumed'}`, 'success'),
        onError: (e) => toast(e instanceof Error ? e.message : 'Update failed', 'error'),
      },
    );
  };

  return (
    <Card title={course.title} actions={<span className="pill">{course.domain}</span>}>
      <p className="muted">{course.description}</p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted">{course.topicCount} topics</span>
        <div className="row gap-2">
          {course.imported && (
            <button
              className="btn btn-ghost"
              disabled={toggleState === 'pausing' || toggleState === 'resuming'}
              onClick={onToggleDisabled}
            >
              {(toggleState === 'pausing' || toggleState === 'resuming') && <Spinner />}
              {toggleState === 'pause' && 'Pause'}
              {toggleState === 'resume' && 'Resume'}
              {toggleState === 'pausing' && 'Pausing…'}
              {toggleState === 'resuming' && 'Resuming…'}
            </button>
          )}
          <button
            className={importState === 'added' ? 'btn btn-ghost' : 'btn btn-primary'}
            disabled={importState !== 'import'}
            onClick={onImport}
          >
            {importState === 'importing' && <Spinner />}
            {importState === 'import' && 'Import'}
            {importState === 'importing' && 'Importing…'}
            {importState === 'added' && 'Added'}
          </button>
        </div>
      </div>
    </Card>
  );
}

export default function CoursesScreen() {
  const { data: courses, isLoading, error } = useCourses();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="col gap-3">
      <h1>Courses</h1>
      <p className="muted">
        Pre-authored curricula you can import into your own roadmap with one click.
      </p>
      <div className="col gap-3">
        {(courses ?? []).map((c) => (
          <CourseCard key={c.id} course={c} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the web build**

Run: `yarn workspace @terrain/web build`
Expected: builds cleanly, no TypeScript errors.

- [ ] **Step 3: Manual UI smoke test**

Per this repo's `docs/ops/local-dev.md` runbook:

```bash
docker compose up -d
yarn build
yarn workspace @terrain/api start &
yarn workspace @terrain/web dev &
```

Then drive it via the headless-Brave CDP script (`scripts/smoke.mjs`) or a real browser at `http://localhost:5180`:
1. Log in, navigate to the Courses screen.
2. Confirm DSA shows `imported: true`-driven state (an "Added" import button, since it already has topics) even though it was never imported through this UI — this is the bug fix from Task 3 landing visibly.
3. Click "Pause" on DSA. Confirm the button flips to "Resume" after the mutation resolves, and a success toast appears.
4. Navigate to the Dashboard / Next Up — confirm no DSA topics appear in due/next-up while paused (only Web3, if you've imported it).
5. Click "Resume" on DSA. Confirm DSA topics reappear in Dashboard/Next Up.

Stop the dev API afterward per `CLAUDE.md`: `kill -9 $(lsof -ti:3000)` (not `pkill -f "nest start"`, which doesn't reach the spawned child process).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/screens/Courses/index.tsx
git commit -m "feat: add Pause/Resume control to the Courses screen"
```

---

## Post-plan verification

- [ ] Run the full test suite once more end to end: `yarn test` (root, runs every workspace).
- [ ] Run `yarn lint` — oxlint across the whole tree.
- [ ] Re-read the spec (`docs/superpowers/specs/2026-07-07-course-disable-design.md`) against the final diff to confirm every goal is met: pausing hides a course from every scheduling surface, resuming is lossless, and `imported` reflects real DB state.
