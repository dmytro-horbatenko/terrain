# Terrain Phase 2 (backend) — Session Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the `learning-os` JSON block a Claude.ai session returns — validate it, resolve its title references against the DB, and atomically apply reviews (SM-2), AI-proposed topics, note summaries, and the next-session suggestion — stamping the originating `SessionExport`.

**Architecture:** A new `ImportModule` exposes `preview(raw)` (parse + resolve + diff, no writes) and `apply(raw)` (one interactive `prisma.$transaction`, all-or-nothing) behind `POST /sessions/import/preview` and `POST /sessions/import`. Title resolution is trim+case-insensitive against existing ∪ batch topics; ambiguous/self-referential/missing references block the whole import. SM-2 logic is extracted from `ReviewsService` into a shared `buildReviewWrites` helper. The imported `nextSession` is persisted on `SessionExport` and surfaced in the next export.

**Tech Stack:** NestJS 10, Prisma 5.22/Postgres, `@terrain/types` (`parseLearningOs`, `learningOsSchema`), `@terrain/sr-engine` (`sm2`), Jest. CommonJS monorepo.

## Global Constraints

- CommonJS Nest app; **extensionless relative imports** (`./import.service`, `../reviews/sr-apply`); workspace imports via `@terrain/*`. The hand-written service/spec files use **double quotes** — match that; do not reformat existing files.
- Postgres on host port **5433** (already up; `apps/api/.env` has `DATABASE_URL`). Use the pinned binary `yarn workspace @terrain/api exec prisma ...` (never `npx`/`dlx` → pulls Prisma 7).
- **Store facts, derive the rest.** The only new stored state is the two `SessionExport.next*` columns (Task 1). Resolution/diffs are computed, never stored.
- **Resolution:** title matching is `trim().toLowerCase()`. A reference resolving to **>1 existing topic** is `ambiguous`; a proposed topic referencing **itself** as parent/prereq is `self-reference`; a title in neither existing nor the same-block proposed set is `missing`. Any of the three → that reference is in `unresolved[]`.
- **All-or-nothing:** `apply` writes nothing if the plan is not applicable (already imported → 409; any unresolved → 422). The successful apply runs in ONE interactive transaction.
- **Existing topics are never edited by the proposed-topic path**: an `alreadyExists` proposed topic is reused read-only (its proposed parent/prereq/aiContext are ignored). Reviews and note summaries still mutate their target topics.
- Imported reviews use `mode = "claude_session"`. Imported topics are `aiProposed: true`, `status: "planned"`, and their `type` is registered in `TopicType` (normalized key) inside the same transaction.
- Work is left **uncommitted** in the working tree (user preference) — **do not run `git commit`/`git add`** or any git mutation.

Spec: `docs/superpowers/specs/2026-06-30-terrain-import-design.md`.

---

### Task 1: Add `nextFocusTitle` / `nextColdChallenge` to `SessionExport` (schema + migration)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (two fields)

**Interfaces:**
- Produces: `SessionExport.nextFocusTitle String?`, `SessionExport.nextColdChallenge String?` — store the imported `nextSession`.

- [ ] **Step 1: Add the fields**

In `model SessionExport`, add (alongside the existing fields):
```prisma
  nextFocusTitle    String?
  nextColdChallenge String?
```

- [ ] **Step 2: Create and apply the migration**

Run: `yarn workspace @terrain/api exec prisma migrate dev --name session_next_focus`
Expected: a new migration created + applied; client regenerated.

- [ ] **Step 3: Verify**

Run: `yarn workspace @terrain/api build` → exits 0 (client type has the two fields).

---

### Task 2: Extract the SM-2 write-builder `buildReviewWrites` (TDD) + reuse in `ReviewsService`

**Files:**
- Create: `apps/api/src/reviews/sr-apply.ts`
- Test:   `apps/api/src/reviews/sr-apply.spec.ts`
- Modify: `apps/api/src/reviews/reviews.service.ts` (call the helper)

**Interfaces:**
- Consumes: `@terrain/sr-engine` `sm2`/`SRState`; `@prisma/client` types.
- Produces:
  - `buildReviewWrites(topic: Topic, quality: number, mode: ReviewMode, note: string | undefined, now: Date, durationMin?: number): { review: Prisma.ReviewUncheckedCreateInput; topic: Prisma.TopicUpdateInput }` — pure. Computes the SM-2 transition and the two write payloads (review row + topic SR update, `learnedAt ??= now`, `planned → active`).

- [ ] **Step 1: Write the failing test** — `apps/api/src/reviews/sr-apply.spec.ts`
```typescript
import { buildReviewWrites } from "./sr-apply";

const baseTopic: any = {
  id: "t1", title: "T", domain: "DSA", topicType: "pattern", status: "planned",
  description: null, summary: null, noteRef: null, parentId: null,
  easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewAt: null, learnedAt: null,
  aiProposed: false, aiContext: null, createdAt: new Date(), updatedAt: new Date(),
};

describe("buildReviewWrites", () => {
  it("computes the SM-2 transition, flips planned -> active, sets learnedAt", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const { review, topic } = buildReviewWrites(baseTopic, 5, "claude_session", "n", now);
    expect(review.topicId).toBe("t1");
    expect(review.mode).toBe("claude_session");
    expect(review.intervalBefore).toBe(0);
    expect(review.intervalAfter).toBeGreaterThan(0);
    expect(review.reviewedAt).toEqual(now);
    expect(topic.status).toBe("active");
    expect(topic.learnedAt).toEqual(now);
  });

  it("preserves status and learnedAt when the topic is not planned", () => {
    const now = new Date("2026-01-08T00:00:00Z");
    const learned = new Date("2025-12-01T00:00:00Z");
    const t = { ...baseTopic, status: "active", learnedAt: learned };
    const { topic } = buildReviewWrites(t, 4, "app_log", undefined, now);
    expect(topic.status).toBe("active");
    expect(topic.learnedAt).toEqual(learned);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test sr-apply`
Expected: FAIL — cannot find module `./sr-apply`.

- [ ] **Step 3: Implement the helper** — `apps/api/src/reviews/sr-apply.ts`
```typescript
import { sm2, type SRState } from "@terrain/sr-engine";
import type { Prisma, ReviewMode, Topic } from "@prisma/client";

export function buildReviewWrites(
  topic: Topic,
  quality: number,
  mode: ReviewMode,
  note: string | undefined,
  now: Date,
  durationMin?: number,
): { review: Prisma.ReviewUncheckedCreateInput; topic: Prisma.TopicUpdateInput } {
  const before: SRState = {
    easeFactor: topic.easeFactor,
    interval: topic.interval,
    repetitions: topic.repetitions,
    nextReviewAt: topic.nextReviewAt,
  };
  const after = sm2(quality, before, now);
  return {
    review: {
      topicId: topic.id,
      quality,
      mode,
      durationMin,
      note,
      intervalBefore: before.interval,
      intervalAfter: after.interval,
      reviewedAt: now,
    },
    topic: {
      easeFactor: after.easeFactor,
      interval: after.interval,
      repetitions: after.repetitions,
      nextReviewAt: after.nextReviewAt,
      learnedAt: topic.learnedAt ?? now,
      status: topic.status === "planned" ? "active" : topic.status,
    },
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn workspace @terrain/api test sr-apply`
Expected: PASS (2 tests).

- [ ] **Step 5: Refactor `ReviewsService.logReview` to use the helper**

In `apps/api/src/reviews/reviews.service.ts`, add the import and replace the body of `logReview` so it delegates to `buildReviewWrites` (behavior unchanged):
```typescript
import { buildReviewWrites } from "./sr-apply";
```
```typescript
  async logReview(dto: LogReviewDto) {
    const topic = await this.prisma.topic.findUnique({ where: { id: dto.topicId } });
    if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);

    const now = new Date();
    const writes = buildReviewWrites(topic, dto.quality, dto.mode, dto.note, now, dto.durationMin);

    const [review] = await this.prisma.$transaction([
      this.prisma.review.create({ data: writes.review }),
      this.prisma.topic.update({ where: { id: dto.topicId }, data: writes.topic }),
    ]);
    return review;
  }
```
(Remove the now-unused `sm2`/`SRState` import from `reviews.service.ts` if the linter flags it.)

- [ ] **Step 6: Verify reuse didn't regress**

Run: `yarn workspace @terrain/api test reviews.service` → existing reviews tests still PASS.
Run: `yarn workspace @terrain/api build` → exits 0.

---

### Task 3: `ImportService` — resolve + plan + `preview` (TDD)

**Files:**
- Create: `apps/api/src/import/import.service.ts`
- Test:   `apps/api/src/import/import.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`; `parseLearningOs`/`LearningOsOutput` from `@terrain/types`; `sm2`/`SRState` from `@terrain/sr-engine`; `buildReviewWrites` (Task 2, used in Task 4).
- Produces (exported from `import.service.ts`, relied on by Task 4 + Task 5):
  - Types `SrPreview`, `ResolvedReview`, `NewTopicPlan`, `NoteSummaryPlan`, `Unresolved`, `ImportPlan`, `ImportResult`.
  - `composeSummary(ns): string` — Obsidian-ready markdown.
  - `ImportService.preview(raw: string): Promise<ImportPlan>` — parse + resolve, no writes. Throws `BadRequestException` (bad block) / `NotFoundException` (unknown `sessionId`).

- [ ] **Step 1: Write the failing test** — `apps/api/src/import/import.service.spec.ts`
```typescript
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { ImportService } from "./import.service";

const fence = (obj: any) => "prose\n```learning-os\n" + JSON.stringify(obj) + "\n```\nmore";

const TOPIC = (over: any = {}) => ({
  id: "t1", title: "Stacks", domain: "DSA", topicType: "pattern", status: "active",
  description: null, summary: null, noteRef: null, parentId: null,
  easeFactor: 2.5, interval: 6, repetitions: 2, nextReviewAt: new Date("2026-01-01"),
  learnedAt: new Date("2025-12-01"), aiProposed: false, aiContext: null,
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

function build(prismaOver: any = {}) {
  const prisma: any = {
    sessionExport: { findUnique: jest.fn().mockResolvedValue({ id: "sess-1", importedAt: null }) },
    topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
    ...prismaOver,
  };
  return { prisma };
}

async function svc(prisma: any): Promise<ImportService> {
  const mod = await Test.createTestingModule({
    providers: [ImportService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(ImportService);
}

describe("ImportService.preview", () => {
  it("resolves a review by title and computes an SM-2 preview; plan is applicable", async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1",
      reviews: [{ topicTitle: "Stacks", topicId: null, quality: 4 }],
      proposedTopics: [], noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.reviews[0].resolvedTopicId).toBe("t1");
    expect(plan.reviews[0].srPreview!.intervalBefore).toBe(6);
    expect(plan.reviews[0].srPreview!.intervalAfter).toBeGreaterThan(6);
    expect(plan.unresolved).toHaveLength(0);
    expect(plan.applicable).toBe(true);
  });

  it("flags an unknown review title as missing -> not applicable", async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1",
      reviews: [{ topicTitle: "Nope", quality: 3 }], proposedTopics: [], noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.unresolved).toEqual([
      expect.objectContaining({ kind: "review", title: "Nope", reason: "missing" }),
    ]);
    expect(plan.applicable).toBe(false);
  });

  it("flags an ambiguous title (two existing matches) as ambiguous", async () => {
    const { prisma } = build({
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC({ id: "a" }), TOPIC({ id: "b" })]) },
    });
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1",
      reviews: [{ topicTitle: "stacks", quality: 3 }], proposedTopics: [], noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.unresolved[0]).toEqual(
      expect.objectContaining({ kind: "review", reason: "ambiguous" }));
  });

  it("resolves a proposed topic and a note summary targeting it (batch), and compounds two reviews on one topic", async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1",
      reviews: [
        { topicTitle: "Stacks", quality: 5 },
        { topicTitle: "Stacks", quality: 5 },
      ],
      proposedTopics: [{ title: "Monotonic stack", type: "pattern", domain: "DSA", prerequisiteTitles: ["Stacks"], parentTitle: "Stacks" }],
      noteSummaries: [{ topicTitle: "Monotonic stack", keyInsight: "k" }] });
    const plan = await service.preview(raw);
    expect(plan.newTopics[0].alreadyExists).toBe(false);
    expect(plan.noteSummaries[0].composedSummary).toContain("Key insight");
    expect(plan.unresolved).toHaveLength(0);
    // compounding: 2nd review starts from the 1st review's projected interval
    expect(plan.reviews[1].srPreview!.intervalBefore).toBe(plan.reviews[0].srPreview!.intervalAfter);
  });

  it("flags a self-referential parent as self-reference", async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1", reviews: [],
      proposedTopics: [{ title: "Loop", type: "pattern", domain: "DSA", prerequisiteTitles: [], parentTitle: "Loop" }],
      noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.unresolved[0]).toEqual(
      expect.objectContaining({ kind: "parent", reason: "self-reference" }));
  });

  it("marks alreadyImported when the SessionExport has importedAt", async () => {
    const { prisma } = build({
      sessionExport: { findUnique: jest.fn().mockResolvedValue({ id: "sess-1", importedAt: new Date() }) },
    });
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1", reviews: [], proposedTopics: [], noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.alreadyImported).toBe(true);
    expect(plan.applicable).toBe(false);
  });

  it("uses default SR state for a review targeting a batch-created topic", async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1",
      reviews: [{ topicTitle: "Monotonic stack", quality: 5 }],
      proposedTopics: [{ title: "Monotonic stack", type: "pattern", domain: "DSA", prerequisiteTitles: [], parentTitle: null }],
      noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.reviews[0].resolvedTopicId).toBeNull();      // batch topic has no id yet
    expect(plan.reviews[0].srPreview!.intervalBefore).toBe(0); // default SR state
    expect(plan.reviews[0].srPreview!.intervalAfter).toBeGreaterThan(0);
    expect(plan.unresolved).toHaveLength(0);
    expect(plan.applicable).toBe(true);
  });

  it("resolves a review by exact topicId, bypassing title matching", async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({ version: 1, sessionId: "sess-1",
      reviews: [{ topicTitle: "Wrong title", topicId: "t1", quality: 4 }],
      proposedTopics: [], noteSummaries: [] });
    const plan = await service.preview(raw);
    expect(plan.reviews[0].resolvedTopicId).toBe("t1");       // id wins over the wrong title
    expect(plan.reviews[0].srPreview!.intervalBefore).toBe(6); // from the t1 mock topic
    expect(plan.unresolved).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test import.service`
Expected: FAIL — cannot find module `./import.service`.

- [ ] **Step 3: Implement the service** — `apps/api/src/import/import.service.ts`
```typescript
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { parseLearningOs, type LearningOsOutput } from "@terrain/types";
import { sm2, type SRState } from "@terrain/sr-engine";
import type { SessionExport, Topic } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const norm = (s: string) => s.trim().toLowerCase();
const DEFAULT_SR: SRState = { easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewAt: null };

export interface SrPreview { intervalBefore: number; intervalAfter: number; nextReviewAt: Date }
export interface ResolvedReview {
  topicTitle: string; topicId: string | null; quality: number; note?: string;
  resolvedTopicId: string | null; srPreview?: SrPreview;
}
export interface NewTopicPlan {
  title: string; topicType: string; domain: string; description?: string;
  prerequisiteTitles: string[]; parentTitle: string | null; aiContext?: string; alreadyExists: boolean;
}
export interface NoteSummaryPlan {
  topicTitle: string; resolvedTopicId: string | null; composedSummary: string; suggestedNoteRef?: string;
}
export interface Unresolved {
  kind: "review" | "noteSummary" | "prerequisite" | "parent";
  title: string; context: string; reason: "missing" | "ambiguous" | "self-reference";
}
export interface ImportPlan {
  sessionExportId: string; alreadyImported: boolean;
  reviews: ResolvedReview[]; newTopics: NewTopicPlan[]; noteSummaries: NoteSummaryPlan[];
  nextSession?: { focusTitle?: string; coldChallenge?: string };
  unresolved: Unresolved[]; applicable: boolean;
}
export interface ImportResult {
  sessionExportId: string; reviewsApplied: number; topicsCreated: string[];
  noteSummariesApplied: number; nextSessionStored: boolean;
}

export function composeSummary(ns: { keyInsight: string; invariant?: string; contradiction?: string }): string {
  const parts = [`**Key insight:** ${ns.keyInsight}`];
  if (ns.invariant) parts.push(`**Invariant:** ${ns.invariant}`);
  if (ns.contradiction) parts.push(`**Watch out:** ${ns.contradiction}`);
  return parts.join("\n\n");
}

function stateFromTopic(t: Topic): SRState {
  return { easeFactor: t.easeFactor, interval: t.interval, repetitions: t.repetitions, nextReviewAt: t.nextReviewAt };
}

@Injectable()
export class ImportService {
  constructor(protected prisma: PrismaService) {}

  protected now(): Date {
    return new Date();
  }

  protected async load(raw: string): Promise<{ parsed: LearningOsOutput; sessionExport: SessionExport; existing: Topic[] }> {
    let parsed: LearningOsOutput;
    try {
      parsed = parseLearningOs(raw);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? "Invalid learning-os block.");
    }
    const sessionExport = await this.prisma.sessionExport.findUnique({ where: { id: parsed.sessionId } });
    if (!sessionExport) throw new NotFoundException(`SessionExport ${parsed.sessionId} not found`);
    const existing = await this.prisma.topic.findMany();
    return { parsed, sessionExport, existing };
  }

  async preview(raw: string): Promise<ImportPlan> {
    const { parsed, sessionExport, existing } = await this.load(raw);
    return this.buildPlan(parsed, sessionExport, existing);
  }

  protected buildPlan(parsed: LearningOsOutput, sessionExport: SessionExport, existing: Topic[]): ImportPlan {
    const byNorm = new Map<string, Topic[]>();
    for (const t of existing) {
      const k = norm(t.title);
      (byNorm.get(k) ?? byNorm.set(k, []).get(k)!).push(t);
    }
    const byId = new Map(existing.map((t) => [t.id, t]));
    const batchNorm = new Set(parsed.proposedTopics.map((p) => norm(p.title)));
    const unresolved: Unresolved[] = [];

    // returns { id, ambiguous } against EXISTING topics
    const resolveExisting = (title: string): { id: string | null; ambiguous: boolean } => {
      const m = byNorm.get(norm(title)) ?? [];
      if (m.length === 0) return { id: null, ambiguous: false };
      if (m.length > 1) return { id: null, ambiguous: true };
      return { id: m[0].id, ambiguous: false };
    };
    const inBatch = (title: string) => batchNorm.has(norm(title));

    // classify a parent/prereq reference belonging to proposed topic `ownerTitle`
    const checkLink = (kind: "parent" | "prerequisite", title: string, ownerTitle: string) => {
      if (norm(title) === norm(ownerTitle)) {
        unresolved.push({ kind, title, context: `proposedTopic "${ownerTitle}"`, reason: "self-reference" });
        return;
      }
      const ex = resolveExisting(title);
      if (ex.ambiguous) unresolved.push({ kind, title, context: `proposedTopic "${ownerTitle}"`, reason: "ambiguous" });
      else if (ex.id == null && !inBatch(title)) unresolved.push({ kind, title, context: `proposedTopic "${ownerTitle}"`, reason: "missing" });
    };

    const newTopics: NewTopicPlan[] = parsed.proposedTopics.map((p) => {
      const ex = resolveExisting(p.title);
      if (p.parentTitle) checkLink("parent", p.parentTitle, p.title);
      for (const pre of p.prerequisiteTitles) checkLink("prerequisite", pre, p.title);
      return {
        title: p.title, topicType: p.type, domain: p.domain, description: p.description,
        prerequisiteTitles: p.prerequisiteTitles, parentTitle: p.parentTitle ?? null,
        aiContext: p.aiContext, alreadyExists: ex.id != null,
      };
    });

    // reviews: resolve by topicId then title; sequential per-topic compounding; default state for batch-new
    const running = new Map<string, SRState>();
    const reviews: ResolvedReview[] = parsed.reviews.map((r) => {
      let resolvedTopicId: string | null = null;
      let stateKey: string | null = null;
      let base: SRState | null = null;
      if (r.topicId && byId.has(r.topicId)) {
        resolvedTopicId = r.topicId;
        stateKey = r.topicId;
        base = stateFromTopic(byId.get(r.topicId)!);
      } else {
        const ex = resolveExisting(r.topicTitle);
        if (ex.ambiguous) {
          unresolved.push({ kind: "review", title: r.topicTitle, context: "review", reason: "ambiguous" });
        } else if (ex.id != null) {
          resolvedTopicId = ex.id; stateKey = ex.id; base = stateFromTopic(byId.get(ex.id)!);
        } else if (inBatch(r.topicTitle)) {
          stateKey = "batch:" + norm(r.topicTitle); base = DEFAULT_SR;
        } else {
          unresolved.push({ kind: "review", title: r.topicTitle, context: "review", reason: "missing" });
        }
      }
      let srPreview: SrPreview | undefined;
      if (stateKey && base) {
        const before = running.get(stateKey) ?? base;
        const after = sm2(r.quality, before, this.now());
        running.set(stateKey, after);
        srPreview = { intervalBefore: before.interval, intervalAfter: after.interval, nextReviewAt: after.nextReviewAt! };
      }
      return { topicTitle: r.topicTitle, topicId: r.topicId ?? null, quality: r.quality, note: r.note, resolvedTopicId, srPreview };
    });

    const noteSummaries: NoteSummaryPlan[] = parsed.noteSummaries.map((ns) => {
      const ex = resolveExisting(ns.topicTitle);
      let resolvedTopicId: string | null = null;
      if (ex.ambiguous) unresolved.push({ kind: "noteSummary", title: ns.topicTitle, context: "noteSummary", reason: "ambiguous" });
      else if (ex.id != null) resolvedTopicId = ex.id;
      else if (!inBatch(ns.topicTitle)) unresolved.push({ kind: "noteSummary", title: ns.topicTitle, context: "noteSummary", reason: "missing" });
      return { topicTitle: ns.topicTitle, resolvedTopicId, composedSummary: composeSummary(ns), suggestedNoteRef: ns.suggestedNoteRef };
    });

    const alreadyImported = sessionExport.importedAt != null;
    return {
      sessionExportId: sessionExport.id, alreadyImported,
      reviews, newTopics, noteSummaries, nextSession: parsed.nextSession,
      unresolved, applicable: unresolved.length === 0 && !alreadyImported,
    };
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `yarn workspace @terrain/api test import.service`
Expected: PASS (8 tests).

---

### Task 4: `ImportService.apply` — interactive transaction + guards (TDD)

**Files:**
- Modify: `apps/api/src/import/import.service.ts` (add `apply`)
- Modify: `apps/api/src/import/import.service.spec.ts` (guard tests)

**Interfaces:**
- Consumes: `buildReviewWrites` (Task 2); the plan/types from Task 3.
- Produces: `ImportService.apply(raw: string): Promise<ImportResult>` — throws `ConflictException` (409, already imported) or `UnprocessableEntityException` (422, unresolved) **before any write**; otherwise commits everything in one `prisma.$transaction(async (tx) => …)`.

- [ ] **Step 1: Write the failing tests** — append to `apps/api/src/import/import.service.spec.ts`
```typescript
import { ConflictException, UnprocessableEntityException } from "@nestjs/common";

describe("ImportService.apply guards (no writes on reject)", () => {
  it("throws 409 and does not open a transaction when already imported", async () => {
    const tx = jest.fn();
    const prisma: any = {
      sessionExport: { findUnique: jest.fn().mockResolvedValue({ id: "sess-1", importedAt: new Date() }) },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: tx,
    };
    const mod = await Test.createTestingModule({
      providers: [ImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = mod.get(ImportService);
    const raw = "```learning-os\n" + JSON.stringify({ version: 1, sessionId: "sess-1", reviews: [], proposedTopics: [], noteSummaries: [] }) + "\n```";
    await expect(service.apply(raw)).rejects.toBeInstanceOf(ConflictException);
    expect(tx).not.toHaveBeenCalled();
  });

  it("throws 422 and does not open a transaction when a reference is unresolved", async () => {
    const tx = jest.fn();
    const prisma: any = {
      sessionExport: { findUnique: jest.fn().mockResolvedValue({ id: "sess-1", importedAt: null }) },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: tx,
    };
    const mod = await Test.createTestingModule({
      providers: [ImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = mod.get(ImportService);
    const raw = "```learning-os\n" + JSON.stringify({ version: 1, sessionId: "sess-1", reviews: [{ topicTitle: "Ghost", quality: 3 }], proposedTopics: [], noteSummaries: [] }) + "\n```";
    await expect(service.apply(raw)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `yarn workspace @terrain/api test import.service`
Expected: FAIL — `service.apply is not a function`.

- [ ] **Step 3: Implement `apply`** — add to `ImportService` in `apps/api/src/import/import.service.ts`

Add imports at the top of the file:
```typescript
import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { buildReviewWrites } from "../reviews/sr-apply";
```
Add the method to the class:
```typescript
  async apply(raw: string): Promise<ImportResult> {
    const { parsed, sessionExport, existing } = await this.load(raw);
    const plan = this.buildPlan(parsed, sessionExport, existing);
    if (plan.alreadyImported) throw new ConflictException("This session export was already imported.");
    if (plan.unresolved.length > 0) {
      throw new UnprocessableEntityException({ message: "Unresolved references block import.", unresolved: plan.unresolved });
    }

    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const idByNorm = new Map<string, string>();
      for (const t of existing) idByNorm.set(norm(t.title), t.id);

      // a. create new topics (+ register type) for those that don't already exist
      const topicsCreated: string[] = [];
      for (const nt of plan.newTopics) {
        if (nt.alreadyExists) continue;
        const key = norm(nt.topicType);
        await tx.topicType.upsert({ where: { key }, update: {}, create: { key, label: nt.topicType.trim() } });
        const created = await tx.topic.create({
          data: {
            title: nt.title, domain: nt.domain, topicType: nt.topicType, description: nt.description,
            aiProposed: true, aiContext: nt.aiContext, status: "planned",
          },
        });
        idByNorm.set(norm(nt.title), created.id);
        topicsCreated.push(created.id);
      }

      // b. wire links (newly-created topics only)
      for (const nt of plan.newTopics) {
        if (nt.alreadyExists) continue;
        const selfId = idByNorm.get(norm(nt.title))!;
        if (nt.parentTitle) {
          const parentId = idByNorm.get(norm(nt.parentTitle));
          if (parentId) await tx.topic.update({ where: { id: selfId }, data: { parentId } });
        }
        for (const pre of nt.prerequisiteTitles) {
          const preId = idByNorm.get(norm(pre));
          if (preId) await tx.prerequisite.create({ data: { topicId: selfId, prerequisiteId: preId } });
        }
      }

      // c. apply reviews sequentially (re-read so multiple reviews on one topic compound)
      let reviewsApplied = 0;
      for (const r of plan.reviews) {
        const id = r.resolvedTopicId ?? idByNorm.get(norm(r.topicTitle));
        if (!id) continue;
        const topic = await tx.topic.findUnique({ where: { id } });
        if (!topic) continue;
        const writes = buildReviewWrites(topic, r.quality, "claude_session", r.note, now);
        await tx.review.create({ data: writes.review });
        await tx.topic.update({ where: { id }, data: writes.topic });
        reviewsApplied++;
      }

      // d. apply note summaries
      let noteSummariesApplied = 0;
      for (const ns of plan.noteSummaries) {
        const id = ns.resolvedTopicId ?? idByNorm.get(norm(ns.topicTitle));
        if (!id) continue;
        await tx.topic.update({
          where: { id },
          data: { summary: ns.composedSummary, ...(ns.suggestedNoteRef ? { noteRef: ns.suggestedNoteRef } : {}) },
        });
        noteSummariesApplied++;
      }

      // e. stamp the originating SessionExport + store nextSession
      const focusTitle = plan.nextSession?.focusTitle;
      const coldChallenge = plan.nextSession?.coldChallenge;
      await tx.sessionExport.update({
        where: { id: sessionExport.id },
        data: {
          importedAt: now, importedOutputRaw: raw, newTopicsCreated: topicsCreated,
          nextFocusTitle: focusTitle ?? null, nextColdChallenge: coldChallenge ?? null,
        },
      });

      return {
        sessionExportId: sessionExport.id, reviewsApplied, topicsCreated,
        noteSummariesApplied, nextSessionStored: !!(focusTitle && focusTitle.length > 0),
      };
    });
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `yarn workspace @terrain/api test import.service`
Expected: PASS (Task 3's 8 + 2 guard tests = 10).
Run: `yarn workspace @terrain/api build` → exits 0.

---

### Task 5: `ImportController` + `ImportModule` (register in `AppModule`)

**Files:**
- Create: `apps/api/src/import/import.controller.ts`
- Create: `apps/api/src/import/import.module.ts`
- Modify: `apps/api/src/app.module.ts` (register `ImportModule`)

**Interfaces:**
- Consumes: `ImportService`.
- Produces: `POST /sessions/import/preview` → `preview`; `POST /sessions/import` → `apply`. Both take `{ raw: string }`. `ImportModule` provides `ImportService` + declares the controller.

- [ ] **Step 1: Write the controller** — `apps/api/src/import/import.controller.ts`
```typescript
import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ImportService } from "./import.service";

@Controller("sessions/import")
export class ImportController {
  constructor(private service: ImportService) {}

  @Post("preview")
  @HttpCode(200)
  preview(@Body("raw") raw: string) {
    return this.service.preview(raw);
  }

  @Post()
  @HttpCode(200)
  apply(@Body("raw") raw: string) {
    return this.service.apply(raw);
  }
}
```

- [ ] **Step 2: Write the module** — `apps/api/src/import/import.module.ts`
```typescript
import { Module } from "@nestjs/common";
import { ImportService } from "./import.service";
import { ImportController } from "./import.controller";

@Module({
  providers: [ImportService],
  controllers: [ImportController],
})
export class ImportModule {}
```

- [ ] **Step 3: Register in `AppModule`** — `apps/api/src/app.module.ts`

Add the import (single-quote style of this file) and put `ImportModule` in the `imports` array:
```typescript
import { ImportModule } from './import/import.module';
```
(Append `ImportModule` to the `imports: [...]` array.)

- [ ] **Step 4: Verify boot + endpoints**

Run `yarn workspace @terrain/api build` → exits 0. Then start the API (`yarn workspace @terrain/api start`), wait for boot, and confirm routing:
```bash
curl -s -X POST localhost:3000/sessions/import -H 'Content-Type: application/json' -d '{"raw":"no fence here"}'
```
Expected: HTTP 400 (BadRequest — "No learning-os block found…"). Stop the server (`pkill -f "nest start"`).

---

### Task 6: Surface `nextSession` in the export (TDD)

**Files:**
- Modify: `apps/api/src/sessions/export-generator.service.ts` (suggested-focus section)
- Modify: `apps/api/src/sessions/export-generator.service.spec.ts` (mock fix + new test)

**Interfaces:**
- Consumes: `SessionExport.nextFocusTitle`/`nextColdChallenge` (Task 1).
- Produces: when `generate` is called with **no `focusTopicId`**, the export includes a `## SUGGESTED NEXT FOCUS (from last session)` section iff a prior imported `SessionExport` carries a `nextFocusTitle`.

- [ ] **Step 1: Fix the existing mocks + write the failing test** — `apps/api/src/sessions/export-generator.service.spec.ts`

The new §8 lookup runs on the no-`focusTopicId` path that **every** existing export-generator test hits. Add `sessionExport: { findFirst: jest.fn().mockResolvedValue(null) }` to **every** `prisma` mock object in this spec file — the `beforeEach` mock **and** each inline `prisma` object built inside the deep-tree, blocked-glyph, and reviewing-tag tests (added in 1b's Task 7). Any mock left without it throws `TypeError: Cannot read properties of undefined (reading 'findFirst')`:
```typescript
      sessionExport: { findFirst: jest.fn().mockResolvedValue(null) },
```
Then add this test inside the `describe("ExportGeneratorService", …)` block. It builds its own module so it can return an imported export from `findFirst`:
```typescript
  it("adds SUGGESTED NEXT FOCUS from the last import when no focusTopicId", async () => {
    const prisma: any = {
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: { findFirst: jest.fn().mockResolvedValue({ nextFocusTitle: "Heaps", nextColdChallenge: "LC #215" }) },
    };
    const metrics = {
      dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
      struggleRatio7d: jest.fn().mockResolvedValue(0),
      masteryStatus: () => ({ retention: false, application: false, teaching: false, eligible: false }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const local = mod.get(ExportGeneratorService);
    const md = await local.generate({ now: new Date("2026-01-08T09:00:00Z") });
    expect(md).toContain("## SUGGESTED NEXT FOCUS");
    expect(md).toContain("Heaps");
    expect(md).toContain("LC #215");
  });
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `yarn workspace @terrain/api test export-generator`
Expected: FAIL — the new test's assertion (`## SUGGESTED NEXT FOCUS`) is missing.

- [ ] **Step 3: Implement the surfacing** — `apps/api/src/sessions/export-generator.service.ts`

In `generate()`, replace the existing focus block:
```typescript
    if (opts.focusTopicId) {
      const focus = topics.find((t) => t.id === opts.focusTopicId);
      sections.push(
        `## SESSION GOAL\nFocus: ${focus ? focus.title : opts.focusTopicId}\nStyle: Socratic; push back if I move too fast; enforce confusion time.`,
      );
    }
```
with:
```typescript
    if (opts.focusTopicId) {
      const focus = topics.find((t) => t.id === opts.focusTopicId);
      sections.push(
        `## SESSION GOAL\nFocus: ${focus ? focus.title : opts.focusTopicId}\nStyle: Socratic; push back if I move too fast; enforce confusion time.`,
      );
    } else {
      const lastImport = await this.prisma.sessionExport.findFirst({
        where: { importedAt: { not: null }, nextFocusTitle: { not: null } },
        orderBy: { importedAt: "desc" },
      });
      if (lastImport?.nextFocusTitle) {
        const cold = lastImport.nextColdChallenge ? `\nCold challenge: ${lastImport.nextColdChallenge}` : "";
        sections.push(`## SUGGESTED NEXT FOCUS (from last session)\nFocus: ${lastImport.nextFocusTitle}${cold}`);
      }
    }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `yarn workspace @terrain/api test export-generator`
Expected: PASS (existing 3 + 3 from 1b's Task 7 changes + 1 new = all green; the SUGGESTED NEXT FOCUS test passes and the others still pass with the `sessionExport.findFirst` stub).

---

### Task 7: Full suite + build + live import E2E

**Files:** none (verification only).

- [ ] **Step 1: Unit suite + build**

Run `yarn workspace @terrain/api test` → ALL suites green (report totals).
Run `yarn workspace @terrain/api build` → exits 0.

- [ ] **Step 2: Live import round-trip (real DB on 5433)**

The seed has DSA topics. Generate a real export, build a `learning-os` block that reviews a seeded topic, proposes a new topic, adds a note summary, and sets `nextSession`, then preview + apply + verify. Use this script (run from repo root):
```bash
cd /Users/dmitrijgorbatenko/personal/consistency
pkill -f "nest start" 2>/dev/null
yarn workspace @terrain/api start > /tmp/terrain-import-e2e.log 2>&1 &
# wait for boot, capture a real export + its session id and a seeded topic title
EXPORT=$(curl --retry-connrefused --retry 40 --retry-delay 1 --max-time 6 -s localhost:3000/sessions/export)
SID=$(node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.parse(d).id))' <<<"$EXPORT")
TITLE=$(node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const m=JSON.parse(d).exportMd.match(/ROADMAP — DSA\n[●○✓✗] ([^\n]+)/);console.log(m?m[1]:"")})' <<<"$EXPORT")
echo "session=$SID firstTopic=$TITLE"
# craft the learning-os block (review the seeded topic, propose a new one, note summary, nextSession)
BLOCK=$(node -e 'const sid=process.argv[1],t=process.argv[2];console.log("```learning-os\n"+JSON.stringify({version:1,sessionId:sid,reviews:[{topicTitle:t,topicId:null,quality:4,note:"import e2e"}],proposedTopics:[{title:"Import E2E Topic",type:"pattern",domain:"DSA",prerequisiteTitles:[t],parentTitle:null,aiContext:"created by e2e"}],noteSummaries:[{topicTitle:"Import E2E Topic",keyInsight:"it works",suggestedNoteRef:"OneNote > x"}],nextSession:{focusTitle:"Import E2E Topic",coldChallenge:"LC #1"}})+"\n```")' "$SID" "$TITLE")
# preview
curl -s -X POST localhost:3000/sessions/import/preview -H 'Content-Type: application/json' -d "$(node -e 'console.log(JSON.stringify({raw:process.argv[1]}))' "$BLOCK")" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const p=JSON.parse(d);console.log("PREVIEW applicable:",p.applicable,"reviews:",p.reviews.length,"newTopics:",p.newTopics.length,"unresolved:",p.unresolved.length)})'
# apply
curl -s -X POST localhost:3000/sessions/import -H 'Content-Type: application/json' -d "$(node -e 'console.log(JSON.stringify({raw:process.argv[1]}))' "$BLOCK")" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const r=JSON.parse(d);console.log("APPLY:",JSON.stringify(r))})'
# re-apply -> expect 409
echo "re-apply status: $(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:3000/sessions/import -H 'Content-Type: application/json' -d "$(node -e 'console.log(JSON.stringify({raw:process.argv[1]}))' "$BLOCK")")"
# next export should now carry SUGGESTED NEXT FOCUS
curl -s localhost:3000/sessions/export | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{console.log("next export has SUGGESTED NEXT FOCUS:",JSON.parse(d).exportMd.includes("## SUGGESTED NEXT FOCUS"))})'
pkill -f "nest start" 2>/dev/null
```
Expected: PREVIEW `applicable: true`, `reviews: 1`, `newTopics: 1`, `unresolved: 0`; APPLY shows `reviewsApplied: 1`, one `topicsCreated` id, `nextSessionStored: true`; re-apply status `409`; next export has SUGGESTED NEXT FOCUS `true`. Stop the server.

(Note: `--argjson-unused` is not a real curl flag — remove it; the `-d` JSON body is built by the inline node call. If `<<<` here-strings are unavailable in the shell, write `$BLOCK` to a temp file and read it. Adapt shell quoting as needed; the **behavioral expectations above are the contract**.)

---

## Self-Review

**Spec coverage (Phase 2 backend):**
- Parse via `parseLearningOs`; malformed → 400 — Task 3 (`load`) ✓ (spec §2, §9).
- Title resolution trim+case-insensitive against existing ∪ batch; ambiguous/self-reference/missing → `unresolved` — Task 3 ✓ (spec §4).
- `preview` returns the full `ImportPlan` incl. SM-2 preview (compounding + default state for batch-new) — Task 3 ✓ (spec §3.1, §11).
- `apply` one interactive transaction, all-or-nothing, 409/422 guards before any write — Task 4 ✓ (spec §5, §9).
- New topics created `aiProposed` + `TopicType` registered; links two-pass; existing topics read-only — Task 4 ✓ (spec §5.3, §4).
- Reviews via shared `buildReviewWrites` (extracted, reused by `logReview`) — Task 2 + Task 4 ✓ (spec §6).
- Note summaries → composed `summary` + `noteRef` — Task 3 (`composeSummary`) + Task 4 ✓ (spec §10).
- `SessionExport` stamped (`importedAt`, `importedOutputRaw`, `newTopicsCreated`) + `nextSession` stored; `nextSessionStored` iff focusTitle non-empty — Task 1 + Task 4 ✓ (spec §5, §7).
- `nextSession` surfaced in the next export (no-focus path) — Task 6 ✓ (spec §8); existing export tests fixed (mock + new test) — Task 6 ✓ (spec §11).
- Endpoints `POST /sessions/import(/preview)` — Task 5 ✓.
- Deferred (out of scope): web review/diff screen + curated apply, roadmap graph, Phase-3 approve/reject — not gaps (spec §12).

**Placeholder scan:** none — all coded steps carry full code. Task 7's E2E script calls out its own shell-portability caveat and states the behavioral contract explicitly.

**Type consistency:** `ImportPlan`/`ResolvedReview`/`NewTopicPlan`/`NoteSummaryPlan`/`Unresolved`/`ImportResult` defined once in Task 3 and reused by Tasks 4–5; `buildReviewWrites(topic, quality, mode, note, now, durationMin?)` identical in Task 2 (definition), Task 2 Step 5 (`logReview`), and Task 4 (`apply`); `composeSummary` defined Task 3, used Task 4; `norm`/`DEFAULT_SR`/`stateFromTopic` are file-local to `import.service.ts`. The `SessionExport.next*` fields (Task 1) are written in Task 4 and read in Task 6.
