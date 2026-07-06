# Session-Driven Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-03-session-driven-learning-design.md`

**Goal:** Move teaching/elaboration/application-checking/summarizing into the Claude session (driven by a stronger conduct brief), capture the "doing" via a new `applicationEvents` import array, and retire the passive in-app summary textarea.

**Architecture:** One additive array (`applicationEvents`) on the `learning-os` v2 contract (`packages/types`), resolved+applied in `ImportService` to the existing `ApplicationEvent` model (no DB migration). Rewritten `session-conduct.ts` + `output-contract.ts` scripts that force teach-back and do-and-capture and keep notes terse. Web: an application-events KPI on Import, and a read-only summary with a collapsible manual override in `TopicDetailPanel`.

**Tech Stack:** NestJS 11 + Prisma 7 (jest) in `apps/api`; Zod (vitest) in `packages/types`; React 19 + TanStack Router/Query (vitest, tsc) in `apps/web`.

## Global Constraints

- **No git commits.** Repo convention (CLAUDE.md): work stays uncommitted in the working tree. Every "commit" a normal plan would have is replaced by a **verification step**. Do not run `git commit`.
- **No DB migration.** The `ApplicationEvent` model already exists; only an import path is added. Do not touch `schema.prisma` or `prisma/migrations`.
- Formatting is oxfmt (single quotes, trailing commas); lint is oxlint. Run `yarn lint` and `yarn format` from the repo root after touching code.
- `apps/api` + `packages/*` are CommonJS with extensionless imports; `apps/web` is ESM.
- The `learning-os` contract stays **version 2** — the new array is additive with `.default([])`, so old blocks still parse. Do not bump the version.
- `AppEventKind` is exactly `'project_usage' | 'problem_solved' | 'audit_exercise' | 'real_debugging'` — reuse it verbatim, do not invent kinds.
- Self-graded recall is unchanged: the `again|hard|good|easy` grade stays the user's own verdict. Do not add Claude-assigned grades.
- Notes stay a thin external index: single `noteRef`, existing `noteSummaries` shape. Do not add note fields or a multi-ref schema.

---

### Task 1: Contract — `applicationEvents` on the learning-os v2 schema

**Files:**
- Modify: `packages/types/src/index.ts` (schemas ~line 21-76)
- Test: `packages/types/src/learning-os.test.ts`

**Interfaces:**
- Produces: `learningOsV2Schema` gains `applicationEvents: { topicTitle: string; kind: AppEventKind; description: string; url?: string }[]` (defaults to `[]`). `LearningOsV2['applicationEvents']` is consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Append to `packages/types/src/learning-os.test.ts`:

```ts
describe('applicationEvents (v2)', () => {
  it('defaults to [] when omitted (old blocks still parse)', () => {
    const out = parseLearningOs(minimalV2);
    expect(out.applicationEvents).toEqual([]);
  });

  it('parses a valid application event', () => {
    const block = `\`\`\`learning-os
{
  "version": 2,
  "reviews": [],
  "proposedTopics": [],
  "proposedPrompts": [],
  "noteSummaries": [],
  "applicationEvents": [
    { "topicTitle": "Monotonic stack", "kind": "problem_solved",
      "description": "Solved LC 739 from scratch", "url": "https://leetcode.com/problems/daily-temperatures/" }
  ]
}
\`\`\``;
    const out = parseLearningOs(block);
    expect(out.applicationEvents).toHaveLength(1);
    expect(out.applicationEvents[0].kind).toBe('problem_solved');
    expect(out.applicationEvents[0].topicTitle).toBe('Monotonic stack');
  });

  it('rejects an unknown kind', () => {
    const bad = {
      version: 2,
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [],
      noteSummaries: [],
      applicationEvents: [{ topicTitle: 'X', kind: 'invented', description: 'd' }],
    };
    expect(learningOsV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing description', () => {
    const bad = {
      version: 2,
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [],
      noteSummaries: [],
      applicationEvents: [{ topicTitle: 'X', kind: 'problem_solved' }],
    };
    expect(learningOsV2Schema.safeParse(bad).success).toBe(false);
  });

  it('rejects a malformed url', () => {
    const bad = {
      version: 2,
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [],
      noteSummaries: [],
      applicationEvents: [{ topicTitle: 'X', kind: 'problem_solved', description: 'd', url: 'not-a-url' }],
    };
    expect(learningOsV2Schema.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/types test`
Expected: the 5 new assertions FAIL (`applicationEvents` is `undefined` / unknown key rejected by `.strict()`); existing tests pass.

- [ ] **Step 3: Implement the schema**

In `packages/types/src/index.ts`, add the schema definition immediately after `noteSummarySchema` (after line 29):

```ts
const applicationEventSchema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    kind: z.enum(['project_usage', 'problem_solved', 'audit_exercise', 'real_debugging']),
    description: z.string().min(1).max(2000),
    url: z.string().url().max(500).optional(),
  })
  .strict();
```

Then add the array to `learningOsV2Schema`, immediately after the `noteSummaries` line (line 65):

```ts
    applicationEvents: z.array(applicationEventSchema).max(50).default([]),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @terrain/types test`
Expected: all tests PASS.

- [ ] **Step 5: Verify build + lint/format (no commit)**

Run: `yarn workspace @terrain/types build && yarn lint && yarn format`
Expected: build exit 0; lint clean; format rewrites at most the two files you touched. Leave everything uncommitted.

---

### Task 2: Import — resolve + apply `applicationEvents`

**Files:**
- Modify: `apps/api/src/import/import.service.ts`
- Test: `apps/api/src/import/import.service.spec.ts`

**Interfaces:**
- Consumes: `LearningOsV2['applicationEvents']` (Task 1); the existing `ApplicationEvent` Prisma model (`{ userId, topicId, kind, description, url? }`).
- Produces: `ImportPlan.applicationEvents: ApplicationEventPlan[]`; `ImportResult.appEventsApplied: number`; `Unresolved.kind` union gains `'applicationEvent'`. Both are consumed by Task 4 (web mirror types).

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/import/import.service.spec.ts`, first extend the apply-transaction mock so it can record `ApplicationEvent` creates. In `txMock()` (starts line 456), add this property to the returned object (e.g. after the `prompt: { … }` block):

```ts
      applicationEvent: { create: jest.fn().mockResolvedValue({ id: 'ae-1' }) },
```

Then add a new describe block at the end of the file (after the last existing `describe`):

```ts
describe('applicationEvents import', () => {
  it('preview resolves an existing topic and reports no unresolved', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence(
      v2({
        applicationEvents: [
          { topicTitle: 'Stacks', kind: 'problem_solved', description: 'Solved LC739' },
        ],
      }),
    );
    const plan = await service.preview('userA', raw);
    expect(plan.applicationEvents).toHaveLength(1);
    expect(plan.applicationEvents[0].resolvedTopicId).toBe('t1');
    expect(plan.unresolved).toHaveLength(0);
  });

  it('preview flags an unresolved topic title (blocks apply)', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence(
      v2({
        applicationEvents: [
          { topicTitle: 'Nope', kind: 'problem_solved', description: 'd' },
        ],
      }),
    );
    const plan = await service.preview('userA', raw);
    expect(plan.applicable).toBe(false);
    expect(plan.unresolved).toContainEqual(
      expect.objectContaining({ kind: 'applicationEvent', title: 'Nope', reason: 'missing' }),
    );
  });

  it('dedupes identical (topicTitle, kind, description) entries', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence(
      v2({
        applicationEvents: [
          { topicTitle: 'Stacks', kind: 'problem_solved', description: 'same' },
          { topicTitle: 'stacks', kind: 'problem_solved', description: 'same' },
        ],
      }),
    );
    const plan = await service.preview('userA', raw);
    expect(plan.applicationEvents).toHaveLength(1);
  });

  it('apply creates an ApplicationEvent row and counts it', async () => {
    const tx = txMock();
    const prisma: any = {
      sessionExport: { findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }) },
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
      prompt: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = await svcWithTx(prisma);
    const raw = fence(
      v2({
        applicationEvents: [
          {
            topicTitle: 'Stacks',
            kind: 'problem_solved',
            description: 'Solved LC739',
            url: 'https://leetcode.com/problems/daily-temperatures/',
          },
        ],
      }),
    );
    const res = await service.apply('userA', raw);
    expect(res.appEventsApplied).toBe(1);
    expect(tx.applicationEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'userA',
        topicId: 't1',
        kind: 'problem_solved',
        description: 'Solved LC739',
        url: 'https://leetcode.com/problems/daily-temperatures/',
      },
    });
  });
});
```

Note: `svcWithTx` is defined inside the existing `describe('ImportService.apply (transaction)', …)` block. Place the new `describe('applicationEvents import', …)` **inside** that same block (after its last test, before its closing `})`) so `svcWithTx` and `txMock` are in scope — OR lift a local copy. Simplest: nest it inside the apply-transaction describe.

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test import.service`
Expected: the 4 new tests FAIL (`plan.applicationEvents` undefined, `res.appEventsApplied` undefined, `tx.applicationEvent.create` never called); all existing import tests pass.

- [ ] **Step 3: Add the plan/result types + Unresolved kind**

In `apps/api/src/import/import.service.ts`:

Add `'applicationEvent'` to the `Unresolved.kind` union (line 127):

```ts
  kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent' | 'prompt' | 'studiedTopic' | 'applicationEvent';
```

Add a new plan interface after `NoteSummaryPlan` (after line 89):

```ts
export interface ApplicationEventPlan {
  topicTitle: string;
  /** null = topic created in this same import (resolved by title inside apply's tx). */
  resolvedTopicId: string | null;
  kind: LearningOsV2['applicationEvents'][number]['kind'];
  description: string;
  url?: string;
}
```

Add the field to `ImportPlan` (after the `noteSummaries` line, line 139):

```ts
  applicationEvents: ApplicationEventPlan[];
```

Add the counter to `ImportResult` (after `noteSummariesApplied`, line 150):

```ts
  appEventsApplied: number;
```

- [ ] **Step 4: Resolve applicationEvents in `buildPlan`**

In `buildPlan`, immediately after the `noteSummaries` mapping block (after line 606, before `const newPrompts`), add resolution with dedup:

```ts
    const seenAppEvent = new Set<string>();
    const applicationEvents: ApplicationEventPlan[] = [];
    for (const ae of parsed.applicationEvents) {
      const dedupKey = `${norm(ae.topicTitle)}|${ae.kind}|${ae.description.trim()}`;
      if (seenAppEvent.has(dedupKey)) continue; // drop exact duplicates
      seenAppEvent.add(dedupKey);
      const ex = resolveExisting(ae.topicTitle);
      let resolvedTopicId: string | null = null;
      if (ex.ambiguous)
        unresolved.push({
          kind: 'applicationEvent',
          title: ae.topicTitle,
          context: 'applicationEvent',
          reason: 'ambiguous',
        });
      else if (ex.id != null) resolvedTopicId = ex.id;
      else if (!inBatch(ae.topicTitle))
        unresolved.push({
          kind: 'applicationEvent',
          title: ae.topicTitle,
          context: 'applicationEvent',
          reason: 'missing',
        });
      applicationEvents.push({
        topicTitle: ae.topicTitle,
        resolvedTopicId,
        kind: ae.kind,
        description: ae.description,
        url: ae.url,
      });
    }
```

Add `applicationEvents` to the `buildPlan` return object (after the `noteSummaries,` line ~694):

```ts
      applicationEvents,
```

- [ ] **Step 5: Apply applicationEvents in the transaction**

In `apply()`'s `$transaction` callback, add a new step after step **f** (the note-summaries loop, after line 427) and before step **g** (the SessionExport stamp):

```ts
      // f2. apply application events — the "doing" a session captured. Each
      // resolves to an existing or in-batch topic (unresolved already blocked
      // apply earlier); creating a row satisfies mastery's application gate.
      let appEventsApplied = 0;
      for (const ae of plan.applicationEvents) {
        const id = ae.resolvedTopicId ?? idByNorm.get(norm(ae.topicTitle));
        if (!id) continue;
        await tx.applicationEvent.create({
          data: {
            userId,
            topicId: id,
            kind: ae.kind,
            description: ae.description,
            url: ae.url ?? null,
          },
        });
        appEventsApplied++;
      }
```

Add `appEventsApplied` to the `apply()` return object (after `noteSummariesApplied,` line 450):

```ts
        appEventsApplied,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test import.service`
Expected: all import tests PASS (new 4 + existing).

- [ ] **Step 7: Run the full API suite (no regression)**

Run: `yarn workspace @terrain/api test`
Expected: full API suite PASSES.

- [ ] **Step 8: Verify build + lint/format (no commit)**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format`
Expected: build exit 0; lint clean; format touches only changed files. Leave uncommitted.

---

### Task 3: Session conduct + output contract rewrite

**Files:**
- Modify: `apps/api/src/sessions/session-conduct.ts`
- Modify: `apps/api/src/sessions/output-contract.ts`
- Test: `apps/api/src/sessions/output-contract.spec.ts`
- Create: `apps/api/src/sessions/session-conduct.spec.ts`

**Interfaces:**
- Consumes: nothing new (string constants only). The contract text must name the `applicationEvents` array from Task 1 so Claude emits it.
- Produces: rewritten `LEARN_CONDUCT`, `REPEAT_CONDUCT`, `OUTPUT_CONTRACT` string constants (same export names — `export-generator.service.ts` imports them unchanged).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/sessions/output-contract.spec.ts` inside the existing `describe('OUTPUT_CONTRACT', …)`:

```ts
  it('documents the applicationEvents array', () => {
    expect(OUTPUT_CONTRACT).toContain('applicationEvents');
    expect(OUTPUT_CONTRACT).toContain('problem_solved');
  });

  it('keeps the grade-is-the-users-verdict rule', () => {
    expect(OUTPUT_CONTRACT).toContain('never yours');
  });

  it('tells Claude to keep noteSummaries terse and point to external notes', () => {
    expect(OUTPUT_CONTRACT.toLowerCase()).toContain('brief');
    expect(OUTPUT_CONTRACT).toContain('Obsidian');
  });
```

Create `apps/api/src/sessions/session-conduct.spec.ts`:

```ts
import { LEARN_CONDUCT, REPEAT_CONDUCT } from './session-conduct';

describe('session conduct scripts', () => {
  it('LEARN forces teach-back and doing', () => {
    expect(LEARN_CONDUCT.toLowerCase()).toContain('explain');
    expect(LEARN_CONDUCT.toLowerCase()).toContain('in your own words');
    expect(LEARN_CONDUCT).toContain('applicationEvents');
    expect(LEARN_CONDUCT).toContain('Obsidian');
  });

  it('REPEAT keeps self-grading and forces elaboration on misses', () => {
    expect(REPEAT_CONDUCT).toContain('grade my own recall');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('again');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('explain');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test sessions`
Expected: the new assertions FAIL (current scripts lack `applicationEvents`, teach-back, terse-notes text); existing output-contract tests pass.

- [ ] **Step 3: Rewrite `session-conduct.ts`**

Replace the entire contents of `apps/api/src/sessions/session-conduct.ts` with:

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
4. On any card I grade again or hard, before moving on make me explain the
   correct reasoning back in my own words — why it works, not just the answer.
   Push on gaps; a fluent-sounding restatement that skips the mechanism doesn't
   count.
5. Cards tagged [NEW] have never been studied: give a 2-4 sentence introduction
   first, then quiz as normal.
6. If a due topic is application-worthy (a pattern/technique) and has no
   application event yet, offer me one concrete novel problem to solve. If I
   genuinely solve it, record it in applicationEvents (see the output contract).
Reference every review by promptId from the queue above.`;

export const LEARN_CONDUCT = `## SESSION CONDUCT — learning
Teach me the topic in LEARNING GOAL, then make me prove I learned it. Do not
just lecture — the session must force retrieval, elaboration, and application.
1. Teach Socratically — questions before explanations. Push back if I move too
   fast; enforce confusion time. Connect new material to the prerequisites above.
2. ELABORATE — before you consider the topic taught, make me explain it back in
   my own words: why it works, its invariant, and where it breaks. Probe gaps;
   don't accept a fluent restatement that skips the mechanism.
3. DO — make me actually apply it: implement it from scratch, or solve a novel
   variant that fits the topic type. Check my work. If I genuinely solve a novel
   problem, record it in applicationEvents (see the output contract) so it counts
   toward mastery.
4. CONSPECT — at the end, write me an Obsidian-ready conspect of the topic as
   prose in the chat (not inside the learning-os block) for me to paste into my
   notes; if a diagram would help, describe the OneNote drawing to make.
5. In the learning-os block:
   - propose 3-7 atomic cards via proposedPrompts (mix concept/code/problem as
     fits the topic; don't duplicate the existing cards listed above);
   - write ONE brief noteSummaries entry that points at where the depth lives —
     keyInsight is a 1-2 sentence index (the full conspect is in Obsidian), and
     suggestedNoteRef names the primary Obsidian location;
   - if I solved a novel problem, add an applicationEvents entry;
   - list the topic's title in studiedTopics so the app activates it.
   Only add other titles to studiedTopics if we genuinely studied them in
   depth — never topics merely mentioned.`;
```

- [ ] **Step 4: Rewrite `output-contract.ts`**

Replace the entire contents of `apps/api/src/sessions/output-contract.ts` with:

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
    { "topicTitle": "...", "keyInsight": "brief — 1-2 sentences, depth lives in Obsidian",
      "invariant": "only when genuinely sharp", "contradiction": "only when real",
      "suggestedNoteRef": "Obsidian: DSA/Stacks/Monotonic" }
  ],
  "applicationEvents": [
    { "topicTitle": "<exact title, existing or from proposedTopics>",
      "kind": "problem_solved | project_usage | audit_exercise | real_debugging",
      "description": "what I actually did/solved",
      "url": "https://leetcode.com/problems/... (optional)" }
  ],
  "studiedTopics": ["<exact title of a topic genuinely studied this session>"],
  "nextSession": { "focusTitle": "...", "coldChallenge": "..." }
}
\`\`\`

Rules: grade is one of again|hard|good|easy — the user's own recall verdict, never yours.
Quiz through the DUE cards listed in this export and reference them by promptId.
Prefer promptId reviews; use topicTitle-only reviews only for work outside any listed card.
applicationEvents: record only things the user genuinely did this session (solved a novel
problem, used it in a project) — one such event satisfies the topic's mastery application
condition, so do not fabricate them.
noteSummaries: keep each entry BRIEF — Terrain is an index, not a note store. Put the full
conspect in the Obsidian note (write it as chat prose); keyInsight is a short pointer and
suggestedNoteRef names where the depth lives. Name any secondary artifact (a OneNote drawing)
inside the summary prose, not as a separate field.
studiedTopics: titles of topics genuinely studied this session — a planned topic listed here
is activated on import (its successors unblock). Do not list topics merely mentioned.
Omit arrays you have nothing for (use []). Do not add fields outside this schema — the parser
is strict and will reject the whole block. Keep each prompt atomic — one fact or concept per
prompt. promptKind: "code" = write an implementation from scratch; "problem" = a concrete
practice problem (include url + problemDifficulty + estimatedMinutes).`;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test sessions`
Expected: `output-contract.spec.ts` and `session-conduct.spec.ts` PASS.

- [ ] **Step 6: Run the full API suite (export-generator embeds these strings)**

Run: `yarn workspace @terrain/api test`
Expected: full API suite PASSES. If any `export-generator.service.spec.ts` assertion pinned exact old conduct wording and now fails, update that assertion to match the new text (the export still embeds `OUTPUT_CONTRACT`/`LEARN_CONDUCT`/`REPEAT_CONDUCT` by the same imports — only wording changed).

- [ ] **Step 7: Verify build + lint/format (no commit)**

Run: `yarn workspace @terrain/api build && yarn lint && yarn format`
Expected: build exit 0; lint/format clean. Uncommitted.

---

### Task 4: Web — `ImportResult` mirror + application-events KPI

**Files:**
- Modify: `apps/web/src/api/types.ts` (`ImportResult` ~line 337; `Unresolved.kind` ~line 308)
- Modify: `apps/web/src/screens/Import/index.tsx` (result stat strip ~line 154-181)

**Interfaces:**
- Consumes: `ImportResult.appEventsApplied` + `Unresolved.kind: 'applicationEvent'` from Task 2 (backend shapes).
- Produces: no new exports — the KPI renders `applyResult.appEventsApplied`.

- [ ] **Step 1: Update the mirror types**

In `apps/web/src/api/types.ts`, add to the `ImportResult` interface (after `noteSummariesApplied: number;`, line 342):

```ts
  appEventsApplied: number;
```

And extend the `Unresolved.kind` union (line 308) to match the backend:

```ts
  kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent' | 'prompt' | 'studiedTopic' | 'applicationEvent';
```

- [ ] **Step 2: Add the KPI to the result strip**

In `apps/web/src/screens/Import/index.tsx`, inside the `<div className="stat-strip">`, add a new KPI immediately after the `note summaries` KPI block (after line 174, before the `nextSessionStored` KPI):

```tsx
              <div className="kpi">
                <div>{applyResult.appEventsApplied}</div>
                <div className="kpi-label">app. events</div>
              </div>
```

- [ ] **Step 3: Verify the web build**

Run: `yarn workspace @terrain/web build`
Expected: PASS (tsc `--noEmit` + vite build). The mirror type matches the backend `ImportResult`.

- [ ] **Step 4: Lint/format check (no commit)**

Run: `yarn lint && yarn format`
Expected: clean; only the two web files rewritten. Uncommitted.

---

### Task 5: Web — retire passive summary authoring in `TopicDetailPanel`

**Files:**
- Modify: `apps/web/src/components/TopicDetailPanel.tsx` (notes section ~line 303-339; state ~line 59-75; `saveNotes` ~line 86-90)

**Interfaces:**
- Consumes: `t.summary` / `t.noteRef` from `useTopic` (unchanged).
- Produces: no export change — the summary renders read-only with a collapsible manual override; `noteRef` stays editable.

- [ ] **Step 1: Add local state for the manual-override disclosure**

In `TopicDetailPanel.tsx`, the existing state block already has `noteRef`/`summary` (lines 59-64). Add one more `useState` next to them:

```tsx
  const [editingSummary, setEditingSummary] = useState(false);
```

- [ ] **Step 2: Replace the notes section**

Replace the entire `{/* notes */}` block (lines 303-339, from `<div className="col gap-2">` containing "Notes & reference" through its closing `</div>`) with:

```tsx
      {/* notes */}
      <div className="col gap-2">
        <div className="card-title" style={{ margin: 0 }}>
          Notes & reference
        </div>
        <input
          className="input"
          placeholder="noteRef — Obsidian/OneNote path or URL"
          value={noteRef}
          onChange={(e) => setNoteRef(e.target.value)}
        />
        {noteHref && (
          <a
            className="faint"
            style={{ fontSize: 12 }}
            href={noteHref}
            target="_blank"
            rel="noreferrer"
          >
            ↗ {noteHref.startsWith('obsidian://') ? 'open in Obsidian' : 'open current reference'}
          </a>
        )}
        <button
          className="btn btn-sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={update.isPending}
          onClick={saveNotes}
        >
          Save reference
        </button>
        {/* Summary is authored by Claude sessions (composeSummary on import),
            not hand-typed. Show it read-only; manual edits are an escape hatch. */}
        {t.summary ? (
          <div className="card card-pad" style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {t.summary}
          </div>
        ) : (
          <span className="faint" style={{ fontSize: 12 }}>
            No summary yet — a Claude learning session writes one on import.
          </span>
        )}
        {editingSummary ? (
          <>
            <textarea
              className="textarea"
              placeholder="Manual summary override (teaching condition)"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
            <div className="row gap-2">
              <button
                className="btn btn-sm"
                disabled={update.isPending}
                onClick={() => {
                  saveNotes();
                  setEditingSummary(false);
                }}
              >
                Save notes
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSummary(t.summary ?? '');
                  setEditingSummary(false);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setEditingSummary(true)}
          >
            Edit manually
          </button>
        )}
      </div>
```

Note: `saveNotes` (line 86) already PATCHes `{ noteRef, summary }` together. Both the always-visible "Save reference" button and the override's "Save notes" call it; since `noteRef` and `summary` state are both seeded from server truth on load, saving via either writes a consistent pair (an unchanged field is re-written to its current value — a no-op). This keeps `noteRef` independently editable (the common "set the Obsidian link" action) while summary stays session-authored behind the override.

- [ ] **Step 3: Verify the web build**

Run: `yarn workspace @terrain/web build`
Expected: PASS. If tsc flags `summary`/`setSummary` as unused when the override is collapsed — they ARE used inside the `editingSummary` branch, so no unused-var error is expected; if one appears, you removed a usage by mistake — restore it.

- [ ] **Step 4: Lint/format check (no commit)**

Run: `yarn lint && yarn format`
Expected: clean; only `TopicDetailPanel.tsx` rewritten. Uncommitted.

---

### Task 6: Full gate + live smoke

**Files:** none (verification only). Runbook: `docs/ops/local-dev.md`.

- [ ] **Step 1: Full monorepo gate**

Run from the repo root:

```bash
yarn build && yarn test && yarn lint && yarn format:check
```

Expected: all four PASS (every workspace builds; API jest + types/sr-engine/web vitest all green; lint + format clean).

- [ ] **Step 2: Stack up**

```bash
docker compose up -d
yarn workspace @terrain/api start &      # API on :3000
yarn workspace @terrain/web dev &        # web on :5180
```

If :3000 is held by a zombie, kill it first: `kill -9 $(lsof -ti:3000)` (per CLAUDE.md — `pkill -f "nest start"` does not work).

- [ ] **Step 3: Contract text smoke**

Generate a `learn` export and confirm the new brief is present:

```bash
# logged-in session assumed; adjust auth per docs/ops/local-dev.md
curl -s 'http://localhost:3000/sessions/export?mode=learn' --cookie "<auth>" | grep -E 'applicationEvents|Obsidian|in your own words'
```

Expected: matches for `applicationEvents`, `Obsidian`, and the teach-back phrasing — the export embeds the rewritten conduct + contract.

- [ ] **Step 4: End-to-end import smoke**

Against a logged-in session, `POST /sessions/import/preview` then `/sessions/import` a `learning-os` block containing an `applicationEvents` entry on an existing topic plus a terse `noteSummaries` entry. Confirm:
1. Preview resolves the topic (0 unresolved), plan shows the application event.
2. Apply returns `appEventsApplied: 1` and `noteSummariesApplied: 1`.
3. `GET /topics/:id` shows `mastery.application` ✓ (the app-event flipped it) and the composed `summary`.

- [ ] **Step 5: UI smoke (CDP or manual)**

1. `node scripts/smoke.mjs` → exit 0 (no console errors on `/`, `/topics`, `/roadmap`, `/export`, `/import`).
2. Import screen result card shows the new `app. events` KPI after an apply.
3. Topic detail panel: the summary renders read-only in a card; "Edit manually" reveals the override textarea; Save persists, Cancel restores.

- [ ] **Step 6: Report**

Summarize gate + smoke results honestly (per repo convention, leave everything uncommitted).

---

## Self-review notes

- **Spec coverage:** Part 1 (conduct arc: teach-back, do, terse notes) → Task 3; Part 2 (`applicationEvents` contract + import path + result counter + mastery effect) → Tasks 1, 2; Part 3 (notes-as-index guidance) → Task 3 (contract/conduct text — no schema change, per spec); Part 4 (web KPI, retire passive summary → decision A) → Tasks 4, 5. Spec Testing section → each task's TDD steps + Task 6 gate/smoke.
- **Type consistency:** `applicationEvents` entry shape is defined once in Task 1 (`{ topicTitle, kind: AppEventKind, description, url? }`) and consumed by `ApplicationEventPlan` (Task 2) via `LearningOsV2['applicationEvents'][number]['kind']`; `ImportResult.appEventsApplied` (Task 2) matches the web mirror (Task 4); `Unresolved.kind` gains `'applicationEvent'` in both backend (Task 2) and web (Task 4).
- **No migration:** Task 2 writes to the existing `ApplicationEvent` model via `tx.applicationEvent.create`; `schema.prisma` untouched (Global Constraints).
- **Known-good conventions used:** `whiteSpace: 'pre-wrap'` for summary display (matches `Import/sections.tsx` + `Export/index.tsx`); `btn-ghost btn-sm`, `card card-pad`, `kpi`/`stat-strip`, `Card title=` all pre-existing.
