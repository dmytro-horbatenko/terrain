# Terrain Phase 1a — SR Core & Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Terrain monorepo with a pure, tested SM-2 engine, the shared `learning-os` contract, the full Prisma data model, and a Topics + Reviews API where logging a review runs SM-2 and persists the new SR state — seeded with real DSA modules.

**Architecture:** Yarn 4 workspace monorepo. Pure-TS `packages/sr-engine` (SM-2, zero deps) and `packages/types` (shared enums + Zod `learning-os` contract) are consumed by a NestJS `apps/api` backed by Postgres via Prisma. Reviews flow: controller → ReviewsService → `sr-engine.sm2()` → persist `Review` (with before/after SR facts) + update `Topic` SR fields, in one transaction.

**Tech Stack:** Node 24, Yarn 4 workspaces, TypeScript, NestJS, Prisma, PostgreSQL, Vitest (packages), Jest (api), Zod.

## Global Constraints

- Node 24; Yarn 4 workspaces (`.yarnrc.yml` already present, `nodeLinker: node-modules`).
- `packages/sr-engine` has **zero runtime dependencies** — pure TypeScript only.
- **Store facts and inputs, derive everything else.** No `masteryConditions` struct, no derived counters in `DailyLog`. Mastery, "blocked"/"reviewing" labels, and daily metrics are computed in services.
- SM-2 is the algorithm in spec §4 exactly: quality < 3 resets `repetitions=0, interval=1`; EF floor 1.3; intervals 1 → 6 → `round(interval*EF)`. Quality scale 0–5.
- `TopicType` is a soft vocabulary (plain string + auto-growing lookup) — imports/creates must never fail on an unknown type.
- Scaffold via generators (`yarn init -2`, `nest new`, `prisma init`) — do **not** hand-create boilerplate the generators own.
- Single user; no auth in this slice.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json` (root, private, workspaces)
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Modify: `.yarnrc.yml` (already present — verify only)

**Interfaces:**
- Consumes: nothing.
- Produces: workspace roots `packages/*` and `apps/*`; root scripts `yarn workspaces foreach`; a base TS config extended by every package.

- [ ] **Step 1: Initialize Yarn and the workspace root**

Run from repo root:
```bash
corepack enable
yarn set version 4.17.0
git init
```

- [ ] **Step 2: Write the root `package.json`**

```json
{
  "name": "terrain",
  "private": true,
  "packageManager": "yarn@4.17.0",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "yarn workspaces foreach -A --topological run build",
    "test": "yarn workspaces foreach -A run test"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "composite": true
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.log
.yarn/*
!.yarn/releases
coverage/
```

- [ ] **Step 5: Install and verify the workspace resolves**

Run: `yarn install`
Expected: completes without error; `yarn workspaces list` prints the root.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: initialize Terrain yarn 4 monorepo"
```

---

### Task 2: `packages/sr-engine` — pure SM-2 (TDD)

**Files:**
- Create: `packages/sr-engine/package.json`
- Create: `packages/sr-engine/tsconfig.json`
- Create: `packages/sr-engine/vitest.config.ts`
- Create: `packages/sr-engine/src/index.ts`
- Test: `packages/sr-engine/src/sm2.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface SRState { easeFactor: number; interval: number; repetitions: number; nextReviewAt: Date | null }`
  - `function sm2(quality: number, state: SRState, now: Date): SRState`
  - `function shouldEscalate(reviews: { quality: number; reviewedAt: Date }[], now: Date): boolean`
  - `const INITIAL_SR_STATE: SRState` (`easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewAt: null`)

- [ ] **Step 1: Create the package manifest and config**

`packages/sr-engine/package.json`:
```json
{
  "name": "@terrain/sr-engine",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

`packages/sr-engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/sr-engine/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

Run: `yarn install`

- [ ] **Step 2: Write the failing tests**

`packages/sr-engine/src/sm2.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { sm2, shouldEscalate, INITIAL_SR_STATE } from "./index.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

describe("sm2", () => {
  it("resets to interval 1 / repetitions 0 when quality < 3", () => {
    const state = { easeFactor: 2.6, interval: 30, repetitions: 5, nextReviewAt: null };
    const next = sm2(2, state, NOW);
    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(1);
    expect(daysBetween(NOW, next.nextReviewAt!)).toBe(1);
    expect(next.easeFactor).toBe(2.6); // EF unchanged on lapse
  });

  it("gives interval 1 on first successful review", () => {
    const next = sm2(4, INITIAL_SR_STATE, NOW);
    expect(next.interval).toBe(1);
    expect(next.repetitions).toBe(1);
  });

  it("gives interval 6 on second successful review", () => {
    const after1 = sm2(4, INITIAL_SR_STATE, NOW);
    const next = sm2(4, after1, NOW);
    expect(next.interval).toBe(6);
    expect(next.repetitions).toBe(2);
  });

  it("multiplies interval by EF from the third review on", () => {
    let s = sm2(5, INITIAL_SR_STATE, NOW); // rep1, interval1
    s = sm2(5, s, NOW);                     // rep2, interval6
    const next = sm2(5, s, NOW);            // rep3
    expect(next.interval).toBe(Math.round(6 * next.easeFactor));
  });

  it("never drops EF below 1.3", () => {
    let s = { easeFactor: 1.3, interval: 6, repetitions: 2, nextReviewAt: null };
    s = sm2(3, s, NOW); // quality 3 pushes EF down
    expect(s.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});

describe("shouldEscalate", () => {
  it("is true with >=3 reviews of quality <=2 in the last 7 days", () => {
    const reviews = [
      { quality: 1, reviewedAt: new Date("2025-12-28T00:00:00Z") },
      { quality: 2, reviewedAt: new Date("2025-12-29T00:00:00Z") },
      { quality: 0, reviewedAt: new Date("2025-12-30T00:00:00Z") },
    ];
    expect(shouldEscalate(reviews, NOW)).toBe(true);
  });

  it("ignores reviews older than 7 days and quality > 2", () => {
    const reviews = [
      { quality: 1, reviewedAt: new Date("2025-12-01T00:00:00Z") }, // too old
      { quality: 4, reviewedAt: new Date("2025-12-30T00:00:00Z") }, // too good
      { quality: 2, reviewedAt: new Date("2025-12-31T00:00:00Z") },
    ];
    expect(shouldEscalate(reviews, NOW)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn workspace @terrain/sr-engine test`
Expected: FAIL — cannot resolve `./index.js` / exports not defined.

- [ ] **Step 4: Implement `src/index.ts`**

```typescript
export interface SRState {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date | null;
}

export const INITIAL_SR_STATE: SRState = {
  easeFactor: 2.5,
  interval: 0,
  repetitions: 0,
  nextReviewAt: null,
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function sm2(quality: number, state: SRState, now: Date): SRState {
  if (quality < 3) {
    return { ...state, repetitions: 0, interval: 1, nextReviewAt: addDays(now, 1) };
  }
  const easeFactor = Math.max(
    1.3,
    state.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );
  const interval =
    state.repetitions === 0 ? 1 :
    state.repetitions === 1 ? 6 :
    Math.round(state.interval * easeFactor);
  return {
    easeFactor,
    interval,
    repetitions: state.repetitions + 1,
    nextReviewAt: addDays(now, interval),
  };
}

export function shouldEscalate(
  reviews: { quality: number; reviewedAt: Date }[],
  now: Date,
): boolean {
  const cutoff = addDays(now, -7).getTime();
  const recentPoor = reviews.filter(
    (r) => r.quality <= 2 && r.reviewedAt.getTime() >= cutoff,
  );
  return recentPoor.length >= 3;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @terrain/sr-engine test`
Expected: PASS (all 7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sr-engine
git commit -m "feat(sr-engine): pure SM-2 engine with escalation predicate"
```

---

### Task 3: `packages/types` — shared enums + `learning-os` contract (TDD)

**Files:**
- Create: `packages/types/package.json`
- Create: `packages/types/tsconfig.json`
- Create: `packages/types/vitest.config.ts`
- Create: `packages/types/src/index.ts`
- Test: `packages/types/src/learning-os.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - String-union types: `TopicStatus`, `ReviewMode`, `AppEventKind`, `DayType`, `SessionQuality`.
  - `learningOsSchema` (Zod) and inferred `LearningOsOutput` for the §6 contract.
  - `parseLearningOs(raw: string): LearningOsOutput` — extracts the single ` ```learning-os ` fenced block and validates it; throws on missing/invalid block.

- [ ] **Step 1: Create the package manifest and config**

`packages/types/package.json`:
```json
{
  "name": "@terrain/types",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

`packages/types/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/types/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

Run: `yarn install`

- [ ] **Step 2: Write the failing tests**

`packages/types/src/learning-os.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseLearningOs } from "./index.js";

const validBlock = `Some friendly prose from Claude.

\`\`\`learning-os
{
  "version": 1,
  "sessionId": "abc-123",
  "reviews": [{ "topicTitle": "Monotonic stack", "topicId": null, "quality": 3, "note": "ok" }],
  "proposedTopics": [],
  "noteSummaries": [],
  "nextSession": { "focusTitle": "Increasing variant", "coldChallenge": "LeetCode #84" }
}
\`\`\`

More prose after.`;

describe("parseLearningOs", () => {
  it("extracts and validates the learning-os block, ignoring surrounding prose", () => {
    const out = parseLearningOs(validBlock);
    expect(out.version).toBe(1);
    expect(out.sessionId).toBe("abc-123");
    expect(out.reviews[0].quality).toBe(3);
  });

  it("throws when no learning-os block is present", () => {
    expect(() => parseLearningOs("no block here")).toThrow(/no learning-os block/i);
  });

  it("throws when the JSON is malformed", () => {
    const bad = "```learning-os\n{ not json }\n```";
    expect(() => parseLearningOs(bad)).toThrow();
  });

  it("throws when a required field is missing", () => {
    const missing = '```learning-os\n{ "version": 1 }\n```';
    expect(() => parseLearningOs(missing)).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn workspace @terrain/types test`
Expected: FAIL — `parseLearningOs` not exported.

- [ ] **Step 4: Implement `src/index.ts`**

```typescript
import { z } from "zod";

export type TopicStatus = "planned" | "active" | "mastered" | "archived";
export type ReviewMode = "telegram_quick" | "app_log" | "claude_session";
export type AppEventKind =
  | "project_usage" | "problem_solved" | "audit_exercise" | "real_debugging";
export type DayType = "active" | "quiet" | "frozen" | "break";
export type SessionQuality = "shallow" | "normal" | "deep";

const reviewSchema = z.object({
  topicTitle: z.string(),
  topicId: z.string().nullable().optional(),
  quality: z.number().int().min(0).max(5),
  note: z.string().optional(),
});

const proposedTopicSchema = z.object({
  title: z.string(),
  type: z.string(),
  domain: z.string(),
  description: z.string().optional(),
  prerequisiteTitles: z.array(z.string()).default([]),
  parentTitle: z.string().nullable().optional(),
  aiContext: z.string().optional(),
});

const noteSummarySchema = z.object({
  topicTitle: z.string(),
  keyInsight: z.string(),
  invariant: z.string().optional(),
  contradiction: z.string().optional(),
  suggestedNoteRef: z.string().optional(),
});

export const learningOsSchema = z.object({
  version: z.literal(1),
  sessionId: z.string(),
  reviews: z.array(reviewSchema),
  proposedTopics: z.array(proposedTopicSchema),
  noteSummaries: z.array(noteSummarySchema),
  nextSession: z
    .object({
      focusTitle: z.string().optional(),
      coldChallenge: z.string().optional(),
    })
    .optional(),
});

export type LearningOsOutput = z.infer<typeof learningOsSchema>;

const FENCE = /```learning-os\s*\n([\s\S]*?)\n```/;

export function parseLearningOs(raw: string): LearningOsOutput {
  const match = raw.match(FENCE);
  if (!match) {
    throw new Error("No learning-os block found in pasted output.");
  }
  const json = JSON.parse(match[1]); // throws on malformed JSON
  return learningOsSchema.parse(json); // throws on schema mismatch
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn workspace @terrain/types test`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/types
git commit -m "feat(types): shared enums and learning-os Zod contract + parser"
```

---

### Task 4: Scaffold `apps/api` (NestJS) + Prisma

**Files:**
- Create: `apps/api/**` (via `nest new`)
- Modify: `apps/api/package.json` (name, workspace deps)
- Create: `apps/api/.env`
- Create: `docker-compose.yml` (Postgres for local dev)

**Interfaces:**
- Consumes: `@terrain/sr-engine`, `@terrain/types`.
- Produces: a runnable NestJS app on `:3000`; a Postgres dev DB; `DATABASE_URL`.

- [ ] **Step 1: Generate the Nest app into the workspace**

Run from repo root:
```bash
yarn dlx @nestjs/cli@^10 new apps/api --package-manager yarn --skip-git --strict
```

- [ ] **Step 2: Rename the package and wire workspace deps**

Edit `apps/api/package.json` — set name and add deps:
```json
{
  "name": "@terrain/api",
  "dependencies": {
    "@terrain/sr-engine": "workspace:^",
    "@terrain/types": "workspace:^",
    "@prisma/client": "^5.20.0"
  },
  "devDependencies": {
    "prisma": "^5.20.0"
  }
}
```
Run: `yarn install`

- [ ] **Step 3: Add a local Postgres via Docker Compose**

`docker-compose.yml` (repo root):
```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: terrain
      POSTGRES_PASSWORD: terrain
      POSTGRES_DB: terrain
    ports:
      - "5432:5432"
    volumes:
      - terrain_pg:/var/lib/postgresql/data
volumes:
  terrain_pg:
```

`apps/api/.env`:
```
DATABASE_URL="postgresql://terrain:terrain@localhost:5432/terrain?schema=public"
```

- [ ] **Step 4: Initialize Prisma and start the DB**

Run:
```bash
docker compose up -d db
yarn workspace @terrain/api dlx prisma init --datasource-provider postgresql
```
(Then delete the placeholder `DATABASE_URL` Prisma wrote into a second `.env` if duplicated — keep the one from Step 3.)

- [ ] **Step 5: Verify the app boots**

Run: `yarn workspace @terrain/api start`
Expected: Nest logs "Nest application successfully started" on port 3000. Stop it (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add apps/api docker-compose.yml
git commit -m "chore(api): scaffold NestJS app with Prisma and local Postgres"
```

---

### Task 5: Prisma schema + initial migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Consumes: `DATABASE_URL`.
- Produces: all tables from spec §3; the generated `@prisma/client` with `Topic`, `Prerequisite`, `Review`, `ApplicationEvent`, `SessionExport`, `DailyLog`, `StreakState`, `TopicType`, `Settings`.

- [ ] **Step 1: Replace `schema.prisma` with the full model**

`apps/api/prisma/schema.prisma`:
```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum TopicStatus    { planned active mastered archived }
enum ReviewMode     { telegram_quick app_log claude_session }
enum AppEventKind   { project_usage problem_solved audit_exercise real_debugging }
enum DayType        { active quiet frozen break }
enum SessionQuality { shallow normal deep }

model Topic {
  id           String   @id @default(uuid())
  title        String
  domain       String
  topicType    String
  status       TopicStatus @default(planned)
  description  String?
  summary      String?
  noteRef      String?
  parentId     String?
  parent       Topic?   @relation("SubTopics", fields: [parentId], references: [id])
  children     Topic[]  @relation("SubTopics")
  prerequisites Prerequisite[] @relation("Dependent")
  dependents    Prerequisite[] @relation("Prereq")
  easeFactor   Float    @default(2.5)
  interval     Int      @default(0)
  repetitions  Int      @default(0)
  nextReviewAt DateTime?
  learnedAt    DateTime?
  aiProposed   Boolean  @default(false)
  aiContext    String?
  reviews      Review[]
  appEvents    ApplicationEvent[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model Prerequisite {
  topicId        String
  prerequisiteId String
  topic          Topic @relation("Dependent", fields: [topicId], references: [id])
  prerequisite   Topic @relation("Prereq",    fields: [prerequisiteId], references: [id])
  @@id([topicId, prerequisiteId])
}

model Review {
  id             String     @id @default(uuid())
  topicId        String
  topic          Topic      @relation(fields: [topicId], references: [id])
  quality        Int
  mode           ReviewMode
  durationMin    Int?
  note           String?
  intervalBefore Int
  intervalAfter  Int
  reviewedAt     DateTime   @default(now())
}

model ApplicationEvent {
  id          String       @id @default(uuid())
  topicId     String
  topic       Topic        @relation(fields: [topicId], references: [id])
  kind        AppEventKind
  description String
  url         String?
  appliedAt   DateTime     @default(now())
}

model SessionExport {
  id                String   @id @default(uuid())
  generatedAt       DateTime @default(now())
  mode              String
  domains           String[]
  focusTopicId      String?
  exportMd          String
  importedAt        DateTime?
  importedOutputRaw String?
  newTopicsCreated  String[]
}

model DailyLog {
  date           DateTime       @id @db.Date
  dayType        DayType
  eveningNote    String?
  sessionQuality SessionQuality?
}

model StreakState {
  id                Int       @id @default(1)
  currentStreak     Int       @default(0)
  longestStreak     Int       @default(0)
  freezeBalance     Int       @default(0)
  lastEvaluatedDate DateTime? @db.Date
}

model TopicType {
  key   String  @id
  label String
  color String?
}

model Settings {
  id             Int     @id @default(1)
  obsidianVault  String?
  telegramChatId String?
}
```

- [ ] **Step 2: Create and apply the migration**

Run:
```bash
yarn workspace @terrain/api dlx prisma migrate dev --name init
```
Expected: migration `init` created and applied; `@prisma/client` generated.

- [ ] **Step 3: Verify the schema in the DB**

Run: `yarn workspace @terrain/api dlx prisma studio` (opens; confirm all 9 tables exist) then close.
Expected: tables `Topic`, `Prerequisite`, `Review`, `ApplicationEvent`, `SessionExport`, `DailyLog`, `StreakState`, `TopicType`, `Settings`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): full Prisma data model + init migration"
```

---

### Task 6: PrismaService + module

**Files:**
- Create: `apps/api/src/prisma/prisma.service.ts`
- Create: `apps/api/src/prisma/prisma.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `@prisma/client`.
- Produces: injectable `PrismaService extends PrismaClient` with lifecycle hooks; global `PrismaModule` exporting it.

- [ ] **Step 1: Write `prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

- [ ] **Step 2: Write `prisma.module.ts`**

```typescript
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

- [ ] **Step 3: Register the module in `app.module.ts`**

Add `PrismaModule` to the `imports` array of `AppModule` (import from `./prisma/prisma.module.js`).

- [ ] **Step 4: Verify the app boots with Prisma connected**

Run: `yarn workspace @terrain/api start`
Expected: boots with no connection error. Stop it.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/prisma apps/api/src/app.module.ts
git commit -m "feat(api): global PrismaService module"
```

---

### Task 7: Topics module — CRUD (TDD)

**Files:**
- Create: `apps/api/src/topics/topics.service.ts`
- Create: `apps/api/src/topics/topics.controller.ts`
- Create: `apps/api/src/topics/topics.module.ts`
- Create: `apps/api/src/topics/dto.ts`
- Test: `apps/api/src/topics/topics.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `TopicsService.create(dto: CreateTopicDto): Promise<Topic>` — also upserts `TopicType` from `dto.topicType` (soft vocabulary; normalized `key = topicType.trim().toLowerCase()`, `label = topicType.trim()`).
  - `TopicsService.findAll(): Promise<Topic[]>`, `findOne(id): Promise<Topic>`, `update(id, dto): Promise<Topic>`, `remove(id): Promise<void>`.
  - REST: `POST/GET /topics`, `GET/PATCH/DELETE /topics/:id`.

- [ ] **Step 1: Write the DTOs**

`apps/api/src/topics/dto.ts`:
```typescript
import { TopicStatus } from "@terrain/types";

export interface CreateTopicDto {
  title: string;
  domain: string;
  topicType: string;
  status?: TopicStatus;
  description?: string;
  noteRef?: string;
  parentId?: string;
}
export type UpdateTopicDto = Partial<CreateTopicDto> & {
  summary?: string;
  interval?: number;
  nextReviewAt?: string;
};
```

- [ ] **Step 2: Write the failing service test**

`apps/api/src/topics/topics.service.spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service.js";
import { TopicsService } from "./topics.service.js";

describe("TopicsService", () => {
  let service: TopicsService;
  let prisma: { topic: any; topicType: any };

  beforeEach(async () => {
    prisma = {
      topic: { create: jest.fn().mockResolvedValue({ id: "t1", title: "X" }) },
      topicType: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const mod = await Test.createTestingModule({
      providers: [TopicsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TopicsService);
  });

  it("creates a topic and registers its type in the soft vocabulary", async () => {
    await service.create({ title: "Monotonic stack", domain: "DSA", topicType: " Pattern " });
    expect(prisma.topicType.upsert).toHaveBeenCalledWith({
      where: { key: "pattern" },
      update: {},
      create: { key: "pattern", label: "Pattern" },
    });
    expect(prisma.topic.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn workspace @terrain/api test topics.service`
Expected: FAIL — `TopicsService` not found.

- [ ] **Step 4: Implement the service**

`apps/api/src/topics/topics.service.ts`:
```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateTopicDto, UpdateTopicDto } from "./dto.js";

@Injectable()
export class TopicsService {
  constructor(private prisma: PrismaService) {}

  private async registerType(topicType: string) {
    const label = topicType.trim();
    const key = label.toLowerCase();
    await this.prisma.topicType.upsert({
      where: { key },
      update: {},
      create: { key, label },
    });
  }

  async create(dto: CreateTopicDto) {
    await this.registerType(dto.topicType);
    return this.prisma.topic.create({ data: { ...dto } });
  }

  findAll() {
    return this.prisma.topic.findMany({ orderBy: { createdAt: "asc" } });
  }

  async findOne(id: string) {
    const topic = await this.prisma.topic.findUnique({ where: { id } });
    if (!topic) throw new NotFoundException(`Topic ${id} not found`);
    return topic;
  }

  async update(id: string, dto: UpdateTopicDto) {
    await this.findOne(id);
    if (dto.topicType) await this.registerType(dto.topicType);
    const { nextReviewAt, ...rest } = dto;
    return this.prisma.topic.update({
      where: { id },
      data: { ...rest, ...(nextReviewAt ? { nextReviewAt: new Date(nextReviewAt) } : {}) },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.topic.delete({ where: { id } });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @terrain/api test topics.service`
Expected: PASS.

- [ ] **Step 6: Write the controller and module**

`apps/api/src/topics/topics.controller.ts`:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { TopicsService } from "./topics.service.js";
import { CreateTopicDto, UpdateTopicDto } from "./dto.js";

@Controller("topics")
export class TopicsController {
  constructor(private service: TopicsService) {}
  @Post() create(@Body() dto: CreateTopicDto) { return this.service.create(dto); }
  @Get() findAll() { return this.service.findAll(); }
  @Get(":id") findOne(@Param("id") id: string) { return this.service.findOne(id); }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateTopicDto) {
    return this.service.update(id, dto);
  }
  @Delete(":id") remove(@Param("id") id: string) { return this.service.remove(id); }
}
```

`apps/api/src/topics/topics.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { TopicsService } from "./topics.service.js";
import { TopicsController } from "./topics.controller.js";

@Module({ providers: [TopicsService], controllers: [TopicsController], exports: [TopicsService] })
export class TopicsModule {}
```

Add `TopicsModule` to `AppModule` imports.

- [ ] **Step 7: Run the full api test suite**

Run: `yarn workspace @terrain/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/topics apps/api/src/app.module.ts
git commit -m "feat(api): Topics CRUD with soft-vocabulary type registration"
```

---

### Task 8: Reviews module — log review runs SM-2 (TDD)

**Files:**
- Create: `apps/api/src/reviews/reviews.service.ts`
- Create: `apps/api/src/reviews/reviews.controller.ts`
- Create: `apps/api/src/reviews/reviews.module.ts`
- Create: `apps/api/src/reviews/dto.ts`
- Test: `apps/api/src/reviews/reviews.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, `sm2`/`SRState` from `@terrain/sr-engine`, `ReviewMode` from `@terrain/types`.
- Produces:
  - `ReviewsService.logReview(dto: LogReviewDto): Promise<Review>` — reads the topic's SR state, runs `sm2`, writes a `Review` row (`intervalBefore`/`intervalAfter`) and updates the topic's SR fields + `learnedAt` (set on first review if null) + `status` (`planned` → `active` on first review), all in one `$transaction`.
  - REST: `POST /reviews`, `GET /reviews?topicId=`.
  - `LogReviewDto { topicId: string; quality: number; mode: ReviewMode; durationMin?: number; note?: string }`.

- [ ] **Step 1: Write the DTO**

`apps/api/src/reviews/dto.ts`:
```typescript
import { ReviewMode } from "@terrain/types";

export interface LogReviewDto {
  topicId: string;
  quality: number;
  mode: ReviewMode;
  durationMin?: number;
  note?: string;
}
```

- [ ] **Step 2: Write the failing service test**

`apps/api/src/reviews/reviews.service.spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service.js";
import { ReviewsService } from "./reviews.service.js";

describe("ReviewsService.logReview", () => {
  let service: ReviewsService;
  let topicUpdate: jest.Mock;
  let reviewCreate: jest.Mock;

  beforeEach(async () => {
    topicUpdate = jest.fn().mockResolvedValue({});
    reviewCreate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "r1", ...data }));
    const prisma = {
      topic: {
        findUnique: jest.fn().mockResolvedValue({
          id: "t1", interval: 6, repetitions: 1, easeFactor: 2.5,
          learnedAt: null, status: "planned",
        }),
        update: topicUpdate,
      },
      review: { create: reviewCreate },
      $transaction: (fns: any[]) => Promise.all(fns),
    };
    const mod = await Test.createTestingModule({
      providers: [ReviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(ReviewsService);
  });

  it("runs SM-2 and persists before/after intervals", async () => {
    await service.logReview({ topicId: "t1", quality: 4, mode: "app_log" });
    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.intervalBefore).toBe(6);
    expect(created.intervalAfter).toBe(6); // rep was 1 → second success → interval 6
    const updated = topicUpdate.mock.calls[0][0].data;
    expect(updated.repetitions).toBe(2);
    expect(updated.status).toBe("active");     // planned → active on first review
    expect(updated.learnedAt).toBeInstanceOf(Date); // set on first review
  });

  it("resets interval to 1 on a failed review (quality < 3)", async () => {
    await service.logReview({ topicId: "t1", quality: 1, mode: "telegram_quick" });
    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.intervalAfter).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn workspace @terrain/api test reviews.service`
Expected: FAIL — `ReviewsService` not found.

- [ ] **Step 4: Implement the service**

`apps/api/src/reviews/reviews.service.ts`:
```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { sm2, type SRState } from "@terrain/sr-engine";
import { PrismaService } from "../prisma/prisma.service.js";
import { LogReviewDto } from "./dto.js";

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async logReview(dto: LogReviewDto) {
    const topic = await this.prisma.topic.findUnique({ where: { id: dto.topicId } });
    if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);

    const now = new Date();
    const before: SRState = {
      easeFactor: topic.easeFactor,
      interval: topic.interval,
      repetitions: topic.repetitions,
      nextReviewAt: topic.nextReviewAt,
    };
    const after = sm2(dto.quality, before, now);

    const [review] = await this.prisma.$transaction([
      this.prisma.review.create({
        data: {
          topicId: dto.topicId,
          quality: dto.quality,
          mode: dto.mode,
          durationMin: dto.durationMin,
          note: dto.note,
          intervalBefore: before.interval,
          intervalAfter: after.interval,
          reviewedAt: now,
        },
      }),
      this.prisma.topic.update({
        where: { id: dto.topicId },
        data: {
          easeFactor: after.easeFactor,
          interval: after.interval,
          repetitions: after.repetitions,
          nextReviewAt: after.nextReviewAt,
          learnedAt: topic.learnedAt ?? now,
          status: topic.status === "planned" ? "active" : topic.status,
        },
      }),
    ]);
    return review;
  }

  findByTopic(topicId: string) {
    return this.prisma.review.findMany({
      where: { topicId },
      orderBy: { reviewedAt: "asc" },
    });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace @terrain/api test reviews.service`
Expected: PASS (both tests).

- [ ] **Step 6: Write the controller and module**

`apps/api/src/reviews/reviews.controller.ts`:
```typescript
import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ReviewsService } from "./reviews.service.js";
import { LogReviewDto } from "./dto.js";

@Controller("reviews")
export class ReviewsController {
  constructor(private service: ReviewsService) {}
  @Post() log(@Body() dto: LogReviewDto) { return this.service.logReview(dto); }
  @Get() byTopic(@Query("topicId") topicId: string) { return this.service.findByTopic(topicId); }
}
```

`apps/api/src/reviews/reviews.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { ReviewsService } from "./reviews.service.js";
import { ReviewsController } from "./reviews.controller.js";

@Module({ providers: [ReviewsService], controllers: [ReviewsController], exports: [ReviewsService] })
export class ReviewsModule {}
```

Add `ReviewsModule` to `AppModule` imports.

- [ ] **Step 7: Run the full api test suite**

Run: `yarn workspace @terrain/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/reviews apps/api/src/app.module.ts
git commit -m "feat(api): Reviews module — logging a review runs SM-2 and persists SR state"
```

---

### Task 9: Seed script — pre-seed DSA modules

**Files:**
- Create: `apps/api/prisma/seed.ts`
- Modify: `apps/api/package.json` (add `prisma.seed`)

**Interfaces:**
- Consumes: `@prisma/client`.
- Produces: idempotent seed of the 16 DSA modules with statuses/intervals from spec §15, the `StreakState` singleton, the `Settings` singleton, and the starter `TopicType` rows.

- [ ] **Step 1: Configure the seed command**

In `apps/api/package.json` add:
```json
{
  "prisma": { "seed": "node --import tsx prisma/seed.ts" },
  "devDependencies": { "tsx": "^4.19.0" }
}
```
Run: `yarn install`

- [ ] **Step 2: Write `prisma/seed.ts`**

```typescript
import { PrismaClient, type TopicStatus } from "@prisma/client";
const prisma = new PrismaClient();

const TYPES = [
  "pattern","concept","problem","vulnerability","tradeoff","technique","protocol","theorem",
];

type Seed = { title: string; status: TopicStatus; interval: number };
const DSA: Seed[] = [
  { title: "Arrays & hash maps", status: "mastered", interval: 60 },
  { title: "Two pointers & sliding window", status: "active", interval: 38 },
  { title: "Linked lists", status: "mastered", interval: 60 },
  { title: "Graphs DFS/BFS", status: "active", interval: 14 },
  { title: "Backtracking", status: "active", interval: 14 },
  { title: "1D dynamic programming", status: "mastered", interval: 60 },
  { title: "Stacks & queues", status: "active", interval: 1 },
  { title: "Heaps & priority queues", status: "planned", interval: 0 },
  { title: "Binary search", status: "planned", interval: 0 },
  { title: "Trees DFS/BFS", status: "planned", interval: 0 },
  { title: "Tries", status: "planned", interval: 0 },
  { title: "2D DP", status: "planned", interval: 0 },
  { title: "Intervals", status: "planned", interval: 0 },
  { title: "Greedy", status: "planned", interval: 0 },
  { title: "Advanced graphs", status: "planned", interval: 0 },
  { title: "Bit manipulation", status: "planned", interval: 0 },
];

async function main() {
  for (const key of TYPES) {
    await prisma.topicType.upsert({
      where: { key }, update: {},
      create: { key, label: key[0].toUpperCase() + key.slice(1) },
    });
  }

  const now = new Date();
  for (const m of DSA) {
    const existing = await prisma.topic.findFirst({ where: { title: m.title, domain: "DSA" } });
    if (existing) continue;
    const reviewing = m.status !== "planned";
    await prisma.topic.create({
      data: {
        title: m.title, domain: "DSA", topicType: "concept", status: m.status,
        interval: m.interval,
        repetitions: reviewing ? 2 : 0,
        easeFactor: 2.5,
        learnedAt: reviewing ? now : null,
        nextReviewAt: reviewing ? new Date(now.getTime() + m.interval * 86_400_000) : null,
      },
    });
  }

  await prisma.streakState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

main().then(() => prisma.$disconnect());
```

- [ ] **Step 3: Run the seed**

Run: `yarn workspace @terrain/api dlx prisma db seed`
Expected: completes; `prisma studio` shows 16 DSA topics, 8 TopicType rows, 1 StreakState, 1 Settings.

- [ ] **Step 4: Verify idempotency**

Run the seed again: `yarn workspace @terrain/api dlx prisma db seed`
Expected: no duplicate topics (still 16).

- [ ] **Step 5: Manual end-to-end smoke test**

Run: `yarn workspace @terrain/api start`, then in another shell:
```bash
curl -s localhost:3000/topics | head -c 400
TID=$(curl -s localhost:3000/topics | node -e 'process.stdin.on("data",d=>{const t=JSON.parse(d).find(x=>x.title==="Stacks & queues");console.log(t.id)})')
curl -s -X POST localhost:3000/reviews -H 'content-type: application/json' \
  -d "{\"topicId\":\"$TID\",\"quality\":4,\"mode\":\"app_log\"}"
curl -s "localhost:3000/reviews?topicId=$TID"
```
Expected: review created with `intervalBefore`/`intervalAfter`; re-fetching the topic shows updated `interval`, `repetitions`, `nextReviewAt`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/package.json
git commit -m "feat(api): idempotent seed of DSA modules, types, and singletons"
```

---

## Self-Review

**Spec coverage (slice 1a scope):**
- Monorepo + packages (`sr-engine`, `types`) — Tasks 1–3 ✓ (spec §13)
- "Store facts, derive rest" — enforced: no `masteryConditions`/derived counters in schema (Task 5) ✓ (spec §2)
- SM-2 exact algorithm + escalation predicate — Task 2 ✓ (spec §4)
- `learning-os` contract as Zod in `types` — Task 3 ✓ (spec §6)
- Full data model (all 9 models) — Task 5 ✓ (spec §3)
- Soft vocabulary (string + auto-grow `TopicType`) — Tasks 7, 9 ✓ (spec §10)
- Reviews write before/after SR facts; topic SR state updates — Task 8 ✓ (spec §3, §4)
- Pre-seed DSA modules — Task 9 ✓ (spec §15)
- Out of slice (later plans, noted in handoff): streak cron, export generator, Telegram, web UI, import parser, roadmap graph. Not gaps — sequenced into 1b–1d.

**Placeholder scan:** none — every code step contains full source; no TBD/TODO/"handle edge cases".

**Type consistency:** `SRState` shape identical across Tasks 2 and 8; `sm2(quality, state, now)` signature used as defined; `ReviewMode`/`TopicStatus` imported from `@terrain/types` consistently; `registerType` normalization (`key`=lowercased, `label`=trimmed) matches between Task 7 service and Task 9 seed; `intervalBefore`/`intervalAfter` names match schema (Task 5), service (Task 8), and test.

One note carried to execution: NodeNext ESM means intra-package relative imports use `.js` extensions (reflected throughout); confirm `nest new --strict` output is reconciled to ESM, or keep api on CommonJS and drop the `.js` suffixes in api-only imports — decide at Task 4 and apply consistently.
