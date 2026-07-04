# AI Session Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two today-scoped export modes (`repeat`, `learn`) with session-conduct scripts for Claude, one-click Dashboard copy buttons, and a `studiedTopics` contract field so importing a learning session activates the studied topic and unblocks its successors.

**Architecture:** Both modes are new branches inside the existing `ExportGeneratorService` (shared persistence via `SessionsService`, shared `OUTPUT_CONTRACT`). `repeat` renders the interleaved queue from `MetricsService.sessionQueue()`; `learn` renders one focus topic (default: Next Up) with prerequisite summaries. The `learning-os` v2 schema gains optional `studiedTopics`; import preview grows an `activations` plan section and apply flips planned topics to active inside the existing transaction.

**Tech Stack:** NestJS 11 + Prisma 7 (jest), Zod contract in packages/types (vitest), React 19 (vitest), one Postgres enum migration, no new deps.

**Spec:** `docs/superpowers/specs/2026-07-03-ai-session-loop-design.md`

## Global Constraints

- **NO GIT COMMITS** — repo policy. Verify instead of committing; the controller snapshots trees between tasks.
- **PRECONDITION:** the interleaved-review-session plan (`docs/superpowers/plans/2026-07-03-interleaved-review-session.md`) is implemented first — this plan calls `MetricsService.sessionQueue(userId, now)` and its `SessionQueueItem` type (`apps/api/src/metrics/interleave.ts`).
- Gate for every task: `yarn lint && yarn format:check` clean; workspace tests green.
- New-cards cap in the repeat export comes from `sessionQueue` (already capped at 5) — do not re-cap.
- `learning-os` version stays `2`; `studiedTopics` is optional, max 20 entries.
- Migrations: hand-author `migration.sql` + `prisma migrate deploy` (dev DB on Docker port 5433; **never** `prisma migrate reset` — deny-listed).
- Verbatim copy rules: SESSION CONDUCT texts, the `studiedTopics` contract rule line, and toast texts are specified exactly in their tasks — transcribe, don't paraphrase.

---

### Task 1: Contract — `studiedTopics` in packages/types + output contract text

**Files:**
- Modify: `packages/types/src/index.ts` (schema)
- Modify: `apps/api/src/sessions/output-contract.ts` (template + rule)
- Test: `packages/types/src/learning-os.test.ts` (or the existing vitest file — find it with `ls packages/types/src/*.test.ts` and append there)

**Interfaces:**
- Consumes: existing `learningOsV2Schema`.
- Produces: `LearningOsV2['studiedTopics']: string[] | undefined` — Task 3 (import) reads `parsed.studiedTopics ?? []`. `OUTPUT_CONTRACT` mentions the field (shared by all export modes).

- [ ] **Step 1: Write the failing schema tests**

Append to the existing vitest file in `packages/types/src` (keep its import style):

```ts
describe('studiedTopics', () => {
  const base = { version: 2, sessionId: 'abc' };

  it('accepts studiedTopics as an array of titles', () => {
    const parsed = learningOsV2Schema.parse({
      ...base,
      studiedTopics: ['Prefix sums', 'Two pointers'],
    });
    expect(parsed.studiedTopics).toEqual(['Prefix sums', 'Two pointers']);
  });

  it('is optional — omitting it stays valid and yields undefined', () => {
    const parsed = learningOsV2Schema.parse(base);
    expect(parsed.studiedTopics).toBeUndefined();
  });

  it('rejects empty titles and more than 20 entries', () => {
    expect(learningOsV2Schema.safeParse({ ...base, studiedTopics: [''] }).success).toBe(false);
    expect(
      learningOsV2Schema.safeParse({
        ...base,
        studiedTopics: Array.from({ length: 21 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false);
  });

  it('still rejects unknown fields (strict)', () => {
    expect(learningOsV2Schema.safeParse({ ...base, bogus: true }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @terrain/types test`
Expected: FAIL — unknown key `studiedTopics` rejected by strict schema.

- [ ] **Step 3: Implement**

In `packages/types/src/index.ts`, add to `learningOsV2Schema` after `noteSummaries`:

```ts
    studiedTopics: z.array(z.string().min(1).max(300)).max(20).optional(),
```

In `apps/api/src/sessions/output-contract.ts`:

1. In the JSON template, after the `"noteSummaries"` array, add:

```
  "studiedTopics": ["<exact title of a topic genuinely studied this session>"],
```

2. In the Rules block, after the `Prefer promptId reviews…` line, add exactly:

```
studiedTopics: titles of topics genuinely studied this session — a planned topic listed here
is activated on import (its successors unblock). Do not list topics merely mentioned.
```

- [ ] **Step 4: Run tests**

Run: `yarn workspace @terrain/types test && yarn workspace @terrain/api test`
Expected: types tests pass; API suite passes (if any export-generator spec snapshots the contract text, update its expectation to the new text — that is the only legitimate diff).

- [ ] **Step 5: Verify gate**

Run: `yarn build && yarn lint && yarn format:check`
Expected: clean (build needed because apps depend on the rebuilt types package). Do NOT commit.

---

### Task 2: `ExportMode` migration + mode plumbing in `SessionsService`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (enum)
- Create: `apps/api/prisma/migrations/20260703000001_export_mode_repeat_learn/migration.sql`
- Modify: `apps/api/src/sessions/sessions.service.ts`
- Test: `apps/api/src/sessions/sessions.service.spec.ts` (create if it doesn't exist; check first)

**Interfaces:**
- Consumes: existing `createExport(userId, { mode?, focusTopicId? })`.
- Produces: `mode=repeat` / `mode=learn` accepted end-to-end; persisted `exportMode` values `'repeat'`/`'learn'`. Tasks 3–4 add the generator branches (until then the new modes fall through to the full-mode template — acceptable mid-plan state).

- [ ] **Step 1: Migration**

Update `apps/api/prisma/schema.prisma`:

```prisma
enum ExportMode {
  full
  domain
  repeat
  learn
}
```

Create `apps/api/prisma/migrations/20260703000001_export_mode_repeat_learn/migration.sql`:

```sql
-- Add today-scoped export modes (AI session loop)
ALTER TYPE "ExportMode" ADD VALUE 'repeat';
ALTER TYPE "ExportMode" ADD VALUE 'learn';
```

Run:

```bash
docker compose up -d
yarn workspace @terrain/api exec prisma migrate deploy
yarn workspace @terrain/api exec prisma generate
```

Expected: migration applied; verify live with
`docker compose exec db psql -U terrain -d terrain -c "SELECT unnest(enum_range(NULL::\"ExportMode\"));"`
(check the actual service/user names in `docker-compose.yml` first) → 4 rows: full, domain, repeat, learn.

- [ ] **Step 2: Write the failing service test**

Check whether `apps/api/src/sessions/sessions.service.spec.ts` exists. If not, create it; if it exists, append the describe block, adapting to its mock style:

```ts
import { SessionsService } from './sessions.service';

function makeService(generated = 'DRAFT Session: <set-on-persist>') {
  const prisma: any = {
    sessionExport: {
      create: jest.fn().mockResolvedValue({ id: 'se-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const generator: any = { generate: jest.fn().mockResolvedValue(generated) };
  return { service: new SessionsService(prisma, generator), prisma, generator };
}

describe('SessionsService.createExport mode mapping', () => {
  it.each([
    ['repeat', 'repeat', null],
    ['learn', 'learn', null],
    ['domain:DSA', 'domain', 'DSA'],
    [undefined, 'full', null],
  ])('mode %s persists exportMode %s', async (mode, expected, domain) => {
    const { service, prisma } = makeService();
    await service.createExport('u1', { mode: mode as string | undefined });
    expect(prisma.sessionExport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ mode: expected, domain }),
    });
  });

  it('replaces the session placeholder with the row id', async () => {
    const { service, prisma } = makeService();
    const res = await service.createExport('u1', { mode: 'repeat' });
    expect(res.exportMd).toContain('Session: se-1');
    expect(prisma.sessionExport.update).toHaveBeenCalledWith({
      where: { id: 'se-1' },
      data: { exportMd: expect.stringContaining('Session: se-1') },
    });
  });
});
```

Run: `yarn workspace @terrain/api test --testPathPatterns sessions.service`
Expected: FAIL — `mode: 'repeat'` currently maps to `'full'`.

- [ ] **Step 3: Implement the mapping**

In `apps/api/src/sessions/sessions.service.ts`, replace the two mapping lines:

```ts
    const exportMode =
      mode === 'repeat' || mode === 'learn'
        ? mode
        : mode.startsWith('domain:')
          ? 'domain'
          : 'full';
    const domain = mode.startsWith('domain:') ? mode.slice('domain:'.length) : null;
```

(`focusTopicId` already persists as passed; a learn export using the server-side Next Up default persists `focusTopicId: null` — acceptable, the generator embeds the resolved topic in the markdown.)

- [ ] **Step 4: Run tests**

Run: `yarn workspace @terrain/api test`
Expected: PASS.

- [ ] **Step 5: Verify gate**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 3: Generator — `mode=repeat`

**Files:**
- Create: `apps/api/src/sessions/session-conduct.ts`
- Modify: `apps/api/src/sessions/export-generator.service.ts`
- Test: `apps/api/src/sessions/export-generator.service.spec.ts` (append, following its existing mock style)

**Interfaces:**
- Consumes: `MetricsService.sessionQueue(userId, now)` → `{ items: SessionQueueItem[] }` (promptId, topicId, topicTitle, chapterTitle, kind, isNew, nextReviewAt, createdAt); `estimateMinutes` from `../telegram/telegram.messages` (pure function, no Nest deps).
- Produces: `generate({ mode: 'repeat', … })` returns the repeat template; exports `REPEAT_CONDUCT`/`LEARN_CONDUCT` consts from `session-conduct.ts` (LEARN_CONDUCT consumed in Task 4).

- [ ] **Step 1: Create the conduct scripts (verbatim)**

Create `apps/api/src/sessions/session-conduct.ts`:

```ts
/** Session-conduct scripts embedded in today-scoped exports. These script the
 *  chat ritual itself; field-level rules stay in output-contract.ts. */

export const REPEAT_CONDUCT = `## SESSION CONDUCT — repetition
Work through TODAY'S REVIEW QUEUE in the listed order, one card at a time.
1. Show the card's prompt, then STOP and wait for my attempt. Never reveal the
   answer, hints, or your own solution before I've answered.
2. After my attempt, give brief feedback — confirm what was right, correct what
   was wrong. Clarify, don't lecture.
3. Then ask me to grade my own recall: again / hard / good / easy. Record my
   verdict verbatim as the review's grade — never substitute your own judgment.
4. Cards tagged [NEW] have never been studied: give a 2-4 sentence introduction
   first, then quiz as normal.
Reference every review by promptId from the queue above.`;

export const LEARN_CONDUCT = `## SESSION CONDUCT — learning
Teach me the topic in LEARNING GOAL, Socratic-style.
1. Questions before explanations — make me reason before you resolve.
2. Push back if I move too fast; enforce confusion time — let me sit with a
   hard question before rescuing me.
3. Connect new material explicitly to the prerequisites listed above.
4. At the end of the session, in the learning-os block:
   - propose 3-7 atomic cards via proposedPrompts (mix concept/code/problem as
     fits the topic; don't duplicate the existing cards listed above);
   - write one noteSummaries entry for the topic (keyInsight required;
     invariant/contradiction only when real);
   - list the topic's title in studiedTopics so the app activates it.
   Only add other titles to studiedTopics if we genuinely studied them in
   depth — never topics merely mentioned.`;
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/src/sessions/export-generator.service.spec.ts`, matching its existing prisma/metrics mock construction (the service is `new ExportGeneratorService(prisma, metrics)` or Nest-module built — follow the file). The mocks need: `metrics.sessionQueue` (new), `prisma.user.findUnique`, `prisma.prompt.findMany`.

```ts
describe('mode=repeat', () => {
  const NOW = new Date('2026-07-03T10:00:00Z');

  function repeatMocks() {
    const items = [
      {
        promptId: 'p1', topicId: 't1', topicTitle: 'Two Sum',
        chapterTitle: 'Arrays & Hashing', kind: 'concept', isNew: false,
        nextReviewAt: new Date('2026-07-02T00:00:00Z'), createdAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        promptId: 'p2', topicId: 't2', topicTitle: 'Binary Search',
        chapterTitle: 'Binary Search', kind: 'problem', isNew: true,
        nextReviewAt: null, createdAt: new Date('2026-06-02T00:00:00Z'),
      },
    ];
    const prompts = [
      { id: 'p1', promptText: 'What does a hash map trade for O(1) lookups?', promptKind: 'concept', estimatedMinutes: null },
      { id: 'p2', promptText: 'Solve: Search in Rotated Sorted Array', promptKind: 'problem', estimatedMinutes: 30 },
    ];
    return { items, prompts };
  }

  it('renders the interleaved queue in order with [NEW] tags, conduct block, and no roadmap', async () => {
    const { items, prompts } = repeatMocks();
    metrics.sessionQueue = jest.fn().mockResolvedValue({ items });
    prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
    prisma.prompt.findMany = jest.fn().mockResolvedValue(prompts);

    const md = await service.generate({ mode: 'repeat', now: NOW, userId: 'u1' });

    expect(md).toContain("## TODAY'S REVIEW QUEUE");
    expect(md).toContain('2 cards (1 due, 1 new)');
    // concept fallback 2 min + explicit 30 min
    expect(md).toContain('estimated 32 min');
    const p1 = md.indexOf('card p1 [concept] (Arrays & Hashing) What does a hash map');
    const p2 = md.indexOf('card p2 [problem] [NEW] (Binary Search) Solve: Search in Rotated');
    expect(p1).toBeGreaterThan(-1);
    expect(p2).toBeGreaterThan(p1); // queue order preserved
    expect(md).toContain('## SESSION CONDUCT — repetition');
    expect(md).toContain('## OUTPUT CONTRACT');
    expect(md).toContain('Export: repeat');
    // lean context: landscape sections omitted
    expect(md).not.toContain('## ROADMAP');
    expect(md).not.toContain('## MASTERY CONDITIONS');
    expect(md).not.toContain('## RECENT SESSIONS');
  });

  it('renders "Nothing due today." and no conduct block for an empty queue', async () => {
    metrics.sessionQueue = jest.fn().mockResolvedValue({ items: [] });
    prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });

    const md = await service.generate({ mode: 'repeat', now: NOW, userId: 'u1' });

    expect(md).toContain('Nothing due today.');
    expect(md).not.toContain('## SESSION CONDUCT');
    expect(md).toContain('## OUTPUT CONTRACT');
  });
});
```

Run: `yarn workspace @terrain/api test --testPathPatterns export-generator`
Expected: FAIL — repeat mode falls through to the full template (contains `## ROADMAP`).

- [ ] **Step 3: Implement**

In `apps/api/src/sessions/export-generator.service.ts`:

1. Add imports:

```ts
import { estimateMinutes } from '../telegram/telegram.messages';
import { REPEAT_CONDUCT } from './session-conduct';
```

2. Extract the WHO I AM block into a private method (it's needed by all modes). Replace the inline `whoIAm` construction in `generate()` with a call to:

```ts
  private async whoIAm(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return `## WHO I AM (stable)
Name: ${user?.name ?? ''}
Role: ${user?.headline ?? ''}
Learning style: ${user?.learningStyle ?? ''}
Code style: ${user?.codeStyle ?? ''}
Note system: ${user?.noteSystem ?? ''}`;
  }
```

3. Add a private header helper (same format the full path uses — reuse it there too):

```ts
  private header(mode: string, now: Date): string {
    return `---\nTERRAIN — SESSION CONTEXT\nGenerated: ${now.toISOString()}\nSession: <set-on-persist>\nExport: ${mode}\n---`;
  }
```

4. Branch at the top of `generate()`, right after `const mode = opts.mode ?? 'full';`:

```ts
    if (mode === 'repeat') return this.generateRepeat(opts.userId, opts.now);
```

5. Add the repeat builder:

```ts
  /** Today-scoped repetition context: the interleaved session queue + a
   *  conduct script. Deliberately lean — no roadmap/mastery/landscape — so
   *  the chat stays on-script. */
  private async generateRepeat(userId: string, now: Date): Promise<string> {
    const { items } = await this.metrics.sessionQueue(userId, now);
    const sections = [this.header('repeat', now), await this.whoIAm(userId)];

    if (items.length === 0) {
      sections.push(`## TODAY'S REVIEW QUEUE\nNothing due today.`);
    } else {
      const prompts = await this.prisma.prompt.findMany({
        where: { id: { in: items.map((i) => i.promptId) } },
        select: { id: true, promptText: true, promptKind: true, estimatedMinutes: true },
      });
      const byId = new Map(prompts.map((p) => [p.id, p]));
      const dueCount = items.filter((i) => !i.isNew).length;
      const est = estimateMinutes(
        items.map((i) => byId.get(i.promptId)).filter((p) => p != null),
      );
      const lines = items.map((i) => {
        const text = byId.get(i.promptId)?.promptText ?? '';
        const tag = i.isNew ? ' [NEW]' : '';
        return `- card ${i.promptId} [${i.kind}]${tag} (${i.chapterTitle}) ${text}`;
      });
      sections.push(
        `## TODAY'S REVIEW QUEUE\n${items.length} cards (${dueCount} due, ${items.length - dueCount} new) · estimated ${est} min\n${lines.join('\n')}`,
      );
      sections.push(REPEAT_CONDUCT);
    }

    sections.push(OUTPUT_CONTRACT);
    return sections.join('\n\n');
  }
```

- [ ] **Step 4: Run tests**

Run: `yarn workspace @terrain/api test --testPathPatterns export-generator`
Expected: PASS, including all pre-existing full/domain tests (the refactor to `whoIAm()`/`header()` must not change full-mode output byte-for-byte).

- [ ] **Step 5: Verify gate**

Run: `yarn workspace @terrain/api test && yarn workspace @terrain/api build && yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 4: Generator — `mode=learn`

**Files:**
- Modify: `apps/api/src/sessions/export-generator.service.ts`
- Test: `apps/api/src/sessions/export-generator.service.spec.ts` (append)

**Interfaces:**
- Consumes: `MetricsService.nextUp(userId)` (existing), `LEARN_CONDUCT` (Task 3), existing `roadmap()` renderer, `UnprocessableEntityException`/`NotFoundException` from `@nestjs/common`.
- Produces: `generate({ mode: 'learn', focusTopicId?, … })` — focus defaults to Next Up; 422 when neither exists; 404 for archived/foreign focus ids.

- [ ] **Step 1: Write the failing tests**

Append to `export-generator.service.spec.ts`:

```ts
describe('mode=learn', () => {
  const NOW = new Date('2026-07-03T10:00:00Z');

  function focusTopic(overrides: Record<string, unknown> = {}) {
    return {
      id: 'focus-1',
      title: 'Prefix sums',
      topicType: 'pattern',
      domain: 'DSA',
      status: 'planned',
      description: 'Running cumulative totals for O(1) range queries.',
      aiContext: null,
      parentId: 'chap-1',
      parent: {
        title: 'Arrays & Hashing',
        children: [{ status: 'active' }, { status: 'planned' }, { status: 'mastered' }],
      },
      prerequisites: [
        {
          prerequisite: {
            title: 'Hashing fundamentals',
            status: 'active',
            summary: '**Key insight:** buckets trade memory for time.',
          },
        },
        { prerequisite: { title: 'Arrays 101', status: 'mastered', summary: null } },
      ],
      prompts: [{ id: 'c1', promptKind: 'concept', promptText: 'Define a prefix-sum array.' }],
      ...overrides,
    };
  }

  it('renders learning goal, prereq summaries, existing cards, conduct, scoped roadmap', async () => {
    prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
    prisma.topic.findFirst = jest.fn().mockResolvedValue(focusTopic());
    // domain-scoped roadmap query (reuses the topics include shape)
    prisma.topic.findMany = jest.fn().mockResolvedValue([]);

    const md = await service.generate({
      mode: 'learn',
      focusTopicId: 'focus-1',
      now: NOW,
      userId: 'u1',
    });

    expect(md).toContain('Export: learn');
    expect(md).toContain('## LEARNING GOAL');
    expect(md).toContain('Topic: Prefix sums [pattern]');
    expect(md).toContain('Chapter: Arrays & Hashing · 2 of 3 in this chapter started');
    expect(md).toContain('- Hashing fundamentals — **Key insight:** buckets trade memory for time.');
    expect(md).toContain('- Arrays 101');
    expect(md).toContain('Existing cards (do not duplicate):');
    expect(md).toContain('- card c1 [concept] Define a prefix-sum array.');
    expect(md).toContain('## SESSION CONDUCT — learning');
    expect(md).toContain('## OUTPUT CONTRACT');
    expect(md).not.toContain('## MASTERY CONDITIONS');
    // scoped roadmap query hit topics of the focus domain only
    expect(prisma.topic.findMany.mock.calls[0][0].where).toMatchObject({
      userId: 'u1',
      domain: 'DSA',
    });
  });

  it('defaults the focus to Next Up when focusTopicId is omitted', async () => {
    prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
    metrics.nextUp = jest.fn().mockResolvedValue({ topic: { id: 'focus-1' } });
    prisma.topic.findFirst = jest.fn().mockResolvedValue(focusTopic());
    prisma.topic.findMany = jest.fn().mockResolvedValue([]);

    const md = await service.generate({ mode: 'learn', now: NOW, userId: 'u1' });
    expect(md).toContain('Topic: Prefix sums');
    expect(prisma.topic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'focus-1', userId: 'u1' }) }),
    );
  });

  it('422s when there is no startable topic and no explicit focus', async () => {
    metrics.nextUp = jest.fn().mockResolvedValue(null);
    await expect(service.generate({ mode: 'learn', now: NOW, userId: 'u1' })).rejects.toThrow(
      'No startable topic — pass focusTopicId or start something from the roadmap.',
    );
  });

  it('404s on an archived focus topic', async () => {
    prisma.topic.findFirst = jest.fn().mockResolvedValue(focusTopic({ status: 'archived' }));
    await expect(
      service.generate({ mode: 'learn', focusTopicId: 'focus-1', now: NOW, userId: 'u1' }),
    ).rejects.toThrow('not found');
  });
});
```

Run: `yarn workspace @terrain/api test --testPathPatterns export-generator`
Expected: FAIL — learn mode falls through to the full template.

- [ ] **Step 2: Implement**

In `export-generator.service.ts`:

1. Extend imports:

```ts
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { LEARN_CONDUCT, REPEAT_CONDUCT } from './session-conduct';
```

2. Branch in `generate()` after the repeat branch:

```ts
    if (mode === 'learn') return this.generateLearn(opts.userId, opts.now, opts.focusTopicId);
```

3. Add the builder:

```ts
  /** Learning context for one topic (default: Next Up): where it sits in the
   *  roadmap, what it builds on (prerequisites with their note summaries as
   *  the elaborative bridge), existing cards, and a teaching script. */
  private async generateLearn(
    userId: string,
    now: Date,
    focusTopicId?: string,
  ): Promise<string> {
    let focusId = focusTopicId;
    if (!focusId) {
      const next = await this.metrics.nextUp(userId);
      if (!next) {
        throw new UnprocessableEntityException(
          'No startable topic — pass focusTopicId or start something from the roadmap.',
        );
      }
      focusId = next.topic.id;
    }
    const focus = await this.prisma.topic.findFirst({
      where: { id: focusId, userId },
      include: {
        parent: { select: { title: true, children: { select: { status: true } } } },
        prerequisites: {
          include: { prerequisite: { select: { title: true, status: true, summary: true } } },
        },
        prompts: {
          where: { suspended: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, promptKind: true, promptText: true },
        },
      },
    });
    if (!focus || focus.status === 'archived') {
      throw new NotFoundException(`Topic ${focusId} not found`);
    }

    const goal: string[] = [`## LEARNING GOAL`, `Topic: ${focus.title} [${focus.topicType}]`];
    if (focus.parent) {
      const started = focus.parent.children.filter(
        (c) => c.status === 'active' || c.status === 'mastered',
      ).length;
      goal.push(
        `Chapter: ${focus.parent.title} · ${started} of ${focus.parent.children.length} in this chapter started`,
      );
    }
    if (focus.description) goal.push(`Description: ${focus.description}`);
    if (focus.aiContext) goal.push(`AI context: ${focus.aiContext}`);
    if (focus.prerequisites.length > 0) {
      const lines = focus.prerequisites.map(({ prerequisite: p }) =>
        p.summary ? `- ${p.title} — ${p.summary}` : `- ${p.title}`,
      );
      goal.push(`Builds on (your existing knowledge):\n${lines.join('\n')}`);
    }
    if (focus.prompts.length > 0) {
      const lines = focus.prompts.map((c) => `- card ${c.id} [${c.promptKind}] ${c.promptText}`);
      goal.push(`Existing cards (do not duplicate):\n${lines.join('\n')}`);
    }

    // Roadmap scoped to the focus topic's domain, same include shape/renderer
    // as the full export.
    const domainTopics = await this.prisma.topic.findMany({
      where: { userId, domain: focus.domain },
      orderBy: [{ domain: 'asc' }, { createdAt: 'asc' }],
      include: {
        prerequisites: { include: { prerequisite: { select: { status: true } } } },
        prompts: { select: { reps: true, stability: true, suspended: true } },
      },
    });

    const sections = [
      this.header('learn', now),
      await this.whoIAm(userId),
      this.roadmap(domainTopics.filter((t) => t.status !== 'archived')),
      goal.join('\n'),
      LEARN_CONDUCT,
      OUTPUT_CONTRACT,
    ];
    return sections.join('\n\n');
  }
```

Note the ordering constraint from the tests: the 422 check (no focus, no nextUp) fires **before** any topic fetch; the 404 check fires on missing/archived/foreign topics.

- [ ] **Step 3: Run tests**

Run: `yarn workspace @terrain/api test`
Expected: PASS (whole suite).

- [ ] **Step 4: Verify gate**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 5: Import — `studiedTopics` → activations (plan + apply)

**Files:**
- Modify: `apps/api/src/import/import.service.ts`
- Test: `apps/api/src/import/import.service.spec.ts` (append, following its existing fixture style)

**Interfaces:**
- Consumes: `parsed.studiedTopics ?? []` (Task 1); existing `buildPlan` resolution helpers (`resolveExisting`, `inBatch`, `byNorm`).
- Produces (Task 6 mirrors these in web types):
  ```ts
  export interface ActivationPlan {
    topicTitle: string;
    resolvedTopicId: string | null; // null = topic created in this same import
    currentStatus: string | null;   // null = in-batch (created planned, then activated)
    willActivate: boolean;
  }
  // ImportPlan gains:  activations: ActivationPlan[]
  // ImportResult gains: topicsActivated: number
  // Unresolved.kind gains 'studiedTopic'; Unresolved.reason gains 'archived'
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/import/import.service.spec.ts` (adapt fixture construction to the file's existing helpers — it already builds parsed blocks and existing-topic arrays for `buildPlan`/`apply` tests; reuse those patterns):

```ts
describe('studiedTopics activation', () => {
  // Adapt these to the spec file's existing buildPlan/apply test harness.
  // Semantics to assert:

  it('plans activation for a planned topic (willActivate true)', () => {
    // existing: [{ id: 't1', title: 'Prefix sums', status: 'planned', ... }]
    // parsed: { version: 2, sessionId, studiedTopics: ['prefix sums'] }  // case-insensitive
    // expect plan.activations[0] = { topicTitle: 'prefix sums', resolvedTopicId: 't1',
    //   currentStatus: 'planned', willActivate: true }
    // expect plan.unresolved empty, plan.applicable true
  });

  it('plans a no-op for an already active topic (willActivate false)', () => {
    // status 'active' → activations entry with willActivate false, no unresolved
  });

  it('blocks on an archived topic with reason archived', () => {
    // status 'archived' → unresolved: [{ kind: 'studiedTopic', title, context: 'studiedTopics',
    //   reason: 'archived' }], no activations entry, applicable false
  });

  it('blocks on an unknown title with reason missing and on duplicate user titles with ambiguous', () => {
    // unknown → reason 'missing'; two topics sharing the title → reason 'ambiguous'
  });

  it('resolves a title created by proposedTopics in the same block (in-batch)', () => {
    // parsed has proposedTopics: [{ title: 'Fresh topic', ... }] and
    // studiedTopics: ['Fresh topic'] → activations entry with resolvedTopicId null,
    // currentStatus null, willActivate true; no unresolved
  });

  it('deduplicates repeated studiedTopics titles', () => {
    // studiedTopics: ['Prefix sums', 'prefix sums'] → exactly one activations entry
  });

  it('apply() activates planned topics and counts topicsActivated', async () => {
    // Use the file's existing apply() transaction-mock harness.
    // Assert tx.topic.updateMany called with
    //   { where: { id: 't1', userId, status: 'planned' },
    //     data: { status: 'active', aiProposed: false } }
    // and result.topicsActivated === 1. An 'active'-status entry must NOT
    // produce an updateMany call (willActivate false is skipped).
  });
});
```

Write these as real tests using the spec file's harness (the skeletons above pin the semantics; the harness details come from the file). Run:

`yarn workspace @terrain/api test --testPathPatterns import.service`
Expected: FAIL — `plan.activations` undefined.

- [ ] **Step 2: Implement plan-side**

In `apps/api/src/import/import.service.ts`:

1. Add the interface next to `NewPromptPlan`:

```ts
export interface ActivationPlan {
  topicTitle: string;
  /** null = topic created in this same import (resolved by title inside apply's tx). */
  resolvedTopicId: string | null;
  /** null = in-batch (created planned in this import, then activated). */
  currentStatus: string | null;
  willActivate: boolean;
}
```

2. Extend `Unresolved`:

```ts
  kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent' | 'prompt' | 'studiedTopic';
  ...
  reason: 'missing' | 'ambiguous' | 'self-reference' | 'archived';
```

3. Extend `ImportPlan` with `activations: ActivationPlan[];` and `ImportResult` with `topicsActivated: number;`.

4. In `buildPlan`, after the `newPrompts` block (before `alreadyImported`), add. Note `resolveExisting` collapses ambiguity to `{ id: null, ambiguous: true }` but hides the matched row — here we also need the topic's status, so read `byNorm` directly:

```ts
    const seenStudied = new Set<string>();
    const activations: ActivationPlan[] = [];
    for (const title of parsed.studiedTopics ?? []) {
      const key = norm(title);
      if (seenStudied.has(key)) continue;
      seenStudied.add(key);
      const matches = byNorm.get(key) ?? [];
      if (matches.length > 1) {
        unresolved.push({
          kind: 'studiedTopic',
          title,
          context: 'studiedTopics',
          reason: 'ambiguous',
        });
        continue;
      }
      const match = matches[0];
      if (!match) {
        if (inBatch(title)) {
          activations.push({
            topicTitle: title,
            resolvedTopicId: null,
            currentStatus: null,
            willActivate: true,
          });
        } else {
          unresolved.push({
            kind: 'studiedTopic',
            title,
            context: 'studiedTopics',
            reason: 'missing',
          });
        }
        continue;
      }
      if (match.status === 'archived') {
        unresolved.push({
          kind: 'studiedTopic',
          title,
          context: 'studiedTopics',
          reason: 'archived',
        });
        continue;
      }
      activations.push({
        topicTitle: title,
        resolvedTopicId: match.id,
        currentStatus: match.status,
        willActivate: match.status === 'planned',
      });
    }
```

and add `activations,` to the returned plan object.

- [ ] **Step 3: Implement apply-side**

In `apply()`'s transaction, after step b (link wiring) and before step c, add:

```ts
      // b2. activate studied topics — explicit studiedTopics contract field.
      // Guarded updateMany: only planned→active flips count, so an entry that
      // was already active (willActivate false) or was concurrently activated
      // is a clean no-op.
      let topicsActivated = 0;
      for (const a of plan.activations) {
        if (!a.willActivate) continue;
        const id = a.resolvedTopicId ?? idByNorm.get(norm(a.topicTitle));
        if (!id) continue;
        const res = await tx.topic.updateMany({
          where: { id, userId, status: 'planned' },
          data: { status: 'active', aiProposed: false },
        });
        topicsActivated += res.count;
      }
```

and add `topicsActivated,` to the returned `ImportResult`.

- [ ] **Step 4: Run tests**

Run: `yarn workspace @terrain/api test`
Expected: PASS (new activation tests + entire pre-existing import suite; existing tests asserting exact `ImportPlan`/`ImportResult` shapes with `toEqual` need `activations: []` / `topicsActivated: 0` added — extend the expectations, never weaken them).

- [ ] **Step 5: Verify gate**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 6: Web — import preview/result UI for activations

**Files:**
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/screens/Import/sections.tsx`
- Modify: `apps/web/src/screens/Import/index.tsx`

**Interfaces:**
- Consumes: Task 5's serialized shapes.
- Produces: `ActivationsSection({ activations })` exported from `sections.tsx`; preview renders it; result strip shows `topicsActivated`.

- [ ] **Step 1: Mirror the types**

In `apps/web/src/api/types.ts` (import-flow section):

```ts
export interface ActivationPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  currentStatus: string | null;
  willActivate: boolean;
}
```

Extend the web `Unresolved` interface's `kind` union with `'studiedTopic'` and `reason` union with `'archived'` (mirror the API exactly). Add `activations: ActivationPlan[];` to `ImportPlan` and `topicsActivated: number;` to `ImportResult`.

- [ ] **Step 2: Add the section component**

In `apps/web/src/screens/Import/sections.tsx`, add (following the file's existing `SectionShell`/row pattern — reuse `SectionShell` exactly as the other sections do; add `ActivationPlan` to the types import):

```tsx
function ActivationRow({ a }: { a: ActivationPlan }) {
  return (
    <div className="list-row">
      <span className="grow" style={{ fontWeight: 550 }}>
        {a.topicTitle}
      </span>
      {a.willActivate ? (
        <span className="pill" style={{ color: 'var(--st-active)' }}>
          planned → active
        </span>
      ) : (
        <span className="pill faint">already {a.currentStatus}</span>
      )}
    </div>
  );
}

export function ActivationsSection({ activations }: { activations: ActivationPlan[] }) {
  if (activations.length === 0) return null;
  return (
    <SectionShell title="Studied topics" count={activations.length}>
      {activations.map((a) => (
        <ActivationRow key={a.topicTitle} a={a} />
      ))}
    </SectionShell>
  );
}
```

(Check `SectionShell`'s real props at `sections.tsx:33` and match them — if it takes different prop names, follow the file. If other sections render `null` differently for empty input, match that convention too.)

- [ ] **Step 3: Wire into the Import screen**

In `apps/web/src/screens/Import/index.tsx`:

1. Render `<ActivationsSection activations={plan.activations} />` between `<NewTopicsSection …/>` and `<ProposedCardsSection …/>` (activation is topic-level news, so it sits with topics). Add the import.
2. In the apply-result `stat-strip`, add a KPI after "new cards":

```tsx
            <div className="kpi">
              <div>{applyResult.topicsActivated}</div>
              <div className="kpi-label">topics activated</div>
            </div>
```

3. Check `UnresolvedPanel` (`sections.tsx:325`) renders `kind`/`reason` as plain strings — if it has an exhaustive kind→label map, add `studiedTopic` (label: "Studied topic") and make sure reason `archived` displays; if it just prints the strings, no change needed.

- [ ] **Step 4: Verify**

Run: `yarn workspace @terrain/web build && yarn workspace @terrain/web test && yarn lint && yarn format:check`
Expected: clean build (this catches any missed type mirror), vitest green.
Do NOT commit.

---

### Task 7: Web — Export screen modes + Dashboard copy buttons

**Files:**
- Modify: `apps/web/src/screens/Export/index.tsx`
- Modify: `apps/web/src/screens/Dashboard/index.tsx`
- Modify: `apps/web/src/screens/Dashboard/NextUpCard.tsx`

**Interfaces:**
- Consumes: `useGenerateExport()` (existing mutation → `api.getExport({ mode?, focusTopicId? })`), `dash.sessionQueueCount` and `dash.nextUp` (existing dashboard payload), `useToast`.
- Produces: Export screen `Mode = 'full' | 'domain' | 'focus' | 'repeat' | 'learn'`; Dashboard buttons "Copy repetition context" / "Copy learning context"; `NextUpCard` gains `onCopyContext: () => void` and `copying: boolean` props.

- [ ] **Step 1: Export screen modes**

In `apps/web/src/screens/Export/index.tsx`:

1. `type Mode = 'full' | 'domain' | 'focus' | 'repeat' | 'learn';`
2. Add two segmented buttons after "Focus topic" (same pattern):

```tsx
            <button
              className={mode === 'repeat' ? 'on' : ''}
              onClick={() => setMode('repeat')}
              type="button"
            >
              Repeat today
            </button>
            <button
              className={mode === 'learn' ? 'on' : ''}
              onClick={() => setMode('learn')}
              type="button"
            >
              Learn next
            </button>
```

3. Mode help/config blocks:

```tsx
          {mode === 'repeat' && (
            <p className="muted" style={{ margin: 0 }}>
              Today&apos;s interleaved review queue plus a conduct script — Claude quizzes you card
              by card and records your self-grades.
            </p>
          )}

          {mode === 'learn' && (
            <div className="col gap-2">
              <label className="field-label" htmlFor="export-learn-topic">
                Topic to learn
              </label>
              <select
                id="export-learn-topic"
                className="select"
                value={focusTopicId}
                onChange={(e) => setFocusTopicId(e.target.value)}
                style={{ maxWidth: 480 }}
              >
                <option value="">Next Up (default)</option>
                {sortedTopics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.domain ? ` — ${t.domain}` : ''}
                  </option>
                ))}
              </select>
              <p className="muted" style={{ margin: 0 }}>
                A teaching session for one new topic: where it fits, what it builds on, and
                instructions for Claude to propose cards and mark it studied.
              </p>
            </div>
          )}
```

4. `handleGenerate` additions:

```tsx
    } else if (mode === 'repeat') {
      args.mode = 'repeat';
    } else if (mode === 'learn') {
      args.mode = 'learn';
      if (focusTopicId) args.focusTopicId = focusTopicId;
    }
```

5. `canGenerate`: add `mode === 'repeat' || mode === 'learn'` as always-generatable (learn's empty select means server default).

- [ ] **Step 2: Dashboard copy plumbing**

In `apps/web/src/screens/Dashboard/index.tsx`:

1. Import `useGenerateExport` from `../../api/hooks`.
2. Inside `Dashboard()`:

```tsx
  const exportCtx = useGenerateExport();

  function copyContext(args: { mode: string }, label: string) {
    exportCtx.mutate(args, {
      onSuccess: (data) => {
        if (!navigator.clipboard?.writeText) {
          toast('Clipboard unavailable — use the Export screen to copy manually', 'info');
          return;
        }
        navigator.clipboard
          .writeText(data.exportMd)
          .then(() => toast(`${label} copied — paste into a fresh Claude chat`, 'success'))
          .catch(() => toast('Could not copy — use the Export screen to copy manually', 'error'));
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Export failed', 'error'),
    });
  }
```

3. Next to the "▶ Review all (N)" button (same row — wrap both in a `div className="row gap-2"` with the existing `marginBottom`), render:

```tsx
        {dash.sessionQueueCount > 0 && (
          <button
            className="btn"
            disabled={exportCtx.isPending}
            onClick={() => copyContext({ mode: 'repeat' }, 'Repetition context')}
          >
            {exportCtx.isPending ? 'Generating…' : '⧉ Copy repetition context'}
          </button>
        )}
```

4. Pass the learn handler into NextUpCard:

```tsx
      <NextUpCard
        nextUp={dash.nextUp}
        plannedCount={counts.planned}
        starting={starting}
        onStart={startTopic}
        copying={exportCtx.isPending}
        onCopyContext={() => copyContext({ mode: 'learn' }, 'Learning context')}
      />
```

- [ ] **Step 3: NextUpCard button**

In `apps/web/src/screens/Dashboard/NextUpCard.tsx`, add `copying: boolean; onCopyContext: () => void;` to both components' props (threaded through `NextUpBody`), and change the Start button row to:

```tsx
      <div className="row gap-2">
        <button className="btn btn-primary" disabled={starting} onClick={() => onStart(topic)}>
          {starting ? 'Starting…' : 'Start'}
        </button>
        <button className="btn" disabled={copying} onClick={onCopyContext}>
          {copying ? 'Generating…' : '⧉ Copy learning context'}
        </button>
      </div>
```

The blocked-explainer branch (`!nextUp`) renders no copy button (server would 422 anyway).

- [ ] **Step 4: Verify**

Run: `yarn workspace @terrain/web build && yarn workspace @terrain/web test && yarn lint && yarn format:check`
Expected: clean. Do NOT commit.

---

### Task 8: Full verification sweep + live round-trip smoke

**Files:**
- Modify: `CLAUDE.md` (Status section: add AI session loop to the built list)
- No other source files. Smoke script stays in the session scratchpad — never committed.

- [ ] **Step 1: Full monorepo gate**

```bash
yarn build && yarn test && yarn lint && yarn format:check
```

Expected: all workspaces green (API suite grows by roughly 15–20 tests over the interleaved-session baseline).

- [ ] **Step 2: Stack up**

```bash
docker compose up -d
kill -9 $(lsof -ti:3000) 2>/dev/null   # pkill does NOT work for nest
yarn workspace @terrain/api start &    # :3000
yarn workspace @terrain/web dev &      # :5180
```

Confirm `prisma migrate status` reports all 3 migrations applied.

- [ ] **Step 3: API round-trip (the core loop, scripted)**

Same-origin fetch through the :5180 proxy, logged in (demo account or user-provided credentials — never hardcode secrets in committed files):

1. `GET /api/sessions/export?mode=repeat` → 200; body contains `Export: repeat`, `## TODAY'S REVIEW QUEUE`, `## SESSION CONDUCT — repetition`, `studiedTopics` in the contract, real `Session: <uuid>`; queue lines match `card <id> [kind]` and adjacent lines vary in chapter where ≥2 chapters are due.
2. `GET /api/sessions/export?mode=learn` → 200 with `## LEARNING GOAL` for the account's Next Up topic (or 422 with the exact message if none — assert whichever matches the account state; the demo account may need `focusTopicId`).
3. **Simulated Claude output**: craft a `learning-os` block echoing export #2's sessionId, containing one `reviews[]` entry with a real due promptId + grade `good`, `studiedTopics: ["<the learn export's focus topic title>"]` (a planned topic), and one `proposedPrompts` entry for it. `POST /api/sessions/import/preview` → `activations: [{ …, willActivate: true }]`, `applicable: true`. `POST /api/sessions/import` → `topicsActivated: 1`, `reviewsApplied: 1`.
4. Verify state: `GET /api/topics/<focus id>` → `status: 'active'`; the graded prompt's `nextReviewAt` moved into the future (FSRS advanced); `GET /api/metrics/dashboard` → `nextUp` moved on to a different topic.
5. Negative: preview a block with `studiedTopics: ["No Such Topic"]` → `unresolved` has `kind: 'studiedTopic', reason: 'missing'`, `applicable: false`.

- [ ] **Step 4: UI smoke via headless Brave CDP**

Scratchpad script (CDP WebSocket, `.textContent`):

1. Dashboard shows "⧉ Copy repetition context" (when queue non-empty) and the Next Up card shows "⧉ Copy learning context"; clicking each fires the success toast (clipboard may be unavailable headless — asserting the fallback toast also counts as pass; assert *a* toast appears).
2. Export screen shows 5 mode buttons; "Repeat today" generates an export whose `<pre>` contains `SESSION CONDUCT — repetition`.
3. Import screen: paste the Step-3 preview block (before applying it, or generate a fresh export) → "Studied topics" section renders with "planned → active" pill; after Apply the result strip shows the "topics activated" KPI.
4. 0 console errors throughout.

- [ ] **Step 5: Docs + report**

Update `CLAUDE.md`'s Status section: append "AI session loop (repeat/learn exports + studiedTopics activation)" to the built list. Report results with evidence. Leave the stack running. Do NOT commit.

---

## Self-Review (completed)

- **Spec coverage:** repeat mode incl. empty-queue + estimate line (Task 3), learn mode incl. default/422/404 + prereq summaries + existing cards + scoped roadmap (Task 4), contract field + rule text (Task 1), enum migration + mode persistence (Task 2), activation plan/apply incl. archived/ambiguous/in-batch/dedup (Task 5), preview section + KPI + Unresolved rendering (Task 6), Dashboard buttons + Export screen + clipboard fallback (Task 7), round-trip smoke incl. unblock verification (Task 8). Telegram: no changes (spec: out of scope). ✅
- **Placeholder scan:** Task 5 Step 1 test bodies are semantic pins to be realized against the existing spec-file harness (the harness shapes are file-specific); all assertions and expected values are stated. All other steps carry complete code. ✅
- **Type consistency:** `ActivationPlan` identical API↔web; `studiedTopics` max 20 in schema = spec; `sessionQueue` consumed read-only (no re-cap); `REPEAT_CONDUCT`/`LEARN_CONDUCT` names match between Tasks 3–4; `topicsActivated` name consistent across service/web/result-strip; `exportMode` enum values match Prisma migration. ✅
