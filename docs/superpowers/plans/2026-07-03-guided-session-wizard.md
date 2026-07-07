# Guided Session Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-03-guided-session-wizard-design.md`

**Goal:** Replace the scattered Dashboard daily-loop surface with two single-"Start" tracks that each open a routed `/session/$mode` wizard walking copy→Claude→import, and remove every in-app grading surface.

**Architecture:** A new routed `SessionWizard` page (TanStack Router `/session/$mode`) built entirely on existing hooks (`useGenerateExport`, `useImportPreview`, `useImportApply`, `useDashboard`). A pure `initialStep` helper drives resume from `dash.pendingSessions`. `TodayCard` becomes two slim track cards; the in-app Review Session, due-list "Log" buttons, and the TopicDetailPanel grade form are deleted.

**Tech Stack:** React 19 + Vite + TanStack Router + react-query; vitest for pure logic; tsc (`yarn workspace @terrain/web build`) as the type gate. `apps/web` is ESM.

## Global Constraints

- **No git commits.** Repo convention (CLAUDE.md): work stays uncommitted in the working tree. Every "commit" is replaced by a **verification step**. Do not run `git commit`.
- **Web only.** No backend changes. `POST /reviews`, `GET /reviews/session-queue`, `GET /topics/:id/prompts/next` are left intact but become UI-orphaned (backend teardown is a deferred follow-up).
- **No new API surface.** The wizard reuses `useGenerateExport` / `useImportPreview` / `useImportApply` / `useDashboard`.
- **No component-test infra** (no react-testing-library). Component changes are verified by `yarn workspace @terrain/web build` (tsc) + the Task 7 smoke. Only pure logic gets a vitest test.
- Formatting is oxfmt (single quotes, trailing commas); lint is oxlint. Run `yarn lint` and `yarn format` from the repo root after touching code.
- **Copy strings (verbatim):** `Start review`, `Continue review`, `Start learning`, `Copy context`, `I've started the session`, `Copy context again`, `Preview`, `Save`, `Back to dashboard`.
- **Dependency (soft):** the wizard's Step-3 "problems solved" tally reads `applicationEvents` from the preview, which the **session-driven-learning** plan adds to the backend. This plan reads it defensively (`?.length ?? 0`), so it works whether or not that plan has landed — the line simply shows 0 (and is hidden) until it does.

---

### Task 1: `initialStep` resume helper (pure, unit-tested)

**Files:**
- Create: `apps/web/src/screens/Session/initialStep.ts`
- Test: `apps/web/src/screens/Session/initialStep.test.ts`

**Interfaces:**
- Produces: `initialStep(pending: PendingSession[], mode: string): 'copy' | 'paste'` — returns `'paste'` when a pending session for `mode` exists (the app already scopes `pendingSessions` to the un-imported, <48h, latest-per-mode set server-side), else `'copy'`. Consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/screens/Session/initialStep.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PendingSession } from '../../api/types';
import { initialStep } from './initialStep';

const pending = (mode: 'repeat' | 'learn'): PendingSession => ({
  id: `se-${mode}`,
  mode,
  generatedAt: '2026-07-03T09:00:00Z',
});

describe('initialStep', () => {
  it('resumes to paste when a pending session for this mode exists', () => {
    expect(initialStep([pending('repeat')], 'repeat')).toBe('paste');
  });

  it('starts at copy when there is no pending session', () => {
    expect(initialStep([], 'repeat')).toBe('copy');
  });

  it('ignores a pending session for the other mode', () => {
    expect(initialStep([pending('learn')], 'repeat')).toBe('copy');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace @terrain/web test initialStep`
Expected: FAIL — `initialStep` is not exported / module missing.

- [ ] **Step 3: Implement the helper**

Create `apps/web/src/screens/Session/initialStep.ts`:

```ts
import type { PendingSession } from '../../api/types';

/**
 * Which wizard step to open on entry. `pendingSessions` is already scoped
 * server-side to the un-imported, <48h, latest-per-mode set, so presence of a
 * matching mode means "a session is in flight" → resume at the paste step.
 */
export function initialStep(pending: PendingSession[], mode: string): 'copy' | 'paste' {
  return pending.some((s) => s.mode === mode) ? 'paste' : 'copy';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @terrain/web test initialStep`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify build + lint/format (no commit)**

Run: `yarn workspace @terrain/web build && yarn lint && yarn format`
Expected: build exit 0; lint/format clean. Uncommitted.

---

### Task 2: The `SessionWizard` page + route + preview mirror type

**Files:**
- Create: `apps/web/src/screens/Session/index.tsx`
- Modify: `apps/web/src/api/types.ts` (`ImportPlan` ~line 331; add `ApplicationEventPlan`)
- Modify: `apps/web/src/app/router.tsx`

**Interfaces:**
- Consumes: `initialStep` (Task 1); `useGenerateExport` / `useImportPreview` / `useImportApply` / `useDashboard` (existing, `api/hooks.ts`); `ImportPlan` / `ImportResult` / `ExportResult` types.
- Produces: `default export SessionWizard`; a `/session/$mode` route (`sessionRoute`) registered in the route tree. Consumed by Task 3/4 (navigation targets).

- [ ] **Step 1: Add the `applicationEvents` mirror to `ImportPlan`**

In `apps/web/src/api/types.ts`, add an interface just above `ImportPlan` (before line 331):

```ts
export interface ApplicationEventPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  kind: AppEventKind;
  description: string;
  url?: string;
}
```

And add this optional field inside `ImportPlan` (after the `activations: ActivationPlan[];` line):

```ts
  applicationEvents?: ApplicationEventPlan[];
```

(`AppEventKind` is already exported at the top of this file. Optional because the backend only sends it once the session-driven-learning plan lands.)

- [ ] **Step 2: Create the wizard component**

Create `apps/web/src/screens/Session/index.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { sessionRoute } from '../../app/router';
import { useDashboard, useGenerateExport, useImportApply, useImportPreview } from '../../api/hooks';
import { Card, ErrorBox, Loading, Spinner, useToast } from '../../components';
import type { ImportPlan, ImportResult } from '../../api/types';
import { initialStep } from './initialStep';

type Step = 'copy' | 'paste' | 'review' | 'done';

const FINALIZE_PROMPT =
  'Now output the final learning-os block per the OUTPUT CONTRACT from the context I gave ' +
  'you at the start — one fenced ```learning-os block, echoing the sessionId. Prose may ' +
  'surround it; only the last such block is read.';

async function copyToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function SessionWizard() {
  const { mode } = sessionRoute.useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: dash } = useDashboard();

  const gen = useGenerateExport();
  const preview = useImportPreview();
  const apply = useImportApply();

  const [step, setStep] = useState<Step>('copy');
  const [exportMd, setExportMd] = useState<string | null>(null);
  const [rawFallback, setRawFallback] = useState(false); // clipboard failed → show text
  const [pasted, setPasted] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const didInit = useRef(false);
  const lastPreviewed = useRef<string | null>(null);

  const isMode = mode === 'repeat' || mode === 'learn';

  // Initialise once the dashboard (pendingSessions) is available: resume to
  // paste if a session for this mode is in flight, else generate a fresh export.
  useEffect(() => {
    if (didInit.current || !dash || !isMode) return;
    didInit.current = true;
    const start = initialStep(dash.pendingSessions, mode);
    setStep(start);
    if (start === 'copy') {
      gen.mutate(
        { mode },
        {
          onSuccess: (r) => setExportMd(r.exportMd),
          onError: (e) => toast(e instanceof Error ? e.message : 'Could not build context', 'error'),
        },
      );
    }
  }, [dash, isMode, mode, gen, toast]);

  // Auto-preview once the pasted text contains a learning-os fence.
  useEffect(() => {
    if (step !== 'paste') return;
    if (!/```\s*learning-os/.test(pasted) || pasted === lastPreviewed.current) return;
    const t = setTimeout(() => runPreview(pasted), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted, step]);

  if (!isMode) {
    return <ErrorBox error={`Unknown session mode "${mode}"`} />;
  }

  const title = mode === 'repeat' ? 'Review session' : 'Learning session';

  function regenerate() {
    gen.mutate(
      { mode },
      {
        onSuccess: async (r) => {
          setExportMd(r.exportMd);
          const ok = await copyToClipboard(r.exportMd);
          setRawFallback(!ok);
          toast(ok ? 'Context copied — paste into a fresh Claude chat' : 'Copy the text below', ok ? 'success' : 'info');
        },
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not build context', 'error'),
      },
    );
  }

  async function copyContext() {
    if (!exportMd) return;
    const ok = await copyToClipboard(exportMd);
    setRawFallback(!ok);
    if (ok) {
      toast('Context copied — paste into a fresh Claude chat', 'success');
      setStep('paste');
    } else {
      toast('Clipboard unavailable — copy the text below manually', 'info');
    }
  }

  function runPreview(raw: string) {
    lastPreviewed.current = raw;
    preview.mutate(raw, {
      onSuccess: (p) => {
        setPlan(p);
        setStep('review');
      },
      onError: () => setPlan(null),
    });
  }

  function save() {
    apply.mutate(pasted, {
      onSuccess: (res) => {
        setResult(res);
        setStep('done');
      },
      onError: (e) => toast(e instanceof Error ? e.message : 'Save failed', 'error'),
    });
  }

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 className="page-title">{title}</h1>

      {step === 'copy' && (
        <Card>
          <div className="col gap-3">
            <p className="muted" style={{ margin: 0 }}>
              Copy this and paste it into a fresh Claude chat. Do the full session — Claude will
              quiz you, ask for an implementation, and have you solve problems. When you&apos;re done,
              come back and paste Claude&apos;s final message.
            </p>
            {gen.isPending && !exportMd ? (
              <Loading label="Building your context…" />
            ) : (
              <>
                <div className="row gap-2">
                  <button className="btn btn-primary" disabled={!exportMd} onClick={copyContext}>
                    Copy context
                  </button>
                  <button className="btn" onClick={() => setStep('paste')}>
                    I&apos;ve started the session
                  </button>
                </div>
                {rawFallback && exportMd && (
                  <textarea className="textarea mono" style={{ minHeight: 160 }} readOnly value={exportMd} />
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {step === 'paste' && (
        <Card>
          <div className="col gap-3">
            <p className="muted" style={{ margin: 0 }}>
              When Claude finishes, paste its final message here.
            </p>
            <textarea
              className="textarea mono"
              style={{ minHeight: 200 }}
              placeholder="Paste Claude's final response…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <button
                className="btn btn-primary"
                disabled={!pasted.trim() || preview.isPending}
                onClick={() => runPreview(pasted)}
              >
                {preview.isPending ? (
                  <span className="row gap-2">
                    <Spinner /> Preview
                  </span>
                ) : (
                  'Preview'
                )}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={regenerate}>
                Copy context again
              </button>
            </div>
            {preview.isError && (
              <span className="faint">
                No learning-os block found — did you paste Claude&apos;s final message? Use “Copy
                context again”, then ask Claude to output the block.
              </span>
            )}
            <div className="card card-pad col gap-2">
              <span className="faint" style={{ fontSize: 12 }}>
                Claude didn&apos;t output the learning-os block? Copy this and send it to Claude:
              </span>
              <div className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {FINALIZE_PROMPT}
              </div>
              <button
                className="btn btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={async () => {
                  const ok = await copyToClipboard(FINALIZE_PROMPT);
                  toast(ok ? 'Copied — send it to Claude' : 'Copy failed', ok ? 'success' : 'error');
                }}
              >
                Copy message
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 'review' && plan && (
        <Card title="Preview">
          <div className="col gap-3">
            <div className="stat-strip">
              <PreviewStat n={plan.reviews.length} label="reviews" />
              <PreviewStat n={plan.newTopics.filter((t) => !t.alreadyExists).length} label="new topics" />
              <PreviewStat n={plan.newPrompts.length} label="new cards" />
              <PreviewStat n={plan.applicationEvents?.length ?? 0} label="problems solved" hideWhenZero />
              <PreviewStat n={plan.activations.filter((a) => a.willActivate).length} label="topics activated" />
              <PreviewStat n={plan.noteSummaries.length} label="notes" hideWhenZero />
            </div>
            {plan.unresolved.length > 0 ? (
              <div className="col gap-1">
                <span className="faint">Resolve these before saving:</span>
                {plan.unresolved.map((u, i) => (
                  <span key={i} className="faint" style={{ fontSize: 12 }}>
                    • {u.context}: {u.title ?? u.ref} ({u.reason})
                  </span>
                ))}
              </div>
            ) : null}
            <div className="row gap-2">
              <button
                className="btn btn-primary"
                disabled={!plan.applicable || apply.isPending}
                onClick={save}
              >
                {apply.isPending ? (
                  <span className="row gap-2">
                    <Spinner /> Save
                  </span>
                ) : (
                  'Save'
                )}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('paste')}>
                Back
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 'done' && result && (
        <Card
          title={
            <span className="row gap-2" style={{ color: 'var(--st-mastered)' }}>
              ✓ Saved
            </span>
          }
          style={{ borderColor: 'var(--st-mastered)' }}
        >
          <div className="col gap-3">
            <div className="stat-strip">
              <PreviewStat n={result.reviewsApplied} label="reviews" />
              <PreviewStat n={result.topicsCreated.length} label="new topics" hideWhenZero />
              <PreviewStat n={result.promptsCreated} label="new cards" hideWhenZero />
              <PreviewStat n={result.topicsActivated} label="topics activated" hideWhenZero />
            </div>
            <div className="row gap-2">
              {mode === 'learn' && dash?.nextUp && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    // reset and start a fresh learn session for the new next-up topic
                    setResult(null);
                    setPlan(null);
                    setPasted('');
                    setExportMd(null);
                    didInit.current = false;
                    setStep('copy');
                  }}
                >
                  Learn next: {dash.nextUp.topic.title}
                </button>
              )}
              <button className="btn" onClick={() => navigate({ to: '/' })}>
                Back to dashboard
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function PreviewStat({ n, label, hideWhenZero }: { n: number; label: string; hideWhenZero?: boolean }) {
  if (hideWhenZero && n === 0) return null;
  return (
    <div className="kpi">
      <div>{n}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

In `apps/web/src/app/router.tsx`:

Add the import at the top (after the other screen imports):

```ts
import SessionWizard from '../screens/Session';
```

Add the route definition (after `settingsRoute`, before `routeTree`), and **export** it so the wizard can read its params:

```ts
export const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/session/$mode',
  component: SessionWizard,
});
```

Add it to the children array:

```ts
const routeTree = rootRoute.addChildren([
  indexRoute,
  topicsRoute,
  roadmapRoute,
  exportRoute,
  importRoute,
  settingsRoute,
  sessionRoute,
]);
```

- [ ] **Step 4: Verify build**

Run: `yarn workspace @terrain/web build`
Expected: PASS (tsc + vite build). The wizard type-checks against the real hooks and `ImportPlan`/`ImportResult`.

- [ ] **Step 5: Lint/format check (no commit)**

Run: `yarn lint && yarn format`
Expected: clean; only the three files rewritten. If oxlint objects to the `runPreview` deref in the auto-preview effect deps, keep the existing `eslint-disable` comment (matches the Import screen's pattern). Uncommitted.

---

### Task 3: Rewrite `TodayCard` to two track cards

**Files:**
- Modify (replace contents): `apps/web/src/screens/Dashboard/TodayCard.tsx`

**Interfaces:**
- Consumes: `Dashboard` type (`dash.nextUp`, `dash.sessionQueueCount`, `dash.sessionQueueMinutes`, `dash.pendingSessions`, `dash.counts`); `Link` from `@tanstack/react-router`.
- Produces: `default export TodayCard({ dash }: { dash: Dashboard })` — the new prop contract consumed by Task 4.

- [ ] **Step 1: Replace the component**

Replace the entire contents of `apps/web/src/screens/Dashboard/TodayCard.tsx` with:

```tsx
import { Link } from '@tanstack/react-router';
import type { Dashboard } from '../../api/types';
import { Card } from '../../components';

/**
 * The daily-ritual surface: two independent tracks — review what's due, and
 * learn the next topic — each a single "Start" that opens the routed
 * copy→Claude→import wizard (`/session/$mode`). An un-imported session in
 * flight flips that track's button to "Continue". The app never quizzes or
 * grades; it only hands off context and records the imported result.
 */
export default function TodayCard({ dash }: { dash: Dashboard }) {
  const { nextUp, counts, sessionQueueCount, sessionQueueMinutes, pendingSessions } = dash;
  const repeatPending = pendingSessions.some((s) => s.mode === 'repeat');
  const learnPending = pendingSessions.some((s) => s.mode === 'learn');
  const showLearn = !!nextUp || counts.planned > 0;

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
      {/* ---- review track ---- */}
      <Card title="Review">
        <div className="col gap-3">
          {sessionQueueCount === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing due today — all clear.
            </p>
          ) : (
            <>
              <div className="faint" style={{ fontSize: 12.5 }}>
                {sessionQueueCount} cards
                {sessionQueueMinutes > 0 ? ` · ~${sessionQueueMinutes} min` : ''}
              </div>
              <Link to="/session/$mode" params={{ mode: 'repeat' }} className="btn btn-primary">
                {repeatPending ? 'Continue review' : 'Start review'}
              </Link>
              {repeatPending && (
                <span className="faint" style={{ fontSize: 12 }}>
                  session in progress — not imported yet
                </span>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ---- learn track ---- */}
      <Card title="Learn">
        <div className="col gap-3">
          {!showLearn ? (
            <p className="muted" style={{ margin: 0 }}>
              Curriculum complete — nothing new to learn right now.
            </p>
          ) : !nextUp ? (
            <p className="muted" style={{ margin: 0 }}>
              All remaining topics are blocked — keep reviewing to unlock them.
            </p>
          ) : (
            <>
              {nextUp.chapterTitle && (
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {nextUp.chapterTitle}
                  {nextUp.chapterProgress &&
                    ` · ${nextUp.chapterProgress.started} of ${nextUp.chapterProgress.total} started`}
                </div>
              )}
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <span style={{ fontWeight: 650, fontSize: 16 }}>{nextUp.topic.title}</span>
                <span className="pill">{nextUp.topic.topicType}</span>
                {nextUp.topic.aiProposed && (
                  <span title="Imported from Claude" style={{ color: 'var(--st-active)' }}>
                    ✦
                  </span>
                )}
              </div>
              <Link to="/session/$mode" params={{ mode: 'learn' }} className="btn btn-primary">
                {learnPending ? 'Continue learning' : 'Start learning'}
              </Link>
              {learnPending && (
                <span className="faint" style={{ fontSize: 12 }}>
                  session in progress — not imported yet
                </span>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `yarn workspace @terrain/web build`
Expected: PASS. (Dashboard still passes the OLD props to `TodayCard` at this point — tsc will flag the mismatch in `Dashboard/index.tsx`; that's fixed in Task 4. If the build fails only with errors pointing at `Dashboard/index.tsx`'s `<TodayCard .../>` props, that is expected and resolved next task. If it fails inside `TodayCard.tsx` itself, fix that here.)

- [ ] **Step 3: Lint/format check (no commit)**

Run: `yarn lint && yarn format`
Expected: clean for `TodayCard.tsx`.

---

### Task 4: Rewire `Dashboard/index.tsx` (remove in-app review, wire tracks, deep-link)

**Files:**
- Modify: `apps/web/src/screens/Dashboard/index.tsx`

**Interfaces:**
- Consumes: `TodayCard` new prop `{ dash }` (Task 3); `useNavigate` from `@tanstack/react-router`.
- Produces: a Dashboard with no in-app grading surfaces; the Telegram `?session=1` deep-link now navigates to `/session/repeat`.

- [ ] **Step 1: Replace the imports + remove review state**

In `apps/web/src/screens/Dashboard/index.tsx`, replace the top imports block (lines 1-29) with:

```tsx
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useDashboard, useHeatmap, useSkipStreak, useStreak } from '../../api/hooks';
import type { Topic, TopicStatus } from '../../api/types';
import TodayCard from './TodayCard';
import {
  Card,
  EmptyState,
  ErrorBox,
  Gauge,
  Heatmap,
  Loading,
  STATUS_META,
  StatusBadge,
  tint,
  topicColor,
  useToast,
} from '../../components';
import { dueLabel } from '../../lib/format';
```

- [ ] **Step 2: Remove review state, `copyContext`, `startTopic`; repoint the deep-link**

In the `Dashboard` component body:

1. Delete the state/hooks that only served in-app review: remove the lines declaring `logTopic`/`setLogTopic`, `sessionOpen`/`setSessionOpen`, `updateTopic`/`starting` (the `useUpdateTopic()` destructure), and `exportCtx` (the `useGenerateExport()` call). Keep `dashboardQ`, `streakQ`, `heatmapQ`, `skip`, `toast`.
2. Delete the entire `copyContext` function (the `async function copyContext(...)` block).
3. Delete the entire `startTopic` function.
4. Add `const navigate = useNavigate();` near the top of the component body (after the `toast` line).
5. Replace the Telegram deep-link effect body so it navigates to the review wizard instead of opening a modal:

```tsx
  // Telegram digest deep link: /?session=1 opens the review wizard.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('session') !== '1') return;
    params.delete('session');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    navigate({ to: '/session/$mode', params: { mode: 'repeat' } });
  }, [navigate]);
```

- [ ] **Step 3: Swap the `TodayCard` render + read-only due list + drop modals**

1. Replace the `<TodayCard … />` render (lines ~116-124) with the new single-prop call:

```tsx
      <TodayCard dash={dash} />
```

2. In the `DueGroup` render call sites and the `DueGroup` function, remove the per-row action. Change the two `<DueGroup … onLog={setLogTopic} />` usages to drop the `onLog` prop:

```tsx
          {due.overdue.length > 0 && (
            <DueGroup label="Overdue" labelColor="var(--st-blocked)" topics={due.overdue} />
          )}
          {due.dueToday.length > 0 && <DueGroup label="Due today" topics={due.dueToday} />}
```

3. Delete both `<Modal …>` blocks at the bottom of the component (the `logTopic` review modal and the `sessionOpen` ReviewSession modal) — lines ~235-253.

- [ ] **Step 4: Simplify the `DueGroup` component to read-only**

Replace the `DueGroup` function (bottom of the file) with:

```tsx
function DueGroup({
  label,
  labelColor,
  topics,
}: {
  label: string;
  labelColor?: string;
  topics: Topic[];
}) {
  return (
    <div className="col gap-2">
      <div
        className="row"
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: labelColor ?? 'var(--text-muted)',
        }}
      >
        {label}
        <span className="pill" style={{ marginLeft: 8 }}>
          {topics.length}
        </span>
      </div>
      <Card pad={false}>
        {topics.map((t) => {
          const due = dueLabel(t.nextReviewAt);
          return (
            <div key={t.id} className="list-row" style={{ cursor: 'default' }}>
              <StatusBadge status={t.status} />
              <span className="grow" style={{ fontWeight: 550 }}>
                {t.title}
              </span>
              <span className="pill nowrap">{t.domain}</span>
              <span
                className="nowrap"
                style={{
                  fontSize: 12.5,
                  color: due.overdue ? 'var(--st-blocked)' : 'var(--text-muted)',
                  minWidth: 90,
                  textAlign: 'right',
                }}
              >
                {due.text}
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `yarn workspace @terrain/web build`
Expected: PASS. tsc will now still flag unresolved imports from `../../components` for `ReviewGate`/`LogReviewForm`/`Modal`/`ReviewSession` **only if** they're still referenced — they shouldn't be after this task. `ReviewSession.tsx` still exists on disk (deleted in Task 5) but is no longer imported here. If tsc reports an unused `Modal`/`ReviewGate`/`LogReviewForm` import you missed, remove it.

- [ ] **Step 6: Lint/format check (no commit)**

Run: `yarn lint && yarn format`
Expected: clean. Uncommitted.

---

### Task 5: The full cut — delete grading components, hooks, and the TopicDetailPanel form

**Files:**
- Modify: `apps/web/src/components/TopicDetailPanel.tsx` (remove the "Log a review" section ~lines 381-391 + unused imports)
- Modify: `apps/web/src/components/index.ts` (remove barrels)
- Modify: `apps/web/src/api/hooks.ts` (remove orphaned hooks)
- Delete: `apps/web/src/components/ReviewGate.tsx`
- Delete: `apps/web/src/components/LogReviewForm.tsx`
- Delete: `apps/web/src/screens/Dashboard/ReviewSession.tsx`
- Delete: `apps/web/src/screens/Dashboard/session.ts`
- Delete: `apps/web/src/screens/Dashboard/session.test.ts`

**Interfaces:**
- Produces: no in-app review/grade UI anywhere; `useNextPrompt`/`useLogReview`/`usePrompt` removed from `hooks.ts`.

- [ ] **Step 1: Remove the "Log a review" section from `TopicDetailPanel`**

In `apps/web/src/components/TopicDetailPanel.tsx`:

1. Delete the entire `{/* log a review */}` block (the final `<div className="card card-pad col gap-3">` containing `ReviewGate` + `LogReviewForm`, lines ~381-391).
2. Remove the now-unused imports at the top: delete the `import { LogReviewForm } from './LogReviewForm';` line and the `import { ReviewGate } from './ReviewGate';` line.

(Everything else in the panel stays: review history, interval chart, mastery, `PromptsPanel`, `AppEventsPanel`, notes/reference.)

- [ ] **Step 2: Remove the barrel exports**

In `apps/web/src/components/index.ts`, delete these two lines:

```ts
export * from './LogReviewForm';
export * from './ReviewGate';
```

- [ ] **Step 3: Remove the orphaned hooks**

In `apps/web/src/api/hooks.ts`:

1. Delete the `useNextPrompt` function (lines ~49-55).
2. Delete the `usePrompt` function (lines ~57-66, including its doc comment).
3. Delete the `useLogReview` function (lines ~176-182).
4. Remove `LogReviewInput` from the type import block at the top (it was only used by `useLogReview`).

(Leave the `qk` object untouched — `qk.nextPrompt` is still referenced inside `useInvalidateAll`.)

- [ ] **Step 4: Delete the component + reducer files**

Run:

```bash
rm apps/web/src/components/ReviewGate.tsx \
   apps/web/src/components/LogReviewForm.tsx \
   apps/web/src/screens/Dashboard/ReviewSession.tsx \
   apps/web/src/screens/Dashboard/session.ts \
   apps/web/src/screens/Dashboard/session.test.ts
```

(`session.ts`/`session.test.ts` are the ReviewSession reducer + its test — orphaned once `ReviewSession.tsx` is gone.)

- [ ] **Step 5: Verify build + tests**

Run: `yarn workspace @terrain/web build && yarn workspace @terrain/web test`
Expected: build PASS (no dangling imports to the deleted modules); vitest PASS (the deleted `session.test.ts` no longer runs; `initialStep.test.ts` + `format.test.ts` remain green). If tsc reports any remaining reference to a deleted symbol, grep for it (`grep -rn "ReviewGate\|LogReviewForm\|ReviewSession\|PromptRecall\|useNextPrompt\|useLogReview\|usePrompt" apps/web/src`) and remove that reference.

- [ ] **Step 6: Lint/format check (no commit)**

Run: `yarn lint && yarn format`
Expected: clean. Uncommitted.

---

### Task 6: Full gate + UI smoke

**Files:** none (verification only). Runbook: `docs/ops/local-dev.md`.

- [ ] **Step 1: Full monorepo gate**

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

If :3000 is held by a zombie, kill it first: `kill -9 $(lsof -ti:3000)` (per CLAUDE.md — `pkill -f "nest start"` does not work).

- [ ] **Step 3: Console-error sweep**

Run: `node scripts/smoke.mjs`
Expected: exit 0 (no console errors on `/`, `/topics`, `/roadmap`, `/export`, `/import`). Note the smoke script's route list predates `/session/$mode`; that route is exercised manually in Step 4.

- [ ] **Step 4: Behavior smoke (CDP or manual, logged-in)**

1. Dashboard: two track cards ("Review" with `N cards · ~M min` + "Start review"; "Learn" with the next topic + "Start learning"). No `▶ Review all` button, no "Studied elsewhere", no per-row "Log" button in the due list.
2. Click "Start review" → routes to `/session/repeat`, Step 1 shows "Copy context". Copy → advances to paste step (no dashboard flicker — you're on a different route).
3. Paste a `learning-os` block → preview tally appears (reviews / new cards / etc.); Save → "✓ Saved" → "Back to dashboard".
4. Back on the dashboard the button now reads "Start review" again (pending cleared by the import invalidation). Reload mid-flight (before importing): the button reads "Continue review" and `/session/repeat` opens at the paste step.
5. `/topics` → open a topic: no "Log a review" form; review history, mastery, prompts, app-events still render.
6. Telegram deep-link: visit `/?session=1` → redirects to `/session/repeat`.

- [ ] **Step 5: Report**

Summarize gate + smoke results honestly (per repo convention, leave everything uncommitted).

---

## Self-review notes

- **Spec coverage:** Part 1 (route + two-track page + read-only due list + Telegram deep-link) → Tasks 2, 3, 4; Part 2 (wizard stepper) → Task 2; Part 3 (resume) → Tasks 1, 2; Part 4 (full cut) → Tasks 4, 5. Testing section → Task 1 (vitest) + Tasks 2-5 (tsc gate) + Task 6 (full gate + smoke).
- **Placeholder scan:** none — every code step shows complete code; every command has an expected result.
- **Type consistency:** `TodayCard`'s new prop `{ dash: Dashboard }` (Task 3) matches the render in Task 4; `sessionRoute` exported in Task 2 is consumed by `sessionRoute.useParams()` inside the same file and navigated to via `Link to="/session/$mode"` (Task 3) / `navigate({ to: '/session/$mode' })` (Task 4); `initialStep` signature (Task 1) matches its call in Task 2; `ImportPlan.applicationEvents?` (Task 2) is read with `?.length ?? 0` so it is safe whether or not session-driven-learning has landed.
- **Ordering:** Task 3 (new TodayCard) precedes Task 4 (Dashboard uses it); Task 4 removes all Dashboard references to the deleted modules before Task 5 deletes them; Task 5 removes TopicDetailPanel references before deleting `ReviewGate`/`LogReviewForm`. No task leaves the tree un-buildable at its own completion except Task 3's known-and-noted transient `Dashboard/index.tsx` prop mismatch (resolved in Task 4).
- **Known-good conventions used:** `Card title=`, `stat-strip`/`kpi`, `btn`/`btn-primary`/`btn-ghost btn-sm`, `Link` with `params`, `whiteSpace: 'pre-wrap'`, the `learning-os` fence auto-preview pattern from the Import screen.
```
