# Daily Loop UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-03-next-up-card-cta-redesign-design.md`

**Goal:** Make the Dashboard teach and drive the daily ritual — a "Today" card (review first, learn second) with the AI-loop as the primary learn action, an awaiting-import breadcrumb so copied sessions can't silently drop, and a lighter Import return path.

**Architecture:** Two additive fields on the existing `GET /metrics/dashboard` payload (`sessionQueueMinutes`, `pendingSessions`) computed in `MetricsService`; a new `TodayCard` web component replacing `NextUpCard` and absorbing the review-buttons row; small edits to the Import screen. No schema changes, no new endpoints, no contract changes.

**Tech Stack:** NestJS 11 + Prisma 7 (jest) in `apps/api`; React 19 + TanStack Router/Query (vitest, tsc) in `apps/web`.

## Global Constraints

- **No git commits.** Repo convention (CLAUDE.md): work stays uncommitted in the working tree. Every "commit" a normal plan would have is replaced by a verification step.
- Formatting is oxfmt (single quotes, trailing commas); lint is oxlint. Run `yarn lint` and `yarn format` from the repo root after touching code.
- `apps/api` + `packages/*` are CommonJS with extensionless imports; `apps/web` is ESM.
- Copy strings must match the spec verbatim: `▶ Start learning`, `Studied elsewhere`, `▶ Review all (N)`, `⧉ Copy repetition context`, `Today`, `Open Import`, `Copy again`, `Paste results`, `Back to Dashboard`.
- Breadcrumb window is **48 hours**; only the **latest** `SessionExport` per mode (`repeat`, `learn`) is considered.
- Web has no component-test infra — do not add react-testing-library. Web component changes are verified by `yarn workspace @terrain/web build` (tsc gate) + the Task 7 smoke.

---

### Task 1: API — session queue minutes + `sessionQueueMinutes` on the dashboard

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts` (sessionQueue ~line 147, dashboard ~line 267)
- Test: `apps/api/src/metrics/metrics.service.spec.ts`

**Interfaces:**
- Consumes: `estimateMinutes(cards: { promptKind: string; estimatedMinutes: number | null }[]): number` from `apps/api/src/telegram/telegram.messages.ts` (kind fallbacks: concept 2, code 10, problem 30).
- Produces: `sessionQueue()` now returns `{ items: SessionQueueItem[]; estimatedMinutes: number }`; `dashboard()` payload gains `sessionQueueMinutes: number`. (Additive — existing callers `export-generator.service.ts:103` destructures `{ items }`, `reviews.controller.ts:24` returns the whole object; both keep working.)

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/metrics/metrics.service.spec.ts`, add inside the existing `describe('sessionQueue', …)` block:

```ts
it('returns estimatedMinutes from explicit values with kind fallbacks', async () => {
  prisma.prompt.findMany
    .mockResolvedValueOnce([
      {
        id: 'p1',
        promptKind: 'concept',
        estimatedMinutes: null,
        state: 'review',
        nextReviewAt: new Date('2026-07-03T09:00:00'),
        createdAt: new Date('2026-01-01'),
        topic: { id: 't1', title: 'T1', domain: 'DSA', parent: null },
      },
    ])
    .mockResolvedValueOnce([
      {
        id: 'p2',
        promptKind: 'code',
        estimatedMinutes: 5,
        state: 'new',
        nextReviewAt: null,
        createdAt: new Date('2026-01-02'),
        topic: { id: 't2', title: 'T2', domain: 'DSA', parent: null },
      },
    ]);
  const result = await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'));
  // concept fallback (2) + explicit estimate (5)
  expect(result.estimatedMinutes).toBe(7);
});
```

And next to the existing `'dashboard includes sessionQueueCount'` test:

```ts
it('dashboard includes sessionQueueMinutes', async () => {
  // beforeEach stubs every findMany to [] — empty queue estimates 0 minutes.
  const dash = await service.dashboard('u1', new Date('2026-07-03T10:00:00'));
  expect(dash.sessionQueueMinutes).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: the two new tests FAIL (`estimatedMinutes`/`sessionQueueMinutes` are `undefined`); everything else passes.

- [ ] **Step 3: Implement**

In `apps/api/src/metrics/metrics.service.ts`, add to the imports at the top:

```ts
import { estimateMinutes } from '../telegram/telegram.messages';
```

Change `sessionQueue`'s signature and tail. The signature line becomes:

```ts
  async sessionQueue(
    userId: string,
    now: Date,
    domain?: string,
  ): Promise<{ items: SessionQueueItem[]; estimatedMinutes: number }> {
```

and the existing tail

```ts
    const items = [...due, ...fresh].map(
      (p): SessionQueueItem => ({
        // …unchanged mapping…
      }),
    );
    return { items: interleaveQueue(items) };
```

becomes (mapping body unchanged):

```ts
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
```

In `dashboard()`, change the return's `sessionQueueCount` line to:

```ts
      sessionQueueCount: sessionQueue.items.length,
      sessionQueueMinutes: sessionQueue.estimatedMinutes,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test`
Expected: full API suite PASSES (including sessions/export-generator tests — the callers are unaffected).

- [ ] **Step 5: Lint/format check**

Run: `yarn lint && yarn format`
Expected: no errors; format rewrites at most the files you touched.

---

### Task 2: API — `pendingSessions` on the dashboard

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts` (dashboard + new private method)
- Test: `apps/api/src/metrics/metrics.service.spec.ts` (also its `beforeEach` prisma mock)

**Interfaces:**
- Consumes: `prisma.sessionExport.findFirst` (model fields: `id`, `mode` (`ExportMode`: full|domain|repeat|learn), `generatedAt`, `importedAt`).
- Produces: dashboard payload gains `pendingSessions: { id: string; mode: 'repeat' | 'learn'; generatedAt: Date }[]` (ISO string over JSON).

- [ ] **Step 1: Extend the prisma mock**

In the spec's `beforeEach`, add to the `prisma` object:

```ts
      sessionExport: { findFirst: jest.fn().mockResolvedValue(null) },
```

- [ ] **Step 2: Write the failing tests**

Add a new describe block:

```ts
describe('pendingSessions (via dashboard)', () => {
  const now = new Date('2026-07-03T10:00:00Z');

  it('reports the latest un-imported repeat/learn export within 48h', async () => {
    prisma.sessionExport.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.mode === 'learn'
          ? {
              id: 'se2',
              mode: 'learn',
              generatedAt: new Date('2026-07-03T08:00:00Z'),
              importedAt: null,
            }
          : {
              id: 'se1',
              mode: 'repeat',
              generatedAt: new Date('2026-07-02T09:00:00Z'),
              importedAt: new Date('2026-07-02T10:00:00Z'),
            },
      ),
    );
    const dash = await service.dashboard('u1', now);
    // repeat's latest was imported → excluded; learn is pending → included
    expect(dash.pendingSessions).toEqual([
      { id: 'se2', mode: 'learn', generatedAt: new Date('2026-07-03T08:00:00Z') },
    ]);
  });

  it('ignores un-imported exports older than 48h', async () => {
    prisma.sessionExport.findFirst.mockResolvedValue({
      id: 'old',
      mode: 'learn',
      generatedAt: new Date('2026-06-30T08:00:00Z'),
      importedAt: null,
    });
    const dash = await service.dashboard('u1', now);
    expect(dash.pendingSessions).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `yarn workspace @terrain/api test metrics.service`
Expected: both new tests FAIL (`pendingSessions` undefined); rest passes.

- [ ] **Step 4: Implement**

Add a private method to `MetricsService` (near `nextUp`):

```ts
  /**
   * Latest repeat/learn export per mode that hasn't come back through Import,
   * within 48h — the Dashboard's "session in flight" breadcrumb. Only the
   * newest row per mode counts, so repeated copies don't stack entries.
   */
  private async pendingSessions(
    userId: string,
    now: Date,
  ): Promise<{ id: string; mode: 'repeat' | 'learn'; generatedAt: Date }[]> {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const modes = ['repeat', 'learn'] as const;
    const latest = await Promise.all(
      modes.map((mode) =>
        this.prisma.sessionExport.findFirst({
          where: { userId, mode },
          orderBy: { generatedAt: 'desc' },
          select: { id: true, mode: true, generatedAt: true, importedAt: true },
        }),
      ),
    );
    return latest.flatMap((row) =>
      row && row.importedAt === null && row.generatedAt >= cutoff
        ? [{ id: row.id, mode: row.mode as 'repeat' | 'learn', generatedAt: row.generatedAt }]
        : [],
    );
  }
```

In `dashboard()`, add the call to the `Promise.all` and the field to the return:

```ts
    const [struggleRatio7d, due, grouped, newCards, nextUp, sessionQueue, pendingSessions] =
      await Promise.all([
        this.struggleRatio7d(userId, now),
        this.dueTopics(userId, now, domain),
        this.prisma.topic.groupBy({
          by: ['status'],
          _count: true,
          where: { userId, ...(domain ? { domain } : {}) },
        }),
        this.newCardsCount(userId, domain),
        this.nextUp(userId, domain),
        this.sessionQueue(userId, now, domain),
        this.pendingSessions(userId, now),
      ]);
```

and in the returned object (next to `nextUp`):

```ts
      pendingSessions,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @terrain/api test`
Expected: full API suite PASSES.

- [ ] **Step 6: Lint/format check**

Run: `yarn lint && yarn format`

---

### Task 3: Web plumbing — types, export-hook invalidation, `timeAgo`

**Files:**
- Modify: `apps/web/src/api/types.ts` (Dashboard interface, ~line 212)
- Modify: `apps/web/src/api/hooks.ts` (`useGenerateExport`)
- Modify: `apps/web/src/lib/format.ts`
- Test: `apps/web/src/lib/format.test.ts` (create)

**Interfaces:**
- Produces: `PendingSession` type; `Dashboard.sessionQueueMinutes: number` and `Dashboard.pendingSessions: PendingSession[]`; `timeAgo(iso: string): string` (`just now` / `Nm ago` / `Nh ago` / `Nd ago`); `useGenerateExport` invalidates the `['dashboard']` query on success (so the breadcrumb appears right after a copy).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/format.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from './format';

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('formats minutes, hours, and days since the timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
    expect(timeAgo('2026-07-03T11:59:40Z')).toBe('just now');
    expect(timeAgo('2026-07-03T11:15:00Z')).toBe('45m ago');
    expect(timeAgo('2026-07-03T09:00:00Z')).toBe('3h ago');
    expect(timeAgo('2026-07-01T09:00:00Z')).toBe('2d ago');
  });

  it('is defensive about garbage and future timestamps', () => {
    expect(timeAgo('not-a-date')).toBe('just now');
    expect(timeAgo(new Date(Date.now() + 60_000).toISOString())).toBe('just now');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @terrain/web test`
Expected: FAIL — `timeAgo` is not exported.

- [ ] **Step 3: Implement `timeAgo`**

Append to `apps/web/src/lib/format.ts`:

```ts
/** Compact relative "how long ago" label for a past ISO timestamp. */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 60_000) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @terrain/web test`
Expected: PASS (whole vitest suite).

- [ ] **Step 5: Add the dashboard types**

In `apps/web/src/api/types.ts`, above the `Dashboard` interface add:

```ts
export interface PendingSession {
  id: string;
  mode: 'repeat' | 'learn';
  generatedAt: string; // ISO over JSON
}
```

and inside `Dashboard`, after `sessionQueueCount: number;`:

```ts
  sessionQueueMinutes: number;
  pendingSessions: PendingSession[];
```

- [ ] **Step 6: Invalidate the dashboard on export generation**

In `apps/web/src/api/hooks.ts`, replace `useGenerateExport` with (file already imports `useQueryClient`):

```ts
export function useGenerateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { mode?: string; focusTopicId?: string }) => api.getExport(opts),
    // A new SessionExport row may change the dashboard's pendingSessions.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  });
}
```

- [ ] **Step 7: Verify types compile**

Run: `yarn workspace @terrain/web build`
Expected: PASS (tsc + vite build).

- [ ] **Step 8: Lint/format check**

Run: `yarn lint && yarn format`

---

### Task 4: Web — `TodayCard` component

**Files:**
- Create: `apps/web/src/screens/Dashboard/TodayCard.tsx`

**Interfaces:**
- Consumes: `Dashboard` / `NextUp` / `Topic` types from Task 3, `timeAgo`, `Card` from `../../components`, `Link` from `@tanstack/react-router` (routes `/import` exists in `app/router.tsx`).
- Produces: `default export TodayCard(props)` with props `{ dash: Dashboard; onOpenSession: () => void; starting: boolean; onActivate: (topic: Topic) => void; copying: boolean; onCopyRepeat: () => void; onCopyLearn: () => Promise<boolean> }`. Task 5 wires it into `Dashboard/index.tsx`.

- [ ] **Step 1: Create the component**

Create `apps/web/src/screens/Dashboard/TodayCard.tsx` with exactly:

```tsx
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { Dashboard, NextUp, Topic } from '../../api/types';
import { Card } from '../../components';
import { timeAgo } from '../../lib/format';

/**
 * The daily-ritual surface: step 1 clear today's review queue, step 2 learn
 * the next topic (server-picked, curriculum order), plus a breadcrumb for any
 * copied session context that hasn't come back through Import yet. Step 2's
 * primary action is the AI loop (copy context → Claude → Import); manual
 * activation stays as a demoted escape hatch for topics studied elsewhere.
 */
export default function TodayCard({
  dash,
  onOpenSession,
  starting,
  onActivate,
  copying,
  onCopyRepeat,
  onCopyLearn,
}: {
  dash: Dashboard;
  onOpenSession: () => void;
  starting: boolean;
  onActivate: (topic: Topic) => void;
  copying: boolean;
  onCopyRepeat: () => void;
  onCopyLearn: () => Promise<boolean>;
}) {
  const [learnCopied, setLearnCopied] = useState(false);
  const { nextUp, counts, sessionQueueCount, sessionQueueMinutes } = dash;
  const showLearn = !!nextUp || counts.planned > 0;
  // The post-copy strip already says "bring it to Import" — don't say it twice.
  const pending = dash.pendingSessions.filter((s) => !(learnCopied && s.mode === 'learn'));

  async function startLearning() {
    if (await onCopyLearn()) setLearnCopied(true);
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <Card title="Today">
        <div className="col gap-4">
          <StepRow n={1} label="Review">
            {sessionQueueCount === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Nothing due today — all clear.
              </p>
            ) : (
              <div className="col gap-2">
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {sessionQueueCount} cards
                  {sessionQueueMinutes > 0 ? ` · ~${sessionQueueMinutes} min` : ''}
                </div>
                <div className="row gap-2">
                  <button className="btn btn-primary" onClick={onOpenSession}>
                    ▶ Review all ({sessionQueueCount})
                  </button>
                  <button className="btn" disabled={copying} onClick={onCopyRepeat}>
                    {copying ? 'Generating…' : '⧉ Copy repetition context'}
                  </button>
                </div>
              </div>
            )}
          </StepRow>

          {showLearn && (
            <StepRow n={2} label="Learn">
              {!nextUp ? (
                <p className="muted" style={{ margin: 0 }}>
                  All remaining topics are blocked — keep reviewing to unlock them.
                </p>
              ) : (
                <LearnStep
                  nextUp={nextUp}
                  starting={starting}
                  onActivate={onActivate}
                  copying={copying}
                  copied={learnCopied}
                  onStartLearning={startLearning}
                />
              )}
            </StepRow>
          )}

          {pending.length > 0 && (
            <div className="col gap-2">
              {pending.map((s) => (
                <div
                  key={s.id}
                  className="row gap-2"
                  style={{ alignItems: 'center', fontSize: 12.5 }}
                >
                  <span className="muted">
                    ⏳ {s.mode === 'learn' ? 'Learning' : 'Repetition'} context copied{' '}
                    {timeAgo(s.generatedAt)} — session not imported yet
                  </span>
                  <Link to="/import" className="btn btn-sm">
                    Paste results
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function StepRow({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <div className="col gap-2">
      <div
        className="row gap-2"
        style={{
          alignItems: 'center',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        <span className="pill">{n}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function LearnStep({
  nextUp: { topic, chapterTitle, chapterProgress },
  starting,
  onActivate,
  copying,
  copied,
  onStartLearning,
}: {
  nextUp: NextUp;
  starting: boolean;
  onActivate: (topic: Topic) => void;
  copying: boolean;
  copied: boolean;
  onStartLearning: () => void;
}) {
  const snippet =
    topic.description && topic.description.length > 220
      ? `${topic.description.slice(0, 220)}…`
      : topic.description;
  return (
    <div className="col gap-2">
      {chapterTitle && (
        <div className="faint" style={{ fontSize: 12.5 }}>
          {chapterTitle}
          {chapterProgress && ` · ${chapterProgress.started} of ${chapterProgress.total} started`}
        </div>
      )}
      <div className="row gap-2" style={{ alignItems: 'center' }}>
        <span style={{ fontWeight: 650, fontSize: 16 }}>{topic.title}</span>
        <span className="pill">{topic.topicType}</span>
        {topic.aiProposed && (
          <span title="Imported from Claude" style={{ color: 'var(--st-active)' }}>
            ✦
          </span>
        )}
      </div>
      {snippet && (
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
          {snippet}
        </p>
      )}
      {copied ? (
        <div className="col gap-2">
          <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            Copied ✓ — paste into a fresh Claude chat and have the session. When you&apos;re done,
            bring the <span className="mono">learning-os</span> block back to Import.
          </p>
          <div className="row gap-2">
            <Link to="/import" className="btn btn-primary btn-sm">
              Open Import
            </Link>
            <button className="btn btn-ghost btn-sm" disabled={copying} onClick={onStartLearning}>
              {copying ? 'Generating…' : 'Copy again'}
            </button>
          </div>
        </div>
      ) : (
        <div className="row gap-2">
          <button className="btn btn-primary" disabled={copying} onClick={onStartLearning}>
            {copying ? 'Generating…' : '▶ Start learning'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={starting}
            title="Skip the AI session — activate this topic and log a first self-graded review"
            onClick={() => onActivate(topic)}
          >
            {starting ? 'Activating…' : 'Studied elsewhere'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `yarn workspace @terrain/web build`
Expected: PASS (the component is not yet imported anywhere; tsc still type-checks it).

- [ ] **Step 3: Lint/format check**

Run: `yarn lint && yarn format`

---

### Task 5: Web — rewire the Dashboard, delete `NextUpCard`

**Files:**
- Modify: `apps/web/src/screens/Dashboard/index.tsx`
- Delete: `apps/web/src/screens/Dashboard/NextUpCard.tsx`

**Interfaces:**
- Consumes: `TodayCard` from Task 4 (props listed there); `useGenerateExport` (`mutateAsync`) from Task 3.
- Produces: new Dashboard layout order — Today card → KPI row → struggle/library → heatmap → due list. The old `NextUpCard` render and the standalone `▶ Review all` buttons row are gone.

- [ ] **Step 1: Rewire `Dashboard/index.tsx`**

1. Replace the import `import NextUpCard from './NextUpCard';` with `import TodayCard from './TodayCard';`.
2. Replace the `copyContext` function with an async version that reports success (the post-copy strip only shows when the clipboard write actually happened):

```tsx
  async function copyContext(args: { mode: string }, label: string): Promise<boolean> {
    let exportMd: string;
    try {
      ({ exportMd } = await exportCtx.mutateAsync(args));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'error');
      return false;
    }
    if (!navigator.clipboard?.writeText) {
      toast('Clipboard unavailable — use the Export screen to copy manually', 'info');
      return false;
    }
    try {
      await navigator.clipboard.writeText(exportMd);
      toast(`${label} copied — paste into a fresh Claude chat`, 'success');
      return true;
    } catch {
      toast('Could not copy — use the Export screen to copy manually', 'error');
      return false;
    }
  }
```

3. Delete the `{/* ---- next up ---- */}` block (the `<NextUpCard …/>` render).
4. Directly under `<p className="page-sub">{today}</p>`, add:

```tsx
      <TodayCard
        dash={dash}
        onOpenSession={() => setSessionOpen(true)}
        starting={starting}
        onActivate={startTopic}
        copying={exportCtx.isPending}
        onCopyRepeat={() => void copyContext({ mode: 'repeat' }, 'Repetition context')}
        onCopyLearn={() => copyContext({ mode: 'learn' }, 'Learning context')}
      />
```

5. Delete the standalone buttons row above the due list — the entire
   `{dash.sessionQueueCount > 0 && ( <div className="row gap-2" …> … </div> )}`
   block containing `▶ Review all` and `⧉ Copy repetition context` (both actions
   now live in the Today card). Keep the `Due for review` heading and groups.
6. Everything else (KPI row, struggle/library, heatmap, modals, `startTopic`,
   the Telegram `?session=1` deep-link effect) stays unchanged.

- [ ] **Step 2: Delete the old component**

Run: `rm apps/web/src/screens/Dashboard/NextUpCard.tsx`

- [ ] **Step 3: Verify build**

Run: `yarn workspace @terrain/web build`
Expected: PASS. If tsc reports an unused import (`Topic`/`TopicStatus`) in `index.tsx`, remove exactly that import specifier — `startTopic` still uses `Topic`, so only remove what tsc names.

- [ ] **Step 4: Lint/format check**

Run: `yarn lint && yarn format`

---

### Task 6: Web — Import auto-preview + loop re-arm

**Files:**
- Modify: `apps/web/src/screens/Import/index.tsx`

**Interfaces:**
- Consumes: existing `useImportPreview` / `useImportApply` hooks (`useImportApply` already invalidates the dashboard on success, which clears the breadcrumb); `Link` from `@tanstack/react-router` (route `/`).
- Produces: no exports change — behavior only.

- [ ] **Step 1: Implement auto-preview**

In `apps/web/src/screens/Import/index.tsx`:

1. Change the react import to `import { useCallback, useEffect, useRef, useState } from 'react';` and add `import { Link } from '@tanstack/react-router';`.
2. Replace the `onPreview` const with a deduped `runPreview` + debounced effect:

```tsx
  const lastPreviewed = useRef<string | null>(null);

  const runPreview = useCallback(
    (raw: string) => {
      lastPreviewed.current = raw;
      setApplyResult(null);
      importPreview.mutate(raw, {
        onSuccess: (p) => setPlan(p),
        onError: () => setPlan(null),
      });
    },
    [importPreview.mutate],
  );

  // Auto-preview: once the pasted text contains a learning-os block, the
  // deterministic read-only diff runs on its own; the button stays for
  // manual re-runs.
  useEffect(() => {
    if (!/```\s*learning-os/.test(text) || text === lastPreviewed.current) return;
    const t = setTimeout(() => runPreview(text), 600);
    return () => clearTimeout(t);
  }, [text, runPreview]);
```

3. Change the Preview button's `onClick={onPreview}` to `onClick={() => runPreview(text)}`.

- [ ] **Step 2: Add the loop re-arm footer**

In the `{applyResult && ( <Card …> … </Card> )}` block, wrap the existing
`<div className="stat-strip">…</div>` in a `<div className="col gap-3">` and add
below the strip (inside the wrapper):

```tsx
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                The loop is re-armed — the Dashboard reflects these changes.
              </span>
              <Link to="/" className="btn btn-primary btn-sm">
                Back to Dashboard
              </Link>
            </div>
```

- [ ] **Step 3: Verify build**

Run: `yarn workspace @terrain/web build`
Expected: PASS.

- [ ] **Step 4: Lint/format check**

Run: `yarn lint && yarn format`
Expected: clean. If oxlint's hooks rule objects to `importPreview.mutate` in the `useCallback` deps, change the deps to `[importPreview]` — react-query's `mutate` identity is stable either way.

---

### Task 7: Full gate + UI smoke

**Files:** none (verification only). Runbook: `docs/ops/local-dev.md`.

- [ ] **Step 1: Full gate**

Run from the repo root:

```bash
yarn build && yarn test && yarn lint && yarn format:check
```

Expected: all four PASS.

- [ ] **Step 2: Stack up**

```bash
docker compose up -d
yarn workspace @terrain/api start &      # API on :3000
yarn workspace @terrain/web dev &        # web on :5180
```

If :3000 is already held by a zombie, kill it first with `kill -9 $(lsof -ti:3000)` (per CLAUDE.md — `pkill -f "nest start"` does not work).

- [ ] **Step 3: Console-error sweep**

Run: `node scripts/smoke.mjs`
Expected: exit 0 (no console errors/page exceptions on `/`, `/topics`, `/roadmap`, `/export`, `/import`).

- [ ] **Step 4: Behavior smoke (CDP or manual)**

Verify against a logged-in session (CDP: use `.textContent`, not `.innerText`; grant clipboard with `Browser.grantPermissions` `['clipboardReadWrite']` if scripting the copy click):

1. Dashboard order is Today card → KPI row → struggle/library → heatmap → due list; the old buttons row above "Due for review" is gone.
2. Today card: step 1 shows `N cards · ~M min` + `▶ Review all (N)` + `⧉ Copy repetition context` (or "Nothing due today — all clear." when empty); step 2 shows the Next Up topic with primary `▶ Start learning` and ghost `Studied elsewhere`.
3. Click `▶ Start learning` → toast, buttons swap to the "Copied ✓ …" strip with `Open Import` + `Copy again`; no learn breadcrumb appears while the strip shows.
4. Reload the Dashboard → breadcrumb "⏳ Learning context copied just now — session not imported yet" with `Paste results` linking to `/import`.
5. `Studied elsewhere` still activates the topic and opens the grade modal (unchanged wiring).
6. Import screen: pasting text containing a ` ```learning-os ` fence auto-runs Preview after ~0.6s; after Apply, the result card shows "The loop is re-armed…" + `Back to Dashboard`; back on the Dashboard the breadcrumb is gone (import invalidated the query).

- [ ] **Step 5: Report**

Summarize gate + smoke results honestly (per repo convention, leave everything uncommitted).

---

## Self-review notes

- **Spec coverage:** Part 1 (CTAs + post-copy strip) → Tasks 4–5; Part 2 (Today card, minutes, reorder) → Tasks 1, 4, 5; Part 3 (pendingSessions, invalidation, breadcrumb, suppression-while-strip-shows) → Tasks 2, 3, 4; Part 4 (auto-preview, re-arm) → Task 6; spec Testing section → Tasks 1–3 tests + Task 7 gate/smoke.
- **Type consistency:** `sessionQueue → { items, estimatedMinutes }` (Task 1) is what Task 1's dashboard change reads; `PendingSession.generatedAt: string` on the web (Task 3) vs `Date` on the API (Task 2) is the standard ISO-over-JSON boundary this codebase already uses (`Dashboard.generatedAt`); `onCopyLearn: () => Promise<boolean>` (Task 4) matches `copyContext`'s new signature (Task 5).
- **Known-good conventions used:** `btn-ghost btn-sm` (ReviewSession Skip), `Card title=`, `row/col gap-*`, `pill`, `faint/muted`, TanStack `Link` with `className`.
