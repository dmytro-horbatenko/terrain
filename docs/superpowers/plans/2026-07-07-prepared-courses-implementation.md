# Prepared Courses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user browse the two prepared courses (DSA, Web3) on a new `/courses` screen and import a whole course into their own account with one click, showing an "Added" state once done.

**Architecture:** A static course manifest in `apps/api` maps each course to its ordered `content/<domain>/*.json` files. A new `CoursesService` reuses the existing `ImportService.preview()`/`apply()` pipeline in-process (one `SessionExport` + `apply()` call per file, looped server-side) instead of the manual paste-JSON screen, and records completion in a new `CourseImport` table. The web app gets a new screen, API client methods, and react-query hooks, following the exact patterns already used by the Import screen.

**Tech Stack:** NestJS 11, Prisma 7 (driver-adapter, Postgres), Jest (`apps/api`), React 19, TanStack Router, react-query, Vitest (`apps/web`, no DOM/testing-library configured — see Global Constraints).

## Global Constraints

- Monorepo is CommonJS for `apps/api` (`"module": "commonjs"` in `apps/api/tsconfig.json`) — no ESM-only syntax (`import.meta.dirname`) in API code.
- Prisma model IDs use `@default(uuid())`, not `cuid()` — match existing convention (every model in `apps/api/prisma/schema.prisma` uses `uuid()`).
- No new module needs to import `PrismaModule` — it's `@Global()` (`apps/api/src/prisma/prisma.module.ts`) and `PrismaService` can be injected anywhere via constructor.
- Auth: no per-route guard decorators exist anywhere in `apps/api/src` — a global mechanism already populates `req.userId`, read via `@CurrentUser()` (`apps/api/src/auth/current-user.decorator.ts`). New controllers need no extra guard wiring.
- `apps/web` has **no `@testing-library/react` or `jsdom`** installed, and no `vitest` `test.environment` config exists (`apps/web/vite.config.ts` has no `test` block). Existing web tests are pure-logic unit tests with no DOM rendering (e.g. `apps/web/src/screens/Roadmap/projection.test.ts`, `apps/web/src/screens/Session/initialStep.test.ts`). This plan follows that convention: UI logic that needs a test (the Import/Importing/Added button state) is extracted into a plain exported function and unit-tested the same way — no component rendering tests are added, since standing up RTL/jsdom is out of scope for this feature.
- Content files live at `content/dsa/*.json` (18 files) and `content/web3/*.json` (17 files, excluding `content/web3/coverage.json` which is not a `learning-os` document).
- No git commits happen automatically per `CLAUDE.md` — but this plan's steps include `git commit` per the writing-plans task template; follow them as written (the user has already asked to implement, i.e. proceed with commits as part of TDD steps, matching how work already committed in this session, e.g. the design spec commit).

---

### Task 1: `CourseImport` Prisma model + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma model `CourseImport { id, userId, courseId, importedAt }` with compound unique `userId_courseId`, queryable via `prisma.courseImport.findMany(...)` / `prisma.courseImport.upsert({ where: { userId_courseId: { userId, courseId } }, ... })`.

- [ ] **Step 1: Add the `courseImports` back-relation to `User` and the `CourseImport` model**

In `apps/api/prisma/schema.prisma`, add `courseImports CourseImport[]` to the `User` model's field list (after `topicTypes     TopicType[]` on line 90):

```prisma
model User {
  id             String             @id @default(uuid())
  email          String             @unique
  passwordHash   String
  name           String
  headline       String?
  learningStyle  String?
  codeStyle      String?
  noteSystem     String?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt
  topics         Topic[]
  reviews        Review[]
  appEvents      ApplicationEvent[]
  sessionExports SessionExport[]
  streakState    StreakState?
  settings       Settings?
  dailyLogs      DailyLog[]
  topicTypes     TopicType[]
  courseImports  CourseImport[]
}
```

Then append a new model at the end of the file (after the closing `}` of `Settings`, currently line 257):

```prisma

model CourseImport {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  courseId   String
  importedAt DateTime @default(now())

  @@unique([userId, courseId])
}
```

- [ ] **Step 2: Generate and apply the migration**

Requires Postgres running (`docker compose up -d`). Run:

```bash
docker compose up -d
yarn workspace @terrain/api exec prisma migrate dev --name course_import
```

Expected: prompts create a new folder under `apps/api/prisma/migrations/<timestamp>_course_import/migration.sql` containing `CREATE TABLE "CourseImport" (...)` and a unique index on `("userId","courseId")`, applies it to the local DB, and regenerates the Prisma client (no errors printed).

- [ ] **Step 3: Verify the client picks up the new model**

Run:

```bash
yarn workspace @terrain/api exec tsc --noEmit -p tsconfig.build.json
```

Expected: no errors (this doesn't reference `CourseImport` yet, just confirms the generated client compiles cleanly after the migration).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): add CourseImport model for prepared-course tracking"
```

---

### Task 2: Course manifest + content directory resolution + Dockerfile

**Files:**
- Create: `apps/api/src/courses/content-dir.ts`
- Create: `apps/api/src/courses/course-manifest.ts`
- Modify: `apps/api/Dockerfile`

**Interfaces:**
- Produces: `CONTENT_DIR: string` (absolute path to the repo's `content/` directory), `COURSE_MANIFEST: CourseManifestEntry[]`, `CourseManifestEntry { id: string; domain: string; title: string; description: string; files: string[] }` (each `files` entry is a path relative to `CONTENT_DIR`, e.g. `'dsa/01-arrays-hashing.json'`).
- Consumes: nothing (leaf files).

- [ ] **Step 1: Write `content-dir.ts`**

```ts
import { resolve } from 'path';

// process.cwd() is the workspace package directory (apps/api) in every
// context this runs in: `yarn workspace @terrain/api start` (dev),
// `yarn workspace @terrain/api test` (jest), and the prod Docker image
// (WORKDIR /workspace/apps/api). __dirname is NOT safe here — it points at
// apps/api/dist/src/courses when compiled but apps/api/src/courses under
// ts-jest, two different nesting depths from the repo root.
export const CONTENT_DIR = process.env.CONTENT_DIR ?? resolve(process.cwd(), '..', '..', 'content');
```

- [ ] **Step 2: Write `course-manifest.ts`**

```ts
export interface CourseManifestEntry {
  id: string;
  domain: string;
  title: string;
  description: string;
  files: string[];
}

export const COURSE_MANIFEST: CourseManifestEntry[] = [
  {
    id: 'dsa',
    domain: 'DSA',
    title: 'Data Structures & Algorithms',
    description:
      'Root of the DSA learning path. Structure: NeetCode roadmap category order, each split into reviewable sub-patterns (the actual scheduling unit), each with curated problems from NeetCode 150 / Blind 75. Prereq edges follow real conceptual dependency, not just roadmap position. Study one sub-pattern at a time; drill into individual problems only when reviewing that sub-pattern.',
    files: [
      'dsa/01-arrays-hashing.json',
      'dsa/02-two-pointers.json',
      'dsa/03-sliding-window.json',
      'dsa/04-stack.json',
      'dsa/05-binary-search.json',
      'dsa/06-linked-list.json',
      'dsa/07-trees.json',
      'dsa/08-tries.json',
      'dsa/09-heap-priority-queue.json',
      'dsa/10-graphs.json',
      'dsa/11-backtracking.json',
      'dsa/12-advanced-graphs.json',
      'dsa/13-1d-dynamic-programming.json',
      'dsa/14-2d-dynamic-programming.json',
      'dsa/15-greedy.json',
      'dsa/16-intervals.json',
      'dsa/17-math-geometry.json',
      'dsa/18-bit-manipulation.json',
    ],
  },
  {
    id: 'web3',
    domain: 'Web3',
    title: 'Web3 / Solidity / DeFi',
    description:
      'Root of the Web3 learning path: fundamentals → Solidity → tooling → standards → gas → security → DeFi → EVM internals → frontier → full-stack. Code-first — every leaf has a Build task in the web3-practice repo and a Done-when gate; security threads from Phase 4 and is exhaustive in Phase 6. Study one leaf at a time.',
    files: [
      'web3/00-root.json',
      'web3/01-fundamentals.json',
      'web3/02a-solidity.json',
      'web3/02b-solidity.json',
      'web3/03-tooling.json',
      'web3/04a-standards.json',
      'web3/04b-standards.json',
      'web3/05-gas.json',
      'web3/06a-security-methodology.json',
      'web3/06b-attacks.json',
      'web3/06c-attacks.json',
      'web3/06d-wargames.json',
      'web3/07a-defi.json',
      'web3/07b-defi.json',
      'web3/08-evm-internals.json',
      'web3/09-frontier.json',
      'web3/10-fullstack.json',
    ],
  },
];
```

- [ ] **Step 3: Update the Dockerfile to ship `content/` in the runtime image**

In `apps/api/Dockerfile`, insert a new line directly after the existing `COPY --from=build /workspace/apps/api/prisma ./apps/api/prisma` line and before the `USER node` line:

```dockerfile
COPY --from=build /workspace/content ./content
```

This runs while `WORKDIR` is still `/workspace` (set once in the `base` stage), so it lands at `/workspace/content` — a sibling of `/workspace/apps/api`, matching `CONTENT_DIR`'s `resolve(process.cwd(), '..', '..', 'content')` when `process.cwd()` is `/workspace/apps/api` at runtime.

- [ ] **Step 4: Verify content loads from both entries**

Run:

```bash
node -e "const {COURSE_MANIFEST} = require('./apps/api/src/courses/course-manifest.ts')" 2>/dev/null; \
cd apps/api && node -e "
const { resolve } = require('path');
const { readFileSync } = require('fs');
const dir = resolve(process.cwd(), '..', '..', 'content');
console.log(readFileSync(resolve(dir, 'dsa/01-arrays-hashing.json'), 'utf-8').slice(0, 40));
console.log(readFileSync(resolve(dir, 'web3/00-root.json'), 'utf-8').slice(0, 40));
"
```

Expected: both `console.log` calls print the start of valid JSON (`{\n  "version": 2,...`), confirming the `process.cwd()`-relative path resolves correctly when run from `apps/api` (mirroring dev/test/prod `cwd`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/courses/content-dir.ts apps/api/src/courses/course-manifest.ts apps/api/Dockerfile
git commit -m "feat(api): add prepared-course manifest and content directory resolution"
```

---

### Task 3: `CoursesService` — list + import, with unit tests

**Files:**
- Create: `apps/api/src/courses/courses.service.ts`
- Create: `apps/api/src/courses/courses.service.spec.ts`
- Modify: `apps/api/src/import/import.module.ts` (export `ImportService`)

**Interfaces:**
- Consumes: `CONTENT_DIR` and `COURSE_MANIFEST`/`CourseManifestEntry` from Task 2; `PrismaService` (`apps/api/src/prisma/prisma.service.ts`); `ImportService.apply(userId: string, raw: string): Promise<ImportResult>` where `ImportResult = { sessionExportId: string; reviewsApplied: number; topicsCreated: string[]; promptsCreated: number; noteSummariesApplied: number; appEventsApplied: number; topicsActivated: number; nextSessionStored: boolean }` (`apps/api/src/import/import.service.ts:161-170`).
- Produces: `CourseSummary { id: string; domain: string; title: string; description: string; topicCount: number; imported: boolean }`, `CourseImportSummary { topicsCreated: number; promptsCreated: number; topicsActivated: number }`, `CoursesService.list(userId: string): Promise<CourseSummary[]>`, `CoursesService.importCourse(userId: string, courseId: string): Promise<CourseImportSummary>` (throws `NotFoundException` for an unknown `courseId`).

- [ ] **Step 1: Export `ImportService` from `ImportModule`**

In `apps/api/src/import/import.module.ts`, change:

```ts
@Module({
  providers: [ImportService],
  controllers: [ImportController],
})
export class ImportModule {}
```

to:

```ts
@Module({
  providers: [ImportService],
  controllers: [ImportController],
  exports: [ImportService],
})
export class ImportModule {}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/courses/courses.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImportService } from '../import/import.service';
import { CoursesService } from './courses.service';

function build(prismaOver: any = {}, importOver: any = {}) {
  const prisma: any = {
    courseImport: {
      findMany: jest.fn().mockResolvedValue([]),
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

async function svc(prisma: any, importService: any): Promise<CoursesService> {
  const mod = await Test.createTestingModule({
    providers: [
      CoursesService,
      { provide: PrismaService, useValue: prisma },
      { provide: ImportService, useValue: importService },
    ],
  }).compile();
  return mod.get(CoursesService);
}

describe('CoursesService.list', () => {
  it('returns both manifest courses with topicCount and imported flags', async () => {
    const { prisma, importService } = build({
      courseImport: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', courseId: 'dsa' }]),
        upsert: jest.fn(),
      },
    });
    const service = await svc(prisma, importService);
    const courses = await service.list('u1');

    expect(courses).toHaveLength(2);
    const dsa = courses.find((c) => c.id === 'dsa')!;
    const web3 = courses.find((c) => c.id === 'web3')!;
    expect(dsa.domain).toBe('DSA');
    expect(dsa.imported).toBe(true);
    expect(dsa.topicCount).toBeGreaterThan(0);
    expect(web3.domain).toBe('Web3');
    expect(web3.imported).toBe(false);
    expect(web3.topicCount).toBeGreaterThan(0);
  });
});

describe('CoursesService.importCourse', () => {
  it('calls ImportService.apply once per file, sums the totals, and upserts CourseImport', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);

    const summary = await service.importCourse('u1', 'dsa');

    expect(importService.apply).toHaveBeenCalledTimes(18); // content/dsa has 18 files
    expect(prisma.sessionExport.create).toHaveBeenCalledTimes(18);
    expect(summary.topicsCreated).toBe(18); // 1 topic per apply() call in this mock
    expect(summary.promptsCreated).toBe(36); // 2 per apply() call
    expect(prisma.courseImport.upsert).toHaveBeenCalledWith({
      where: { userId_courseId: { userId: 'u1', courseId: 'dsa' } },
      update: expect.objectContaining({ importedAt: expect.any(Date) }),
      create: { userId: 'u1', courseId: 'dsa' },
    });
  });

  it('throws NotFoundException for an unknown course id', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);
    await expect(service.importCourse('u1', 'nope')).rejects.toThrow(NotFoundException);
    expect(importService.apply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn workspace @terrain/api test courses.service.spec.ts`
Expected: FAIL — `Cannot find module './courses.service'`.

- [ ] **Step 4: Write `courses.service.ts`**

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

  async list(userId: string): Promise<CourseSummary[]> {
    const imports = await this.prisma.courseImport.findMany({ where: { userId } });
    const importedIds = new Set(imports.map((i) => i.courseId));
    return Promise.all(
      COURSE_MANIFEST.map(async (entry) => ({
        id: entry.id,
        domain: entry.domain,
        title: entry.title,
        description: entry.description,
        topicCount: await this.topicCount(entry),
        imported: importedIds.has(entry.id),
      })),
    );
  }

  async importCourse(userId: string, courseId: string): Promise<CourseImportSummary> {
    const entry = this.findEntry(courseId);
    const summary: CourseImportSummary = { topicsCreated: 0, promptsCreated: 0, topicsActivated: 0 };

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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @terrain/api test courses.service.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/courses/courses.service.ts apps/api/src/courses/courses.service.spec.ts apps/api/src/import/import.module.ts
git commit -m "feat(api): add CoursesService to list and import prepared courses"
```

---

### Task 4: `CoursesController` + `CoursesModule` wiring

**Files:**
- Create: `apps/api/src/courses/courses.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/src/courses/courses.module.ts`

**Interfaces:**
- Consumes: `CoursesService.list`/`importCourse` from Task 3, `CurrentUser` decorator (`apps/api/src/auth/current-user.decorator.ts`, `@CurrentUser() userId: string`).
- Produces: `GET /courses` → `CourseSummary[]`, `POST /courses/:id/import` → `CourseImportSummary`.

- [ ] **Step 1: Write `courses.controller.ts`**

```ts
import { Controller, Get, Param, Post } from '@nestjs/common';
import { CoursesService } from './courses.service';
import { CurrentUser } from '../auth/current-user.decorator';

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
}
```

- [ ] **Step 2: Write `courses.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { ImportModule } from '../import/import.module';

@Module({
  imports: [ImportModule],
  controllers: [CoursesController],
  providers: [CoursesService],
})
export class CoursesModule {}
```

- [ ] **Step 3: Register `CoursesModule` in `app.module.ts`**

In `apps/api/src/app.module.ts`, add the import to both the `import` statement list and the `imports` array (matching the existing `TopicTypesModule` entry style):

```ts
import { CoursesModule } from './courses/courses.module';
```

```ts
imports: [
  ThrottlerModule.forRoot([...]),
  ScheduleModule.forRoot(),
  PrismaModule,
  AuthModule,
  TopicsModule,
  ReviewsModule,
  PromptsModule,
  MetricsModule,
  StreakModule,
  SessionsModule,
  ImportModule,
  TopicTypesModule,
  SettingsModule,
  TelegramModule,
  CoursesModule,
],
```

- [ ] **Step 4: Build to verify wiring compiles**

Run: `yarn workspace @terrain/api build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Manual smoke test against a running API**

```bash
docker compose up -d
yarn workspace @terrain/api start &
sleep 3
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dm.gorbatenko@gmail.com","password":"<your local password>"}' >/dev/null
curl -s -b /tmp/cookies.txt http://localhost:3000/courses | head -c 500
```

Expected: JSON array of 2 objects with `id`, `domain`, `title`, `description`, `topicCount`, `imported` (`dsa` likely `imported: true` already, `web3` likely `imported: false` — matches `.superpowers/sdd/progress.md`'s note that DSA was already imported for this account outside this feature). Stop the server after: `kill -9 $(lsof -ti:3000)`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/courses/courses.controller.ts apps/api/src/courses/courses.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): wire up /courses endpoints"
```

---

### Task 5: Web API types, client methods, and hooks

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/hooks.ts`

**Interfaces:**
- Produces: `Course { id: string; domain: string; title: string; description: string; topicCount: number; imported: boolean }`, `CourseImportSummary { topicsCreated: number; promptsCreated: number; topicsActivated: number }`, `api.getCourses(): Promise<Course[]>`, `api.importCourse(id: string): Promise<CourseImportSummary>`, `useCourses()` (react-query `useQuery`), `useImportCourse()` (react-query `useMutation`, invalidates `qk.courses` on success).

- [ ] **Step 1: Add types**

In `apps/web/src/api/types.ts`, add near the `ImportPlan`/`ImportResult` types (after line 362):

```ts
export interface Course {
  id: string;
  domain: string;
  title: string;
  description: string;
  topicCount: number;
  imported: boolean;
}

export interface CourseImportSummary {
  topicsCreated: number;
  promptsCreated: number;
  topicsActivated: number;
}
```

- [ ] **Step 2: Add client methods**

In `apps/web/src/api/client.ts`, add near the existing `importPreview`/`importApply` entries:

```ts
getCourses: () => req<Course[]>('/courses'),
importCourse: (id: string) =>
  req<CourseImportSummary>(`/courses/${id}/import`, { method: 'POST' }),
```

Add `Course` and `CourseImportSummary` to the existing `import type { ... } from './types'` block at the top of the file.

- [ ] **Step 3: Add hooks**

In `apps/web/src/api/hooks.ts`, add `courses: ['courses'] as const,` to the `qk` object (after `topicTypes: ['topic-types'] as const,`), then add near `useImportPreview`/`useImportApply`:

```ts
export function useCourses() {
  return useQuery({ queryKey: qk.courses, queryFn: api.getCourses });
}

export function useImportCourse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.importCourse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.courses }),
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `yarn workspace @terrain/web build`
Expected: `tsc --noEmit` + vite build succeed with no errors (this only adds unused-until-Task-6 exports, so no behavior change yet).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/types.ts apps/web/src/api/client.ts apps/web/src/api/hooks.ts
git commit -m "feat(web): add courses API client methods and hooks"
```

---

### Task 6: Web `Courses` screen, button-state logic + test, route, nav entry

**Files:**
- Create: `apps/web/src/screens/Courses/buttonState.ts`
- Create: `apps/web/src/screens/Courses/buttonState.test.ts`
- Create: `apps/web/src/screens/Courses/index.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/Layout.tsx`

**Interfaces:**
- Consumes: `useCourses()`, `useImportCourse()` from Task 5; `Course` type from Task 5; `Card`, `ErrorBox`, `Spinner`, `useToast` from `apps/web/src/components` (barrel `apps/web/src/components/index.ts`).
- Produces: `courseButtonState(course: { imported: boolean }, isPending: boolean): 'import' | 'importing' | 'added'`; default-exported `CoursesScreen` component; route `/courses`; nav entry "Courses".

- [ ] **Step 1: Write the failing test for button-state logic**

Create `apps/web/src/screens/Courses/buttonState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { courseButtonState } from './buttonState';

describe('courseButtonState', () => {
  it('returns "importing" while a mutation is pending, regardless of imported', () => {
    expect(courseButtonState({ imported: false }, true)).toBe('importing');
    expect(courseButtonState({ imported: true }, true)).toBe('importing');
  });

  it('returns "added" when imported and not pending', () => {
    expect(courseButtonState({ imported: true }, false)).toBe('added');
  });

  it('returns "import" when not imported and not pending', () => {
    expect(courseButtonState({ imported: false }, false)).toBe('import');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @terrain/web test buttonState.test.ts`
Expected: FAIL — `Cannot find module './buttonState'`.

- [ ] **Step 3: Write `buttonState.ts`**

```ts
export type CourseButtonState = 'import' | 'importing' | 'added';

export function courseButtonState(
  course: { imported: boolean },
  isPending: boolean,
): CourseButtonState {
  if (isPending) return 'importing';
  return course.imported ? 'added' : 'import';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @terrain/web test buttonState.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the `CoursesScreen` component**

Create `apps/web/src/screens/Courses/index.tsx`:

```tsx
import { useCourses, useImportCourse } from '../../api/hooks';
import { Card, ErrorBox, Spinner, useToast } from '../../components';
import type { Course } from '../../api/types';
import { courseButtonState } from './buttonState';

function CourseCard({ course }: { course: Course }) {
  const { toast } = useToast();
  const importCourse = useImportCourse();
  const isPending = importCourse.isPending && importCourse.variables === course.id;
  const state = courseButtonState(course, isPending);

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

  return (
    <Card
      title={course.title}
      actions={
        <span className="tag">{course.domain}</span>
      }
    >
      <p className="muted">{course.description}</p>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted">{course.topicCount} topics</span>
        <button
          className={state === 'added' ? 'btn btn-ghost' : 'btn btn-primary'}
          disabled={state !== 'import'}
          onClick={onImport}
        >
          {state === 'importing' && <Spinner />}
          {state === 'import' && 'Import'}
          {state === 'importing' && 'Importing…'}
          {state === 'added' && 'Added'}
        </button>
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

- [ ] **Step 6: Register the route**

In `apps/web/src/app/router.tsx`, add the import:

```ts
import CoursesScreen from '../screens/Courses';
```

Add the route definition (near `importRoute`):

```ts
const coursesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/courses',
  component: CoursesScreen,
});
```

Add `coursesRoute` to the `rootRoute.addChildren([...])` array:

```ts
const routeTree = rootRoute.addChildren([
  indexRoute,
  topicsRoute,
  roadmapRoute,
  exportRoute,
  importRoute,
  coursesRoute,
  settingsRoute,
  sessionRoute,
]);
```

- [ ] **Step 7: Add the nav entry**

In `apps/web/src/app/Layout.tsx`, add to the `NAV` array (after the `/import` entry):

```ts
const NAV = [
  { to: '/', label: 'Dashboard', icon: '◎', exact: true },
  { to: '/topics', label: 'Topics', icon: '☰', exact: false },
  { to: '/roadmap', label: 'Roadmap', icon: '⊹', exact: false },
  { to: '/export', label: 'Export', icon: '↗', exact: false },
  { to: '/import', label: 'Import', icon: '↘', exact: false },
  { to: '/courses', label: 'Courses', icon: '⬒', exact: false },
  { to: '/settings', label: 'Settings', icon: '⚙', exact: false },
] as const;
```

- [ ] **Step 8: Build to verify everything compiles**

Run: `yarn workspace @terrain/web build`
Expected: `tsc --noEmit` + vite build succeed with no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/screens/Courses apps/web/src/app/router.tsx apps/web/src/app/Layout.tsx
git commit -m "feat(web): add Courses screen with one-click prepared-course import"
```

---

### Task 7: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the full stack**

```bash
docker compose up -d
yarn build
yarn workspace @terrain/api start &
yarn workspace @terrain/web dev &
```

- [ ] **Step 2: Drive the UI**

Open `http://localhost:5180/courses` (proxies `/api` to `:3000`), log in with the real account. Confirm:
- Two cards render: "Data Structures & Algorithms" (DSA) and "Web3 / Solidity / DeFi" (Web3), each with a nonzero topic count.
- The DSA card shows **Added** immediately (already imported per `.superpowers/sdd/progress.md`), disabled.
- Click **Import** on the Web3 card. Button shows a spinner/**Importing…**, then flips to **Added**; a success toast appears with topic/card counts.
- Reload the page — the Web3 card still shows **Added** (persisted via `CourseImport`, not recomputed from current topics — matches the design's stated non-goal of live sync).
- Open `/roadmap` or `/topics` and confirm Web3 topics now appear.

- [ ] **Step 3: Verify idempotency**

With Web3 already imported, click **Import** again on the DSA card (even though it shows Added, hit the API directly to confirm safety):

```bash
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/courses/dsa/import
```

Expected: 200 response with `topicsCreated: 0` (or a small number if any DSA topics were previously missing) — no duplicate topics created, confirming the title-dedup behavior inherited from `ImportService`.

- [ ] **Step 4: Stop the dev stack**

```bash
kill -9 $(lsof -ti:3000)
kill %1 %2 2>/dev/null || true
```

- [ ] **Step 5: Run the full test suite one more time**

```bash
yarn test
```

Expected: all suites pass, including the new `courses.service.spec.ts` and `buttonState.test.ts`.
