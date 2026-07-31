# Roadmap Chapter-Node Fix + Import v2 Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the roadmap "double square" artifact (React Flow built-in `'group'` type collision) and make the Import preview render the v2 contract fully — labeled card reviews, grade badges, visible proposed cards, fixed unresolved panel.

**Architecture:** Web-only rename for the roadmap (one reserved type name → `'chapter'`). Import fix is a thin backend display-enrichment (two nullable fields on `ResolvedCardReview`, one counter on `ImportResult`) plus a web rewrite of the import types and preview sections to mirror the backend shapes.

**Tech Stack:** NestJS 11 + Prisma 7 (jest), React 19 + Vite 8 (`@xyflow/react`), TypeScript 6, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-07-02-roadmap-visuals-and-import-v2-alignment-design.md`

## Global Constraints

- **NO git commits.** Repo policy: work stays uncommitted. Per-task review diffs via tree snapshots: `git add -A && git write-tree && git reset -q` before and after each task, then `git diff <tree1> <tree2>`.
- Monorepo commands run from repo root: `yarn workspace @terrain/api test`, `yarn workspace @terrain/web build`, `yarn lint`, `yarn format:check`.
- oxfmt style: single quotes + trailing commas. Run `yarn format` if `format:check` fails.
- Dev stack: Postgres on :5433 (docker), API on :3000, web dev on :5180 (proxies `/api` → :3000). Kill a stale API with `kill -9 $(lsof -ti:3000)` — `pkill -f "nest start"` does NOT work.
- Demo login for smoke: `demo@terrain.local` / `demo-password` (seeded).
- No new dependencies.

---

### Task 1: Roadmap — rename node type `'group'` → `'chapter'`

The collapsed-chapter node is registered under `'group'`, a **built-in React Flow type name**; its wrapper gets the `react-flow__node-group` class and stock CSS (`width: 150px; padding: 10px; border; background`), drawing a misaligned frame around our card. Rename to the non-reserved `'chapter'`. No behavior/projection changes. (No unit-test surface — web vitest covers only `projection.ts`, which is untouched; verification is build + live DOM check in Task 4.)

**Files:**
- Modify: `apps/web/src/screens/Roadmap/GroupNode.tsx:13`
- Modify: `apps/web/src/screens/Roadmap/index.tsx:47,135,234`

**Interfaces:**
- Consumes: existing `GroupNode` component and `GroupNodeData` (unchanged).
- Produces: React Flow node type key `'chapter'`; `GroupNodeType = Node<GroupNodeData, 'chapter'>`. Task 4's smoke asserts on the `react-flow__node-chapter` DOM class.

- [ ] **Step 1: Snapshot the tree**

```bash
git add -A && git write-tree && git reset -q   # record hash as TREE_BEFORE
```

- [ ] **Step 2: Rename the type in `GroupNode.tsx`**

Line 13, change:

```ts
export type GroupNodeType = Node<GroupNodeData, 'group'>;
```

to:

```ts
export type GroupNodeType = Node<GroupNodeData, 'chapter'>;
```

- [ ] **Step 3: Rename the three usages in `Roadmap/index.tsx`**

Line 47:

```ts
const nodeTypes = { topic: TopicNode, chapter: GroupNode, ghost: GhostNode } as NodeTypes;
```

Line 135 (group-item node construction inside the `useMemo`):

```ts
          type: 'chapter' as const,
```

Line 234 (`onNodeClick`):

```ts
    if (node.type === 'chapter') {
```

- [ ] **Step 4: Verify no `'group'` stragglers**

```bash
grep -rn "'group'" apps/web/src/screens/Roadmap/
```

Expected: no matches. (`projection.ts`'s `kind: 'group'` on `RoadmapItem` is a projection-internal discriminant, NOT a React Flow type — it must stay. If the grep shows only `projection.ts`/`projection.test.ts` hits, that's correct; do not touch them. The `item.kind === 'group'` check in `index.tsx`'s `useMemo` also stays — it reads the projection discriminant.)

Re-check: the only renames are the React Flow node-type name (the `nodeTypes` map key, the `type:` field on the constructed node, `node.type` checks, and the `GroupNodeType` generic).

- [ ] **Step 5: Build + lint gate**

```bash
yarn workspace @terrain/web build && yarn lint && yarn format:check
```

Expected: exit 0, 0 lint findings.

- [ ] **Step 6: Snapshot + diff for review**

```bash
git add -A && git write-tree && git reset -q   # TREE_AFTER
git diff <TREE_BEFORE> <TREE_AFTER>
```

---

### Task 2: Backend — enrich card reviews with display fields + `promptsCreated`

`ResolvedCardReview` carries only opaque ids; the web preview cannot label card-review rows. Add `topicTitle`/`promptText` (nullable, display-only). Add `promptsCreated` to `ImportResult` so the apply summary can report new cards (counts every `tx.prompt.create` in `apply()` — proposed prompts **and** starter cards). No `learning-os` contract change.

**Files:**
- Modify: `apps/api/src/import/import.service.ts` (interface ~line 42, `buildPlan` card branch ~line 495, `apply()` steps c/d ~lines 309-333, result ~line 411, `ImportResult` ~line 132)
- Test: `apps/api/src/import/import.service.spec.ts`

**Interfaces:**
- Consumes: `buildPlan`'s existing `existing: Topic[]` param and `promptsById: Map<string, Prompt>`.
- Produces (Task 3 mirrors these):
  - `ResolvedCardReview` gains `topicTitle: string | null; promptText: string | null`.
  - `ImportResult` gains `promptsCreated: number`.

- [ ] **Step 1: Snapshot the tree** (`git add -A && git write-tree && git reset -q`)

- [ ] **Step 2: Write the failing tests**

Append to the `describe('ImportService.preview', ...)` block in `apps/api/src/import/import.service.spec.ts` (test helpers `build`, `svc`, `fence`, `v2`, `PROMPT` already exist at the top of the file; `PROMPT()` defaults to `topicId: 't1'`/`promptText: 'Explain Stacks'`, and `build()`'s default topic list is `[TOPIC()]` = id `t1`, title `Stacks`):

```ts
  it('enriches a resolved card review with topicTitle and promptText for display', async () => {
    const { prisma } = build({ prompt: { findMany: jest.fn().mockResolvedValue([PROMPT()]) } });
    const service = await svc(prisma);
    const raw = fence(
      v2({ reviews: [{ promptId: '11111111-1111-1111-1111-111111111111', grade: 'good' }] }),
    );
    const plan = await service.preview('userA', raw);
    expect(plan.reviews[0]).toMatchObject({
      kind: 'card',
      topicTitle: 'Stacks',
      promptText: 'Explain Stacks',
    });
  });

  it('a card-review resolution miss carries null topicTitle/promptText', async () => {
    const { prisma } = build(); // prompt.findMany defaults to []
    const service = await svc(prisma);
    const raw = fence(
      v2({ reviews: [{ promptId: '22222222-2222-2222-2222-222222222222', grade: 'good' }] }),
    );
    const plan = await service.preview('userA', raw);
    expect(plan.reviews[0]).toMatchObject({ kind: 'card', topicTitle: null, promptText: null });
  });
```

Append to the `describe('ImportService.apply (transaction)', ...)` block (helpers `txMock`, `svcWithTx` exist there):

```ts
  it('reports promptsCreated = proposed prompts + starter cards', async () => {
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
        proposedTopics: [
          { title: 'Leaf', type: 'pattern', domain: 'DSA', prerequisiteTitles: [], parentTitle: null },
        ],
        proposedPrompts: [{ topicTitle: 'Stacks', promptText: 'What is a stack?' }],
      }),
    );
    const res = await service.apply('userA', raw);
    // 1 starter card for batch leaf 'Leaf' + 1 proposed prompt on existing 'Stacks'
    expect(res.promptsCreated).toBe(2);
    expect(tx.prompt.create).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
yarn workspace @terrain/api test import.service
```

Expected: the 2 preview tests fail (received object lacks `topicTitle`/`promptText`), the apply test fails (`promptsCreated` is `undefined`).

- [ ] **Step 4: Implement in `import.service.ts`**

(a) `ResolvedCardReview` (~line 42) — add after `topicId`:

```ts
  /** Display-only enrichment for the web preview (null on a resolution miss). */
  topicTitle: string | null;
  promptText: string | null;
```

(b) `ImportResult` (~line 132) — add after `topicsCreated`:

```ts
  promptsCreated: number;
```

(c) `buildPlan` — right after the `byNorm` map is built (~line 432), add:

```ts
    const titleById = new Map(existing.map((t) => [t.id, t.title] as const));
```

In the card branch (~line 495), the miss return becomes:

```ts
          return {
            kind: 'card',
            promptId: r.promptId,
            topicId: null,
            topicTitle: null,
            promptText: null,
            grade: r.grade,
            note: r.note,
          };
```

and the hit return (~line 514) becomes:

```ts
        return {
          kind: 'card',
          promptId: r.promptId,
          topicId: row.topicId,
          topicTitle: titleById.get(row.topicId) ?? null,
          promptText: row.promptText,
          grade: r.grade,
          note: r.note,
          cardPreview: {
            intervalBefore: daysBetween(before.lastReviewedAt, before.nextReviewAt),
            intervalAfter: daysBetween(now, after.nextReviewAt),
            nextReviewAt: after.nextReviewAt,
          },
        };
```

(d) `apply()` — declare `let promptsCreated = 0;` right before the starter-card loop (step c comment, ~line 303). Increment after each of the two `tx.prompt.create` calls:

Starter-card loop (~line 315):

```ts
        await tx.prompt.create({ data: { topicId, ...STARTER_CARD_DATA(nt.title) } });
        promptsCreated++;
```

Proposed-prompts loop (~line 322-333):

```ts
        await tx.prompt.create({
          data: {
            topicId,
            promptText: np.promptText,
            answerHint: np.answerHint,
            promptKind: np.promptKind,
            url: np.url,
            problemDifficulty: np.problemDifficulty,
            estimatedMinutes: np.estimatedMinutes,
          },
        });
        promptsCreated++;
```

Result object (~line 411):

```ts
      return {
        sessionExportId: sessionExport.id,
        reviewsApplied,
        topicsCreated,
        promptsCreated,
        noteSummariesApplied,
        nextSessionStored: nextFocusTitle != null,
      };
```

- [ ] **Step 5: Run the import suite, verify green**

```bash
yarn workspace @terrain/api test import.service
```

Expected: all pass, including the 3 new tests. (Existing tests use `toMatchObject`/`toEqual` on card reviews — the two `toEqual` card assertions, if any fail on the new fields, extend their expected objects with `topicTitle: 'Stacks', promptText: 'Explain Stacks'`; do NOT weaken assertions to `toMatchObject` silently — check what actually fails first. The evidence-review `toEqual` at spec line ~85 is unaffected.)

- [ ] **Step 6: Full API suite + gates**

```bash
yarn workspace @terrain/api test && yarn workspace @terrain/api build && yarn lint && yarn format:check
```

Expected: all green (173+3 tests), build exit 0.

- [ ] **Step 7: Snapshot + diff for review**

```bash
git add -A && git write-tree && git reset -q
```

---

### Task 3: Web — import types + preview sections v2 rewrite

**Files:**
- Modify: `apps/web/src/api/types.ts:213-272` (import-flow section)
- Modify: `apps/web/src/screens/Import/sections.tsx` (full rewrite of the reviews/badge/unresolved parts + new section)
- Modify: `apps/web/src/screens/Import/index.tsx` (render new section + new KPI)

**Interfaces:**
- Consumes: Task 2's backend shapes (`topicTitle`/`promptText` on card reviews, `promptsCreated` on result); `GRADES` (label+color per grade) exported from `../../components` (defined in `components/GradePicker.tsx`); existing `Grade` type in `api/types.ts:7`; `tint`, `Card`, `useToast` from components; `formatDate` from `../../lib/format`.
- Produces: `ProposedCardsSection` export from `sections.tsx`, consumed by `index.tsx`.

- [ ] **Step 1: Snapshot the tree** (`git add -A && git write-tree && git reset -q`)

- [ ] **Step 2: Replace the import-flow types in `apps/web/src/api/types.ts`**

Replace everything from the `// ---- Import flow ...` comment (line 213) through the end of `ImportResult` (line 272) with:

```ts
// ---- Import flow (POST /sessions/import/preview and /sessions/import) ----
// Mirrors apps/api/src/import/import.service.ts plan shapes (v2 contract).

export interface CardPreview {
  intervalBefore: number;
  intervalAfter: number;
  nextReviewAt: string | null; // ISO over JSON
}

export interface ResolvedCardReview {
  kind: 'card';
  promptId: string;
  topicId: string | null;
  topicTitle: string | null;
  promptText: string | null;
  grade: Grade;
  note?: string;
  cardPreview?: CardPreview;
}

export interface ResolvedEvidenceReview {
  kind: 'evidence';
  topicTitle: string;
  resolvedTopicId: string | null;
  grade: Grade;
  note?: string;
}

export type ResolvedReview = ResolvedCardReview | ResolvedEvidenceReview;

export interface NewTopicPlan {
  title: string;
  topicType: string;
  domain: string;
  description?: string;
  prerequisiteTitles: string[];
  parentTitle: string | null;
  aiContext?: string;
  alreadyExists: boolean;
}

export interface NewPromptPlan {
  topicTitle: string;
  promptText: string;
  answerHint?: string;
  promptKind: 'concept' | 'code' | 'problem';
  url?: string;
  problemDifficulty?: 'easy' | 'medium' | 'hard';
  estimatedMinutes?: number;
}

export interface NoteSummaryPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  composedSummary: string;
  suggestedNoteRef?: string;
}

export interface Unresolved {
  kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent' | 'prompt';
  /** Topic title — absent only for card-review promptId misses (see ref). */
  title?: string;
  /** The unresolvable promptId — set only for kind 'prompt' card-review misses. */
  ref?: string;
  context: string;
  reason: 'missing' | 'ambiguous' | 'self-reference';
}

export interface ImportPlan {
  sessionExportId: string;
  alreadyImported: boolean;
  reviews: ResolvedReview[];
  newTopics: NewTopicPlan[];
  newPrompts: NewPromptPlan[];
  noteSummaries: NoteSummaryPlan[];
  nextSession?: { focusTitle?: string | null; coldChallenge?: string | null } | null;
  unresolved: Unresolved[];
  applicable: boolean;
}

export interface ImportResult {
  sessionExportId: string;
  reviewsApplied: number;
  topicsCreated: string[];
  promptsCreated: number;
  noteSummariesApplied: number;
  nextSessionStored: boolean;
}
```

(`Grade` is already declared at the top of the file — no new import needed.)

- [ ] **Step 3: Rewrite `sections.tsx` — badge, reviews, proposed cards, unresolved**

(a) Replace the imports and the whole `IMPORT_QUALITY`/`QualityBadge` block (lines 1-36) with:

```tsx
import type { ReactNode } from 'react';
import { Card, GRADES, tint, useToast } from '../../components';
import { formatDate } from '../../lib/format';
import type {
  Grade,
  ImportPlan,
  NewPromptPlan,
  NewTopicPlan,
  NoteSummaryPlan,
  ResolvedReview,
  Unresolved,
} from '../../api/types';

/** Grade chip in the app's GradePicker colors (again/hard/good/easy). */
function GradeBadge({ grade }: { grade: Grade }) {
  const meta = GRADES.find((g) => g.grade === grade);
  const color = meta?.color ?? 'var(--text-muted)';
  return (
    <span
      className="badge mono"
      style={{ color, background: tint(color, 14), borderColor: color }}
    >
      {meta?.label ?? grade}
    </span>
  );
}
```

(b) Replace `ReviewRow` and `ReviewsSection` (old lines 69-121) with:

```tsx
// ---- a) Reviews ----

function ReviewRow({ r }: { r: ResolvedReview }) {
  // Card reviews resolve by promptId: topicId null means the id didn't
  // resolve (a matching Unresolved entry blocks apply). Evidence reviews
  // with resolvedTopicId null are NOT flagged here — that's either an
  // in-batch topic (fine) or covered by the Unresolved panel.
  const unresolved = r.kind === 'card' && r.topicId === null;
  const title =
    r.kind === 'card' ? (r.topicTitle ?? `prompt ${r.promptId}`) : r.topicTitle;
  return (
    <div
      className="list-row row wrap gap-2"
      style={
        unresolved
          ? { borderLeft: '3px solid var(--st-blocked)', background: tint('var(--st-blocked)', 8) }
          : undefined
      }
    >
      <span className="grow" style={{ fontWeight: 600 }}>
        {title}
      </span>
      {r.kind === 'evidence' && (
        <span className="pill" style={{ fontSize: 12 }} title="Logged against the topic; nothing is scheduled">
          evidence
        </span>
      )}
      <GradeBadge grade={r.grade} />
      {r.kind === 'card' && r.cardPreview && (
        <span className="sr-preview mono">
          interval {r.cardPreview.intervalBefore}d → {r.cardPreview.intervalAfter}d
          {r.cardPreview.nextReviewAt ? ` · next ${formatDate(r.cardPreview.nextReviewAt)}` : ''}
        </span>
      )}
      {unresolved && (
        <span className="badge" style={{ color: 'var(--st-blocked)' }}>
          unresolved
        </span>
      )}
      {r.kind === 'card' && r.promptText && (
        <div className="muted" style={{ flexBasis: '100%', fontSize: 13 }}>
          {r.promptText}
        </div>
      )}
      {r.note && (
        <div className="muted" style={{ flexBasis: '100%', fontSize: 13 }}>
          {r.note}
        </div>
      )}
    </div>
  );
}

export function ReviewsSection({ reviews }: { reviews: ResolvedReview[] }) {
  return (
    <SectionShell title="Reviews" count={reviews.length}>
      {reviews.length === 0 ? (
        <div className="muted">No reviews in this session.</div>
      ) : (
        <div className="col gap-2">
          {reviews.map((r, i) => (
            <ReviewRow key={r.kind === 'card' ? r.promptId + i : `${r.topicTitle}-${i}`} r={r} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}
```

(c) Add a new section after `NewTopicsSection` (keep `NewTopicRow`/`NewTopicsSection` as-is):

```tsx
// ---- b2) Proposed cards ----

function ProposedCardRow({ p }: { p: NewPromptPlan }) {
  return (
    <div className="list-row col gap-1">
      <div className="row wrap gap-2">
        <span className="grow" style={{ fontWeight: 600 }}>
          {p.topicTitle}
        </span>
        <Chip>{p.promptKind}</Chip>
        {p.problemDifficulty && <Chip>{p.problemDifficulty}</Chip>}
        {p.estimatedMinutes != null && <Chip>~{p.estimatedMinutes}m</Chip>}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        {p.promptText}
      </div>
      {p.url && (
        <div className="faint mono" style={{ fontSize: 12 }}>
          {p.url}
        </div>
      )}
    </div>
  );
}

export function ProposedCardsSection({ prompts }: { prompts: NewPromptPlan[] }) {
  return (
    <SectionShell title="Proposed cards" count={prompts.length}>
      {prompts.length === 0 ? (
        <div className="muted">No new cards proposed.</div>
      ) : (
        <div className="col gap-2">
          {prompts.map((p, i) => (
            <ProposedCardRow key={`${p.topicTitle}-${i}`} p={p} />
          ))}
        </div>
      )}
    </SectionShell>
  );
}
```

(d) In `UnresolvedPanel`, replace the title span and row key to handle ref-only entries:

```tsx
        {items.map((u, i) => (
          <div
            key={`${u.kind}-${u.title ?? u.ref}-${i}`}
            className="list-row col gap-1"
            style={{ borderLeft: '3px solid var(--st-blocked)' }}
          >
            <div className="row wrap gap-2">
              <span className="badge">{u.kind}</span>
              <span className={'grow' + (u.title ? '' : ' mono')} style={{ fontWeight: 600 }}>
                {u.title ?? `prompt ${u.ref}`}
              </span>
              <span className="badge" style={{ color: 'var(--st-blocked)' }}>
                {u.reason}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {u.context}
            </div>
          </div>
        ))}
```

Also update the closing hint line in the same panel to cover promptId misses:

```tsx
        <div style={{ fontWeight: 600, marginTop: 4 }}>
          Resolve these before importing — fix titles in your paste and Preview again (a missing
          prompt id usually means the card was deleted or belongs to another account).
        </div>
```

- [ ] **Step 4: Wire into `Import/index.tsx`**

(a) Extend the sections import (lines 5-11):

```tsx
import {
  NewTopicsSection,
  NextSessionSection,
  NoteSummariesSection,
  ProposedCardsSection,
  ReviewsSection,
  UnresolvedPanel,
} from './sections';
```

(b) Render it in the diff stack (after `NewTopicsSection`, line 86):

```tsx
          <ReviewsSection reviews={plan.reviews} />
          <NewTopicsSection topics={plan.newTopics} />
          <ProposedCardsSection prompts={plan.newPrompts} />
          <NoteSummariesSection notes={plan.noteSummaries} />
          <NextSessionSection next={plan.nextSession} />
```

(c) Add the new-cards KPI to the apply-result strip (after the "new topics" KPI, line 141):

```tsx
            <div className="kpi">
              <div>{applyResult.promptsCreated}</div>
              <div className="kpi-label">new cards</div>
            </div>
```

- [ ] **Step 5: Build + lint gate**

```bash
yarn workspace @terrain/web build && yarn lint && yarn format:check
```

Expected: `tsc --noEmit` + vite build exit 0 (the type rewrite will surface any missed consumer — fix by aligning with the new types, not by widening them), 0 lint findings.

- [ ] **Step 6: Run web unit tests (projection suite must stay green)**

```bash
yarn workspace @terrain/web test
```

Expected: 8/8 pass (untouched, but guards against accidental projection edits).

- [ ] **Step 7: Snapshot + diff for review** (`git add -A && git write-tree && git reset -q`)

---

### Task 4: Full gate + live CDP smoke (roadmap + import round-trip)

**Files:**
- Create: `<scratchpad>/smoke-roadmap-import.mjs` (throwaway; do NOT add to the repo)

**Interfaces:**
- Consumes: Task 1's `react-flow__node-chapter` class; Task 2/3's plan + result shapes; demo login; web dev proxy `/api` → :3000.

- [ ] **Step 1: Full monorepo gate**

```bash
yarn build && yarn test && yarn lint && yarn format:check
```

Expected: all workspaces build; api jest 176 (173+3), sr-engine 4, types 10, web vitest 8; lint/format clean.

- [ ] **Step 2: Fresh stack**

```bash
docker compose up -d
kill -9 $(lsof -ti:3000) 2>/dev/null; kill -9 $(lsof -ti:5180) 2>/dev/null
yarn workspace @terrain/api start &   # wait for "Nest application successfully started"
yarn workspace @terrain/web dev &     # :5180
```

- [ ] **Step 3: Write the CDP smoke script**

Follow `scripts/smoke.mjs`'s CDP pattern (Brave + `--remote-debugging-port`, CDP WebSocket, `Runtime.evaluate` with `.textContent` — never `.innerText`). Script outline (complete logic, adapt the CDP plumbing helpers from `scripts/smoke.mjs`):

```js
// 1. login: Runtime.evaluate on http://localhost:5180 —
//    await fetch('/api/auth/login', { method: 'POST',
//      headers: { 'Content-Type': 'application/json' },
//      body: JSON.stringify({ email: 'demo@terrain.local', password: 'demo-password' }),
//      credentials: 'include' })
// 2. ROADMAP: navigate to /roadmap, wait for .react-flow__node, assert:
//    - document.querySelectorAll('.react-flow__node-group').length === 0
//    - document.querySelectorAll('.react-flow__node-chapter').length > 0
//    - no console errors
// 3. IMPORT setup (same-origin fetches from the page):
//    - const exp = await (await fetch('/api/sessions/export?mode=full',
//        { credentials: 'include' })).json()   // GET; returns { id, exportMd }
//    - const topics = await (await fetch('/api/topics', { credentials: 'include' })).json()
//      pick a leaf topic id, then GET /api/topics/:id -> prompts[0].id  // real promptId
// 4. Build the paste text in JS:
//    '```learning-os\n' + JSON.stringify({
//      version: 2, sessionId: exp.id,
//      reviews: [
//        { promptId, grade: 'good' },                       // card review
//        { topicTitle: topics[0].title, grade: 'hard' },     // evidence review
//      ],
//      proposedTopics: [],
//      proposedPrompts: [{ topicTitle: topics[0].title, promptText: 'Smoke: what is X?',
//                          promptKind: 'concept' }],
//      noteSummaries: [],
//    }) + '\n```'
// 5. IMPORT UI: navigate to /import, set the textarea via native setter +
//    input event, click Preview, wait, then assert via .textContent:
//    - the card row shows the topic title AND the prompt text (not blank, no 'qundefined')
//    - a 'Good' grade badge and a 'Hard' grade badge exist
//    - an 'evidence' chip exists
//    - 'Proposed cards' section shows count 1 with 'Smoke: what is X?'
//    - no 'unresolved' text, Apply button enabled
// 6. Click 'Apply import', wait for the result card, assert the strip contains
//    'new cards' with value 1 and 'reviews applied' with value 2.
// 7. Exit non-zero on any failed assertion or console error.
```

- [ ] **Step 4: Run it**

```bash
node <scratchpad>/smoke-roadmap-import.mjs
```

Expected: all assertions pass, 0 console errors. (This mutates the demo account — one review pair + one card. Acceptable; the seed is idempotent and demo-only. Do NOT run against the real account.)

- [ ] **Step 5: Report + leave stack running**

Report assertion results. Leave docker/API/web up. Remind the user to re-check `/roadmap` with their real account; the screenshot's sparse view was the demo account's data, while the real account should show 18 chapter tiles, now single-framed.

---

## Self-Review Notes

- Spec coverage: §A → Task 1; §B → Task 2; §C → Task 3; Verification → Task 4. Out-of-scope items untouched by any task.
- Type consistency: `topicTitle`/`promptText`/`promptsCreated` names identical across Task 2 (backend), Task 3 (web mirror), Task 4 (smoke assertions). `'chapter'` used consistently in Task 1 and Task 4's DOM assertions.
- Repo policy: no `git commit` steps anywhere — tree snapshots only.
