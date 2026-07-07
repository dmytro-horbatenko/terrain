# Guided Session Wizard — One "Start" per Track, Copy→Claude→Import — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm 2026-07-03)
**Scope:** `apps/web` only — a new routed session wizard, a slimmed Dashboard,
and the removal of every in-app grading surface. No backend changes this pass.

**Depends on:** `docs/superpowers/specs/2026-07-03-session-driven-learning-design.md`
(the `applicationEvents` import field) — see Dependencies. Sequence this **after**
that plan lands.

## Problem

The Dashboard's daily-loop surface (`TodayCard`) has three flaws the user hit
directly:

1. **Destructive one-click actions.** "Studied elsewhere" immediately PATCHes a
   topic `planned → active` *and* opens a grade modal; closing the modal leaves
   the topic silently activated with no confirm/undo/way back.
2. **Visual flicker.** Clicking "Copy repetition context" flips
   `exportCtx.isPending` (button text swaps) *and* `useGenerateExport`
   invalidates the `['dashboard']` query, so the whole dashboard refetches and
   re-renders mid-click.
3. **A scattered, unpredictable flow.** Two parallel tracks, each with multiple
   buttons, plus post-copy strips and breadcrumbs and a separate Import screen —
   no single guided path.

Underneath these is an architectural mismatch the user named explicitly: **the
app is not the reviewer.** Only Claude can verify whether an answer is valid,
what's wrong, what's missing. The app is a pure context provider — it hands
Claude context and records the resulting state; it should never quiz or grade on
its own. Yet the app today ships three in-app self-grading surfaces (the
`▶ Review all` session, the due-list "Log" buttons, the TopicDetailPanel grade
form) that make it act as a reviewer.

## Decision

Replace the scattered surface with **two tracks, each one "Start" button**, where
Start opens a **routed, stepped wizard** that walks the copy→Claude→import loop.
Remove every in-app grading surface (the app becomes pure context in, state out).

### Part 1 — Route & the two-track main page

- **New route `/session/$mode`** (`mode` ∈ `repeat` | `learn`), registered in
  `app/router.tsx` alongside existing routes. The wizard is a full page —
  deep-linkable, browser-back works.
- **`TodayCard` becomes two slim track cards:**
  - **Review** — shows the due set (`N cards · ~M min`, the due topics as
    read-only context) and one primary button. Idle → **"Start review"** →
    navigates to `/session/repeat`. If a repeat session is in flight
    (un-imported, <48h) → **"Continue review"** + a "session in progress — not
    imported yet" line.
  - **Learn** — shows the next topic (title, chapter, snippet, `✦` if
    AI-proposed) and one **"Start learning"** → `/session/learn`. Same
    idle/Continue swap. When the curriculum is exhausted or all remaining topics
    are blocked, the card shows the existing explainer instead of a button.
- The Dashboard below (KPI row, struggle/library, heatmap, due list) **stays**,
  but the due list is **read-only reference** (no per-row action).
- **Telegram deep-link:** the existing `/?session=1` effect (which opened the
  in-app review modal) is repointed to navigate to `/session/repeat`.
- The "in flight" state is expressed **only** by the Start→Continue button swap
  (driven by `dash.pendingSessions`) — no in-card copy-strips or breadcrumbs.

### Part 2 — The wizard stepper

`/session/$mode` renders a `SessionWizard` with `step ∈ {copy, paste, review, done}`
plus the pasted text in local state.

- **Step 1 — Copy & go.** On fresh entry, generate the mode's export
  (`useGenerateExport({ mode })`). Show an instruction ("Copy this and paste it
  into a fresh Claude chat — do the full session; Claude will quiz you, ask for
  an implementation, have you solve problems"), a **Copy context** button
  (clipboard failure falls back to a revealed raw-markdown textarea), and an
  **"I've started the session →"** button to advance. A successful copy also
  auto-advances.
- **Step 2 — Bring it back.** A textarea ("When Claude finishes, paste its final
  message here") and a helper card: *"Claude didn't output the `learning-os`
  block? Copy this and send it to Claude"* with a **Copy** button on a canned
  finalize prompt — *"Now output the final `learning-os` block per the OUTPUT
  CONTRACT from the context I gave you — one fenced `learning-os` block, echoing
  the sessionId."* Paste auto-previews once the text contains a
  ` ```learning-os ` fence (debounced ~600ms, the pattern the Import screen uses)
  with a manual **Preview** button; a successful preview advances to Step 3, a
  parse error shows inline.
- **Step 3 — Review & Save.** A compact summary of the parsed `ImportPlan`
  (e.g. *"3 reviews · 1 new card · 2 problems solved · 1 topic activated · 1 note
  updated"*; "problems solved" is the `applicationEvents` count). If anything is
  **unresolved**, list those rows and **disable Save** (all-or-nothing, as Import
  does today). **Save** (`useImportApply`) writes state → Step 4.
- **Step 4 — Done.** Confirmation with the tally. For **learn**, if a next topic
  exists, offer **"Learn next: <title>"** (starts a fresh learn session) plus
  **"Back to dashboard."** For **repeat**, just **"Back to dashboard."** Leaving
  invalidates the dashboard query.

A back-link lets you step back (copy→paste→back to re-copy). All action steps
reuse existing hooks — no new API surface.

### Part 3 — Resume behavior

On entry the wizard reads `dash.pendingSessions` (via `useDashboard`) and branches
using a pure helper `initialStep(pendingSessions, mode)`:

- **No pending session for this mode** → start at **Step 1 (copy)**; generate a
  fresh export.
- **A pending session for this mode** (un-imported, <48h — "latest per mode", the
  app already tracks this) → open at **Step 2 (paste)** with a note ("Resuming
  your in-progress {review/learn} session — started 2h ago"). No new export is
  generated (no duplicate).

The Dashboard **"Continue"** button just navigates to `/session/$mode`; the
wizard's own branch resumes. Deep-linking behaves identically.

**"Copy context again"** (copy & paste steps) regenerates a fresh export and
copies it. Because import resolves the session by the `sessionId` embedded in the
pasted block, and `pendingSessions` considers only the newest row per mode, a
regenerated context cleanly supersedes the old one — no stacking.

On **Save**, import stamps `importedAt`, the dashboard query is invalidated, the
pending entry disappears, and the button reverts Continue→Start. An un-returned
session ages out at 48h.

**Known limitation (accepted):** on resume the wizard jumps to *paste* rather than
re-rendering the original context, because no endpoint re-renders a persisted
export's text — you either still have it in Claude or hit "Copy context again."
Adding a "fetch existing export text" endpoint would be over-build.

### Part 4 — The full cut (app is never the reviewer)

**Deleted components:**
- `apps/web/src/screens/Dashboard/ReviewSession.tsx` — the in-app `▶ Review all`
  session.
- `apps/web/src/components/ReviewGate.tsx` — both `ReviewGate` and `PromptRecall`
  (the recall-then-grade wrapper); used only by the removed surfaces.
- `apps/web/src/components/LogReviewForm.tsx` — the 0–5 self-grade form.
- Their barrel exports in `apps/web/src/components/index.ts`.

**Dashboard (`index.tsx`) removals:** the `▶ Review all` modal + `sessionOpen`
state; the `logTopic` grade modal + `startTopic` activation; `DueGroup`'s per-row
**Log** button + `onLog` prop (due list becomes read-only reference); the old
`TodayCard` copy-strip/breadcrumb internals (rewritten per Part 1).

**`TopicDetailPanel.tsx`:** remove the **"Log a review"** section (the
`ReviewGate` + `LogReviewForm` block). **Keep** all read-only context: review
history + interval chart, mastery checklist, `PromptsPanel` (prompt list +
Suspend toggle), `AppEventsPanel`.

**Now-orphaned hooks (remove from `api/hooks.ts`):** `useNextPrompt` (only
`ReviewGate`), `useLogReview` (only `LogReviewForm`), and the session-queue hook
`ReviewSession` consumed.

**`PromptsPanel` stays** — it only *mentions* `ReviewGate` in a comment; it is a
read-only prompt list + Suspend/Unsuspend toggle, no in-app grading.

**Backend left intact this pass.** `POST /reviews`, `GET /reviews/session-queue`,
and `GET /topics/:id/prompts/next` become UI-orphaned but keep working. Deleting
them is a clean, separate backend follow-up — bounding this change to the web
keeps it low-risk. (Follow-up noted, not done here.)

## Dependencies & sequencing

- **After session-driven-learning.** Step 3's "problems solved" tally is the
  `applicationEvents` count on `ImportPlan`, which that plan adds. Build this
  after it lands.
- **Shared file, apply in order.** Both plans edit `TopicDetailPanel.tsx`
  (session-driven-learning rewrites the *notes* section → read-only summary +
  manual override; this removes the *Log a review* section — different regions)
  and both touch the import result types. Apply session-driven-learning first,
  then this.

## Testing

- **Pure logic (vitest):** `initialStep(pendingSessions, mode)` — pending within
  window → `'paste'`; none → `'copy'`; stale (>48h) → `'copy'`; wrong-mode
  ignored. The repo already runs web vitest (`src/lib/format.test.ts`).
- **tsc gate + CDP smoke** (repo convention — no component-test infra):
  `yarn workspace @terrain/web build`; then a live smoke — navigate
  `/session/repeat`, copy, paste a `learning-os` block, see the preview tally,
  Save, confirm the dashboard reflects it and the button reverted
  Continue→Start; deep-link `/session/repeat` resumes to paste when a session is
  pending; verify no in-app grade surfaces remain (`/`, `/topics`).
- **Full gate:** `yarn build && yarn test && yarn lint && yarn format:check`.

## Files touched

- *Create:* `apps/web/src/screens/Session/index.tsx` (wizard); an `initialStep`
  helper (co-located or in `src/lib/`) + its test; register `/session/$mode` in
  `apps/web/src/app/router.tsx`.
- *Modify:* `apps/web/src/screens/Dashboard/index.tsx`;
  `apps/web/src/screens/Dashboard/TodayCard.tsx` (rewrite to two track cards);
  `apps/web/src/components/index.ts` (drop barrels);
  `apps/web/src/api/hooks.ts` (drop orphaned hooks);
  `apps/web/src/components/TopicDetailPanel.tsx` (drop Log-a-review); the Telegram
  `?session=1` effect (→ navigate `/session/repeat`).
- *Delete:* `apps/web/src/screens/Dashboard/ReviewSession.tsx`;
  `apps/web/src/components/ReviewGate.tsx`;
  `apps/web/src/components/LogReviewForm.tsx`.

## Non-goals

- No backend changes (endpoint teardown deferred to a follow-up).
- No new API surface — the wizard reuses `useGenerateExport` / `useImportPreview`
  / `useImportApply` / `useDashboard`.
- No component-test infra added.
- No change to FSRS, the import internals, or the export/conduct content (that's
  the session-driven-learning plan).

## Repo convention

Per `CLAUDE.md` and standing user preference, work stays **uncommitted** in the
working tree — no git commits (this doc included) unless explicitly requested.
