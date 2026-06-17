# Terrain Phase 1b — Streak/Freeze + Session Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the derived-metrics layer, the Duolingo-style streak/freeze engine with a nightly cron, and the parameterized session-context export generator (the markdown pasted into Claude.ai) exposed via an API endpoint.

**Architecture:** Pure computation in services over the existing Prisma data (no new stored derived fields except the path-dependent streak/freeze game state). A nightly `@nestjs/schedule` cron classifies each day and updates `StreakState` + writes a `DailyLog`. The export generator is a pure function (state → markdown) called by a `GET /sessions/export` endpoint that also persists a `SessionExport` row. The web "Copy" screen is deferred to slice 1d (web UI); 1b delivers the export as an API response.

**Tech Stack:** NestJS, Prisma 5.22/Postgres, `@nestjs/schedule`, Jest. CommonJS monorepo.

## Global Constraints

- CommonJS Nest app; extensionless relative imports; workspace imports via `@terrain/*`.
- Postgres on host port **5433**; use the pinned binary `yarn workspace @terrain/api exec prisma ...` (never `dlx` → pulls Prisma 7.x).
- **Store facts and inputs, derive everything else.** The only new stored state is path-dependent streak/freeze game state (`StreakState`) and per-day `DailyLog.dayType` (a recorded fact). Mastery, blocked/reviewing labels, struggle ratio, due/overdue lists are all computed, never stored.
- **Mastery (computed):** `retention = interval ≥ 30`, `application = ApplicationEvent count ≥ 1`, `teaching = noteRef != null || summary != null`. Eligible-for-mastery = all three true.
- **Derived labels:** `blocked` = `status==planned && ∃ prerequisite with status != mastered`; `reviewing` = `status==active && repetitions > 0`.
- **Freeze economy:** earn **1 freeze per 5 active days**, **cap 2**; a missed day (reviews were due, none logged) auto-consumes a freeze → day `frozen`, streak preserved; no freeze → `break`, streak resets to 0; a **quiet day** (nothing due) continues the streak free; `/skip` manually spends a freeze for today (fails if none).
- **Export invariant:** `WHO I AM` and the **OUTPUT CONTRACT + worked example** appear in every export regardless of mode. `mode: domain:<X>` filters roadmap/due to one domain; `focusTopicId` adds a focus section, never removes content.
- **`DayType.break`** is a reserved word — reference the enum member via the Prisma client (`DayType.break` works as a property; the string value is `"break"`).
- Work is left **uncommitted** in the working tree (user preference) — do not run `git commit`.

---

### Task 1: Derived-metrics service (mastery, labels, due lists, struggle ratio) (TDD)

**Files:**
- Create: `apps/api/src/metrics/metrics.service.ts`
- Create: `apps/api/src/metrics/metrics.module.ts`
- Test: `apps/api/src/metrics/metrics.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `MetricsModule`)

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `masteryStatus(input: { interval: number; appEventCount: number; noteRef: string | null; summary: string | null }): { retention: boolean; application: boolean; teaching: boolean; eligible: boolean }` — pure.
  - `struggleRatio7d(now: Date): Promise<number>` — share (0–1) of reviews in last 7 days with quality ≤ 2; returns 0 when no reviews.
  - `dueTopics(now: Date): Promise<{ overdue: Topic[]; dueToday: Topic[] }>` — `status='active'`, `nextReviewAt` not null; overdue = `nextReviewAt < startOfToday`, dueToday = within today.
  - `MetricsModule` exports `MetricsService`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/metrics/metrics.service.spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "./metrics.service";

describe("MetricsService", () => {
  let service: MetricsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      review: { findMany: jest.fn().mockResolvedValue([]) },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod = await Test.createTestingModule({
      providers: [MetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(MetricsService);
  });

  it("computes mastery: all three conditions => eligible", () => {
    const s = service.masteryStatus({ interval: 30, appEventCount: 1, noteRef: "x", summary: null });
    expect(s).toEqual({ retention: true, application: true, teaching: true, eligible: true });
  });

  it("mastery not eligible when one condition fails", () => {
    const s = service.masteryStatus({ interval: 29, appEventCount: 1, noteRef: "x", summary: null });
    expect(s.retention).toBe(false);
    expect(s.eligible).toBe(false);
  });

  it("teaching true via summary when noteRef is null", () => {
    const s = service.masteryStatus({ interval: 0, appEventCount: 0, noteRef: null, summary: "my notes" });
    expect(s.teaching).toBe(true);
  });

  it("struggleRatio7d returns 0 with no reviews", async () => {
    expect(await service.struggleRatio7d(new Date("2026-01-08T00:00:00Z"))).toBe(0);
  });

  it("struggleRatio7d = poor/total over the window", async () => {
    prisma.review.findMany.mockResolvedValue([
      { quality: 1 }, { quality: 2 }, { quality: 4 }, { quality: 5 },
    ]);
    expect(await service.struggleRatio7d(new Date("2026-01-08T00:00:00Z"))).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: FAIL — `MetricsService` not found.

- [ ] **Step 3: Implement the service**

`apps/api/src/metrics/metrics.service.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import type { Topic } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 86_400_000;

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  masteryStatus(input: {
    interval: number;
    appEventCount: number;
    noteRef: string | null;
    summary: string | null;
  }) {
    const retention = input.interval >= 30;
    const application = input.appEventCount >= 1;
    const teaching = input.noteRef != null || input.summary != null;
    return { retention, application, teaching, eligible: retention && application && teaching };
  }

  async struggleRatio7d(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const reviews = await this.prisma.review.findMany({
      where: { reviewedAt: { gte: cutoff } },
      select: { quality: true },
    });
    if (reviews.length === 0) return 0;
    const poor = reviews.filter((r) => r.quality <= 2).length;
    return poor / reviews.length;
  }

  async dueTopics(now: Date): Promise<{ overdue: Topic[]; dueToday: Topic[] }> {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    const active = await this.prisma.topic.findMany({
      where: { status: "active", nextReviewAt: { not: null, lt: endOfToday } },
      orderBy: { nextReviewAt: "asc" },
    });
    const overdue = active.filter((t) => t.nextReviewAt! < startOfToday);
    const dueToday = active.filter((t) => t.nextReviewAt! >= startOfToday);
    return { overdue, dueToday };
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Register module and build**

Add `MetricsModule` (providing + exporting `MetricsService`) and register it in `AppModule`. Run `yarn workspace @terrain/api build` → exits 0.

---

### Task 2: Add `activeDayCounter` to `StreakState` (schema + migration)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (one field)

**Interfaces:**
- Produces: `StreakState.activeDayCounter Int @default(0)` — counts active days toward the next earned freeze.

- [ ] **Step 1: Add the field**

In `model StreakState`, add:
```prisma
  activeDayCounter Int @default(0)
```

- [ ] **Step 2: Create and apply the migration**

Run: `yarn workspace @terrain/api exec prisma migrate dev --name streak_active_counter`
Expected: migration created + applied; client regenerated.

- [ ] **Step 3: Verify**

Run: `yarn workspace @terrain/api build` → exits 0 (client type has `activeDayCounter`).

---

### Task 3: Streak/freeze engine (TDD)

**Files:**
- Create: `apps/api/src/streak/streak.service.ts`
- Create: `apps/api/src/streak/streak.module.ts`
- Test: `apps/api/src/streak/streak.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `StreakModule`)

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `classifyDay(input: { loggedCount: number; dueCount: number; freezeBalance: number }): DayType` — pure: `loggedCount>0 → active`; else `dueCount===0 → quiet`; else `freezeBalance>0 → frozen`; else `break`.
  - `applyDay(state, dayType): StreakStateUpdate` — pure: computes next `{ currentStreak, longestStreak, freezeBalance, activeDayCounter }` per the economy (active → streak+1 and counter+1, earn freeze at 5 capped 2; quiet → streak+1; frozen → consume 1 freeze, streak unchanged; break → streak 0).
  - `evaluateDay(date: Date): Promise<void>` — idempotent (skips if a `DailyLog` for `date` already exists); queries logged/due counts, classifies, applies, writes `DailyLog` + updates `StreakState`.
  - `skipToday(now: Date): Promise<{ freezeBalance: number }>` — requires `freezeBalance>0`; spends one, writes today's `DailyLog` as `frozen`; throws `ConflictException` if no freezes or today already logged.
  - `getState(): Promise<StreakState>`.
  - `StreakModule` exports `StreakService`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/streak/streak.service.spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { StreakService } from "./streak.service";

describe("StreakService pure logic", () => {
  let service: StreakService;
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [StreakService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = mod.get(StreakService);
  });

  it("classifyDay", () => {
    expect(service.classifyDay({ loggedCount: 2, dueCount: 3, freezeBalance: 0 })).toBe("active");
    expect(service.classifyDay({ loggedCount: 0, dueCount: 0, freezeBalance: 0 })).toBe("quiet");
    expect(service.classifyDay({ loggedCount: 0, dueCount: 1, freezeBalance: 1 })).toBe("frozen");
    expect(service.classifyDay({ loggedCount: 0, dueCount: 1, freezeBalance: 0 })).toBe("break");
  });

  it("active day increments streak and earns a freeze at 5 active days (cap 2)", () => {
    const base = { currentStreak: 4, longestStreak: 4, freezeBalance: 0, activeDayCounter: 4 };
    const next = service.applyDay(base, "active");
    expect(next.currentStreak).toBe(5);
    expect(next.longestStreak).toBe(5);
    expect(next.freezeBalance).toBe(1);   // earned at 5th active day
    expect(next.activeDayCounter).toBe(0); // reset
  });

  it("freeze earning is capped at 2", () => {
    const base = { currentStreak: 9, longestStreak: 9, freezeBalance: 2, activeDayCounter: 4 };
    const next = service.applyDay(base, "active");
    expect(next.freezeBalance).toBe(2);
    expect(next.activeDayCounter).toBe(0);
  });

  it("quiet day preserves and continues streak, no freeze change", () => {
    const next = service.applyDay(
      { currentStreak: 7, longestStreak: 10, freezeBalance: 1, activeDayCounter: 2 }, "quiet");
    expect(next.currentStreak).toBe(8);
    expect(next.freezeBalance).toBe(1);
    expect(next.activeDayCounter).toBe(2);
  });

  it("frozen day consumes a freeze and preserves streak", () => {
    const next = service.applyDay(
      { currentStreak: 7, longestStreak: 10, freezeBalance: 2, activeDayCounter: 2 }, "frozen");
    expect(next.currentStreak).toBe(7);
    expect(next.freezeBalance).toBe(1);
  });

  it("break resets streak to 0", () => {
    const next = service.applyDay(
      { currentStreak: 7, longestStreak: 10, freezeBalance: 0, activeDayCounter: 3 }, "break");
    expect(next.currentStreak).toBe(0);
    expect(next.longestStreak).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test streak.service`
Expected: FAIL — `StreakService` not found.

- [ ] **Step 3: Implement the service**

`apps/api/src/streak/streak.service.ts`:
```typescript
import { ConflictException, Injectable } from "@nestjs/common";
import { DayType, type StreakState } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DAY_MS = 86_400_000;
const FREEZE_CAP = 2;
const ACTIVE_DAYS_PER_FREEZE = 5;

type StreakCore = Pick<
  StreakState,
  "currentStreak" | "longestStreak" | "freezeBalance" | "activeDayCounter"
>;

@Injectable()
export class StreakService {
  constructor(private prisma: PrismaService) {}

  classifyDay(input: { loggedCount: number; dueCount: number; freezeBalance: number }): DayType {
    if (input.loggedCount > 0) return DayType.active;
    if (input.dueCount === 0) return DayType.quiet;
    if (input.freezeBalance > 0) return DayType.frozen;
    return DayType.break;
  }

  applyDay(state: StreakCore, dayType: DayType): StreakCore {
    let { currentStreak, longestStreak, freezeBalance, activeDayCounter } = state;
    switch (dayType) {
      case DayType.active: {
        currentStreak += 1;
        activeDayCounter += 1;
        if (activeDayCounter >= ACTIVE_DAYS_PER_FREEZE) {
          activeDayCounter = 0;
          freezeBalance = Math.min(FREEZE_CAP, freezeBalance + 1);
        }
        break;
      }
      case DayType.quiet:
        currentStreak += 1;
        break;
      case DayType.frozen:
        freezeBalance = Math.max(0, freezeBalance - 1);
        break;
      case DayType.break:
        currentStreak = 0;
        break;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
    return { currentStreak, longestStreak, freezeBalance, activeDayCounter };
  }

  private dayBounds(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }

  async getState(): Promise<StreakState> {
    return this.prisma.streakState.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  }

  async evaluateDay(date: Date): Promise<void> {
    const { start, end } = this.dayBounds(date);
    const existing = await this.prisma.dailyLog.findUnique({ where: { date: start } });
    if (existing) return; // idempotent: already evaluated or skipped

    const loggedCount = await this.prisma.review.count({
      where: { reviewedAt: { gte: start, lt: end } },
    });
    const dueCount = await this.prisma.topic.count({
      where: { status: "active", nextReviewAt: { not: null, lt: end } },
    });
    const state = await this.getState();
    const dayType = this.classifyDay({ loggedCount, dueCount, freezeBalance: state.freezeBalance });
    const next = this.applyDay(state, dayType);

    await this.prisma.$transaction([
      this.prisma.dailyLog.create({ data: { date: start, dayType } }),
      this.prisma.streakState.update({ where: { id: 1 }, data: next }),
    ]);
  }

  async skipToday(now: Date): Promise<{ freezeBalance: number }> {
    const { start } = this.dayBounds(now);
    const existing = await this.prisma.dailyLog.findUnique({ where: { date: start } });
    if (existing) throw new ConflictException("Today is already logged.");
    const state = await this.getState();
    if (state.freezeBalance <= 0) throw new ConflictException("No freezes left to skip today.");
    const [, updated] = await this.prisma.$transaction([
      this.prisma.dailyLog.create({ data: { date: start, dayType: DayType.frozen } }),
      this.prisma.streakState.update({
        where: { id: 1 },
        data: { freezeBalance: state.freezeBalance - 1 },
      }),
    ]);
    return { freezeBalance: updated.freezeBalance };
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn workspace @terrain/api test streak.service`
Expected: PASS (6 tests).

- [ ] **Step 5: Register module + build**

Create `StreakModule` (provides + exports `StreakService`), register in `AppModule`, `yarn workspace @terrain/api build` → 0.

---

### Task 4: Nightly cron + streak endpoints

**Files:**
- Modify: `apps/api/package.json` (add `@nestjs/schedule`)
- Create: `apps/api/src/streak/streak.cron.ts`
- Create: `apps/api/src/streak/streak.controller.ts`
- Modify: `apps/api/src/streak/streak.module.ts` (add cron + controller; import `ScheduleModule`)
- Modify: `apps/api/src/app.module.ts` (import `ScheduleModule.forRoot()`)

**Interfaces:**
- Consumes: `StreakService`.
- Produces:
  - A nightly job (`@Cron("5 0 * * *")`) that calls `streak.evaluateDay(yesterday)`.
  - REST: `GET /streak` → `getState()`; `POST /streak/skip` → `skipToday(new Date())`.

- [ ] **Step 1: Install the scheduler**

Run: `yarn workspace @terrain/api add @nestjs/schedule`

- [ ] **Step 2: Wire `ScheduleModule.forRoot()`**

In `app.module.ts` imports add `ScheduleModule.forRoot()` (import from `@nestjs/schedule`).

- [ ] **Step 3: Write the cron**

`apps/api/src/streak/streak.cron.ts`:
```typescript
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StreakService } from "./streak.service";

@Injectable()
export class StreakCron {
  private readonly logger = new Logger(StreakCron.name);
  constructor(private streak: StreakService) {}

  @Cron("5 0 * * *") // 00:05 daily — evaluate the day that just ended
  async evaluateYesterday() {
    const yesterday = new Date(Date.now() - 86_400_000);
    await this.streak.evaluateDay(yesterday);
    this.logger.log(`Evaluated streak for ${yesterday.toDateString()}`);
  }
}
```

- [ ] **Step 4: Write the controller**

`apps/api/src/streak/streak.controller.ts`:
```typescript
import { Controller, Get, Post } from "@nestjs/common";
import { StreakService } from "./streak.service";

@Controller("streak")
export class StreakController {
  constructor(private streak: StreakService) {}
  @Get() get() { return this.streak.getState(); }
  @Post("skip") skip() { return this.streak.skipToday(new Date()); }
}
```

- [ ] **Step 5: Update the module**

`streak.module.ts` provides `StreakService`, `StreakCron`; declares `StreakController`; exports `StreakService`.

- [ ] **Step 6: Verify boot + endpoints**

Start the API; confirm it boots (scheduler registers). Then:
```bash
curl -s localhost:3000/streak           # returns StreakState JSON
curl -s -X POST localhost:3000/streak/skip   # spends a freeze or 409 if none
```
Capture output; stop the server. Run `yarn workspace @terrain/api build` → 0.

---

### Task 5: Session-export generator (TDD)

**Files:**
- Create: `apps/api/src/sessions/output-contract.ts` (the embedded contract constant)
- Create: `apps/api/src/sessions/export-generator.service.ts`
- Test: `apps/api/src/sessions/export-generator.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `MetricsService`.
- Produces:
  - `OUTPUT_CONTRACT: string` — the literal markdown block teaching Claude the `learning-os` JSON schema + a worked example (mirrors `@terrain/types` `learningOsSchema`).
  - `ExportGeneratorService.generate(opts: { mode?: string; focusTopicId?: string; now: Date }): Promise<string>` — builds the full export markdown. Sections, in order: header (generated time, mode, a placeholder `Session: <will be set on persist>`), `WHO I AM`, `ROADMAP` (per domain, or single domain if `mode` is `domain:X`), `DUE FOR REVIEW TODAY` (overdue + due today from `MetricsService.dueTopics`), `RECENT SIGNALS` (struggle ratio), `MASTERY CONDITIONS` (active topics), optional `SESSION GOAL` (when `focusTopicId` set), and always `OUTPUT CONTRACT` (the constant).

- [ ] **Step 1: Write the contract constant**

`apps/api/src/sessions/output-contract.ts`:
```typescript
export const OUTPUT_CONTRACT = `## OUTPUT CONTRACT — return exactly one fenced block

When the session ends, output ONE fenced code block tagged \`learning-os\` containing this JSON
(prose may surround it; only this block is parsed):

\`\`\`learning-os
{
  "version": 1,
  "sessionId": "<echo the Session id from this export header>",
  "reviews": [
    { "topicTitle": "<exact title>", "topicId": null, "quality": 0, "note": "optional" }
  ],
  "proposedTopics": [
    { "title": "...", "type": "pattern", "domain": "DSA", "description": "...",
      "prerequisiteTitles": [], "parentTitle": null, "aiContext": "why proposed" }
  ],
  "noteSummaries": [
    { "topicTitle": "...", "keyInsight": "...", "invariant": "...",
      "contradiction": "...", "suggestedNoteRef": "..." }
  ],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: quality is 0–5. Reference topics by their exact title. Omit arrays you have nothing for
(use []). Do not add fields outside this schema.`;
```

- [ ] **Step 2: Write the failing test**

`apps/api/src/sessions/export-generator.service.spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import { ExportGeneratorService } from "./export-generator.service";

describe("ExportGeneratorService", () => {
  let service: ExportGeneratorService;

  beforeEach(async () => {
    const prisma = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          { id: "t1", title: "Stacks & queues", domain: "DSA", status: "active",
            interval: 1, repetitions: 3, nextReviewAt: new Date("2026-01-01"), noteRef: null,
            summary: null, parentId: null },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
    };
    const metrics = {
      dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
      struggleRatio7d: jest.fn().mockResolvedValue(0.44),
      masteryStatus: new MetricsService(prisma as any).masteryStatus,
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    service = mod.get(ExportGeneratorService);
  });

  it("always includes WHO I AM and the OUTPUT CONTRACT", async () => {
    const md = await service.generate({ now: new Date("2026-01-08T09:00:00Z") });
    expect(md).toContain("## WHO I AM");
    expect(md).toContain("learning-os");
    expect(md).toContain("OUTPUT CONTRACT");
  });

  it("includes a ROADMAP section with the seeded topic", async () => {
    const md = await service.generate({ now: new Date("2026-01-08T09:00:00Z") });
    expect(md).toContain("ROADMAP");
    expect(md).toContain("Stacks & queues");
  });

  it("adds a SESSION GOAL section only when focusTopicId is set", async () => {
    const without = await service.generate({ now: new Date("2026-01-08T09:00:00Z") });
    expect(without).not.toContain("SESSION GOAL");
    const withFocus = await service.generate({ focusTopicId: "t1", now: new Date("2026-01-08T09:00:00Z") });
    expect(withFocus).toContain("SESSION GOAL");
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test export-generator`
Expected: FAIL — `ExportGeneratorService` not found.

- [ ] **Step 4: Implement the generator**

`apps/api/src/sessions/export-generator.service.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import type { Topic } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import { OUTPUT_CONTRACT } from "./output-contract";

const WHO_I_AM = `## WHO I AM (stable)
Name: Dima
Role: Mid-senior full-stack dev, TypeScript + Solidity + DeFi
Learning style: Socratic, depth-first, tabulation over memoization
Code style: readable > optimized, TypeScript
Note system: OneNote (iPad drawings) + Obsidian (markdown)`;

function statusGlyph(t: Topic): string {
  if (t.status === "mastered") return "✓";
  if (t.status === "active") return "●";
  return "○";
}

@Injectable()
export class ExportGeneratorService {
  constructor(
    private prisma: PrismaService,
    private metrics: MetricsService,
  ) {}

  async generate(opts: { mode?: string; focusTopicId?: string; now: Date }): Promise<string> {
    const mode = opts.mode ?? "full";
    const domainFilter = mode.startsWith("domain:") ? mode.slice("domain:".length) : null;

    const topics = await this.prisma.topic.findMany({
      where: domainFilter ? { domain: domainFilter } : {},
      orderBy: [{ domain: "asc" }, { createdAt: "asc" }],
    });

    const sections: string[] = [];
    sections.push(
      `---\nTERRAIN — SESSION CONTEXT\nGenerated: ${opts.now.toISOString()}\nSession: <set-on-persist>\nExport: ${mode}\n---`,
    );
    sections.push(WHO_I_AM);
    sections.push(this.roadmap(topics));
    sections.push(await this.due(opts.now));
    sections.push(`## RECENT SIGNALS\nStruggle ratio 7d: ${Math.round(
      (await this.metrics.struggleRatio7d(opts.now)) * 100,
    )}% (target 40-60%)`);
    sections.push(await this.mastery(topics));
    if (opts.focusTopicId) {
      const focus = topics.find((t) => t.id === opts.focusTopicId);
      sections.push(
        `## SESSION GOAL\nFocus: ${focus ? focus.title : opts.focusTopicId}\nStyle: Socratic; push back if I move too fast; enforce confusion time.`,
      );
    }
    sections.push(OUTPUT_CONTRACT);
    return sections.join("\n\n");
  }

  private roadmap(topics: Topic[]): string {
    const byDomain = new Map<string, Topic[]>();
    for (const t of topics) {
      const arr = byDomain.get(t.domain) ?? [];
      arr.push(t);
      byDomain.set(t.domain, arr);
    }
    const blocks: string[] = [];
    for (const [domain, list] of byDomain) {
      const lines = list
        .filter((t) => !t.parentId)
        .map((t) => {
          const children = list.filter((c) => c.parentId === t.id);
          const head = `${statusGlyph(t)} ${t.title}`;
          const sub = children.map((c) => `  ├─ ${statusGlyph(c)} ${c.title}`).join("\n");
          return sub ? `${head}\n${sub}` : head;
        });
      blocks.push(`## ROADMAP — ${domain}\n${lines.join("\n")}`);
    }
    return blocks.join("\n\n");
  }

  private async due(now: Date): Promise<string> {
    const { overdue, dueToday } = await this.metrics.dueTopics(now);
    const fmt = (t: Topic) => `- ${t.title} [${t.topicType}]`;
    const overdueBlock = overdue.length ? overdue.map(fmt).join("\n") : "- (none)";
    const todayBlock = dueToday.length ? dueToday.map(fmt).join("\n") : "- (none)";
    return `## DUE FOR REVIEW TODAY\nOVERDUE:\n${overdueBlock}\n\nDUE TODAY:\n${todayBlock}`;
  }

  private async mastery(topics: Topic[]): Promise<string> {
    const active = topics.filter((t) => t.status === "active");
    if (active.length === 0) return `## MASTERY CONDITIONS\n- (no active topics)`;
    const lines: string[] = [];
    for (const t of active) {
      const appEventCount = await this.prisma.applicationEvent.count({ where: { topicId: t.id } });
      const s = this.metrics.masteryStatus({
        interval: t.interval,
        appEventCount,
        noteRef: t.noteRef,
        summary: t.summary,
      });
      const mark = (b: boolean) => (b ? "✓" : "✗");
      lines.push(
        `- ${t.title}: retention ${mark(s.retention)} application ${mark(s.application)} teaching ${mark(s.teaching)}`,
      );
    }
    return `## MASTERY CONDITIONS\n${lines.join("\n")}`;
  }
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `yarn workspace @terrain/api test export-generator`
Expected: PASS (3 tests).

---

### Task 6: Sessions module — export endpoint persists `SessionExport`

**Files:**
- Create: `apps/api/src/sessions/sessions.service.ts`
- Create: `apps/api/src/sessions/sessions.controller.ts`
- Create: `apps/api/src/sessions/sessions.module.ts`
- Test: `apps/api/src/sessions/sessions.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `SessionsModule`)

**Interfaces:**
- Consumes: `ExportGeneratorService`, `PrismaService`, `MetricsService` (via module imports).
- Produces:
  - `SessionsService.createExport(opts: { mode?: string; focusTopicId?: string }): Promise<{ id: string; exportMd: string }>` — generates markdown, persists a `SessionExport` row (`mode`, `domains`, `focusTopicId`, `exportMd`), then injects the row id into the markdown header's `Session: <set-on-persist>` placeholder and updates the stored `exportMd` to match.
  - REST: `GET /sessions/export?mode=&focusTopicId=` → `{ id, exportMd }`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/sessions/sessions.service.spec.ts`:
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ExportGeneratorService } from "./export-generator.service";
import { SessionsService } from "./sessions.service";

describe("SessionsService.createExport", () => {
  let service: SessionsService;
  let create: jest.Mock;
  let update: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ id: "sess-1" });
    update = jest.fn().mockResolvedValue({});
    const prisma = { sessionExport: { create, update } };
    const generator = {
      generate: jest.fn().mockResolvedValue("header Session: <set-on-persist>\n\nbody"),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExportGeneratorService, useValue: generator },
      ],
    }).compile();
    service = mod.get(SessionsService);
  });

  it("persists the export and injects the session id into the markdown", async () => {
    const out = await service.createExport({ mode: "full" });
    expect(out.id).toBe("sess-1");
    expect(out.exportMd).toContain("Session: sess-1");
    expect(out.exportMd).not.toContain("<set-on-persist>");
    expect(update).toHaveBeenCalledWith({
      where: { id: "sess-1" },
      data: { exportMd: expect.stringContaining("Session: sess-1") },
    });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test sessions.service`
Expected: FAIL — `SessionsService` not found.

- [ ] **Step 3: Implement the service**

`apps/api/src/sessions/sessions.service.ts`:
```typescript
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ExportGeneratorService } from "./export-generator.service";

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private generator: ExportGeneratorService,
  ) {}

  async createExport(opts: { mode?: string; focusTopicId?: string }) {
    const mode = opts.mode ?? "full";
    const draft = await this.generator.generate({ ...opts, now: new Date() });
    const row = await this.prisma.sessionExport.create({
      data: { mode, domains: [], focusTopicId: opts.focusTopicId, exportMd: draft },
    });
    const exportMd = draft.replace("Session: <set-on-persist>", `Session: ${row.id}`);
    await this.prisma.sessionExport.update({ where: { id: row.id }, data: { exportMd } });
    return { id: row.id, exportMd };
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn workspace @terrain/api test sessions.service`
Expected: PASS.

- [ ] **Step 5: Controller + module**

`apps/api/src/sessions/sessions.controller.ts`:
```typescript
import { Controller, Get, Query } from "@nestjs/common";
import { SessionsService } from "./sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private service: SessionsService) {}
  @Get("export")
  export(@Query("mode") mode?: string, @Query("focusTopicId") focusTopicId?: string) {
    return this.service.createExport({ mode, focusTopicId });
  }
}
```

`apps/api/src/sessions/sessions.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { MetricsModule } from "../metrics/metrics.module";
import { ExportGeneratorService } from "./export-generator.service";
import { SessionsService } from "./sessions.service";
import { SessionsController } from "./sessions.controller";

@Module({
  imports: [MetricsModule],
  providers: [ExportGeneratorService, SessionsService],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
```

Register `SessionsModule` in `AppModule`.

- [ ] **Step 6: Full suite + build + smoke test**

Run `yarn workspace @terrain/api test` (all suites green) and `yarn workspace @terrain/api build` (0). Then smoke test the real export:
```bash
cd apps/api && (yarn start &) ; sleep 12
curl -s "localhost:3000/sessions/export" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log("id:",j.id);console.log(j.exportMd.slice(0,600))})'
pkill -f "nest start" || true
```
Expected: a `SessionExport` id and markdown containing `WHO I AM`, `ROADMAP — DSA` (seeded topics), `DUE FOR REVIEW TODAY`, `OUTPUT CONTRACT`, and `Session: <id>` (no `<set-on-persist>` left). Stop the server.

---

## Self-Review

**Spec coverage (slice 1b):**
- Derived metrics (mastery, labels, struggle ratio, due lists) — Task 1 ✓ (spec §3, §9 derived rules)
- Freeze economy (earn 1/5 active, cap 2, quiet/active/frozen/break, `/skip` spends a freeze) — Tasks 2–4 ✓ (spec §9)
- Nightly cron classifies the prior day idempotently — Tasks 3–4 ✓
- Parameterized single-generator export; WHO I AM + OUTPUT CONTRACT always present; `domain:` filters, `focus` adds — Task 5 ✓ (spec §5)
- Export persisted as `SessionExport`, with sessionId echoed into the markdown — Task 6 ✓ (spec §5, §6)
- Deferred (slice 1d): the web "Copy" screen surfaces `GET /sessions/export`. Telegram morning/quick-log/evening (slice 1c). Import parser (Phase 2). Not gaps.

**Placeholder scan:** none — all steps carry full code. (`Session: <set-on-persist>` is an intentional in-markdown token replaced at persist time, not a plan placeholder.)

**Type consistency:** `DayType` referenced via the Prisma enum object across `StreakService`/cron; `StreakCore` matches the four mutated fields incl. `activeDayCounter` (added in Task 2); `MetricsService.masteryStatus` input shape `{interval, appEventCount, noteRef, summary}` identical in Tasks 1 and 5; `ExportGeneratorService.generate({mode, focusTopicId, now})` signature consistent between Tasks 5 and 6.

**Carry-over from 1a:** consider folding the deferred `start:prod` path fix and removing the Hello-World scaffold into an early cleanup step if convenient; not required for 1b correctness.
