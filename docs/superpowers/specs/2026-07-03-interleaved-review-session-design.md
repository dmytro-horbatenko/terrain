# Interleaved Review Session — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm 2026-07-03)
**Stage:** Learning-science roadmap Stage 3 (interleaving) — supersedes the
roadmap spec's "pure resequencing" headline design, which predates FSRS and
assumed a due queue existed to reorder.

## Problem

Two gaps, solved together because interleaving needs something to interleave:

1. **No interleaving.** The interleaving effect (mixing categories improves
   discrimination between similar-looking concepts) is directly relevant to
   the DSA curriculum — 308 cards across 18 chapters full of confusable
   sub-patterns (Union-Find vs DFS-for-components, sliding window vs two
   pointers). Today nothing mixes anything: due lists are ordered purely by
   `nextReviewAt`, which clumps cards imported/reviewed together.
2. **No review queue at all.** The daily flow is: Dashboard due-topics list →
   click "Log" on one topic → modal reviews one card → modal closes → click
   the next topic manually. Cards are only served *within* the clicked topic
   (`GET /topics/:id/prompts/next`). Reviewing 20 due cards means ~20 rounds
   of manual clicking, and the effective card order is whatever the user's
   clicking discipline produces.

## Solution overview

A **"Review all" session**: one endpoint builds an interleaved cross-topic
queue of due cards (round-robin by chapter), and the web review modal
auto-advances through it with progress. Interleaving lands where it matters —
the actual sequence of cards the user experiences — and the click-per-topic
usability gap disappears in the same stroke.

## Scope

**In scope:**
- `GET /reviews/session-queue` — builds the interleaved queue (API).
- `interleaveQueue()` — pure, deterministic interleaving function with unit
  tests.
- `GET /prompts/:id` — fetch one card with FSRS interval previews (API).
- `ReviewSession` web component + Dashboard "Review all (N)" entry button +
  progress indicator + skip + end-of-session summary.
- Telegram digest "Start review" button deep-links to auto-open the session.

**Out of scope:**
- Any change to FSRS scheduling itself — this is presentation-order only.
- Time budgeting ("I have 20 min") — deferred, possible later trim on the
  same queue.
- Auto-starting planned topics from a session (see Queue contents).
- Reordering the Dashboard due-topics list — it stays `nextReviewAt asc`;
  the session replaces it as the primary review path.
- Evidence-only reviews (topics with no cards) inside the session — they
  remain on the Dashboard list with the per-topic "Log" flow.

## Design

### 1. Queue construction (API)

**Endpoint:** `GET /reviews/session-queue` (reviews controller; queue
assembly lives in `MetricsService`, which already owns `dueCards` and the
startable-topics logic).

**Contents:**
- All due cards for the user — same predicate as the existing
  `MetricsService.dueCards` (non-suspended prompts, `nextReviewAt <
  endOfToday`, non-archived topics).
- Plus up to **5 new cards** (`state = 'new'`), drawn only from **active**
  topics (already started), in `createdAt asc` order. Planned topics are
  excluded: grading a planned topic's card would have to silently activate
  the topic, muddying the planned/active semantics. Starting new topics
  stays a deliberate act via Next Up.

**Interleaving:** `interleaveQueue(cards)` — a pure function in its own
module (like `projectRoadmap` in apps/web; this one lives in apps/api next
to the metrics service), unit-tested independently.

- **Grouping key ("chapter"):** the card's topic's parent title (one
  `parentId` hop). Fallbacks: topic has no parent → use the topic's `domain`;
  as a last resort the topic's own title. For the DSA graph this yields the
  18 NeetCode chapter buckets.
- **Order:** round-robin across chapters. Within a chapter, keep
  `nextReviewAt asc` (most overdue first); new cards sort after due cards
  within their chapter bucket (no `nextReviewAt`), so they get mixed
  throughout the ride rather than appended at the end.
- **Determinism:** no randomness. Chapter round-robin starts from the
  chapter holding the most-overdue card and cycles in a stable order
  (chapters sorted by their most-overdue card's `nextReviewAt`). Same
  input → same queue, so tests and reopened sessions are predictable.

**Payload:** ordered array of queue items — metadata only, no card text:

```
{ items: [{ promptId, topicId, topicTitle, chapterTitle, kind, isNew }] }
```

At ~tens of cards this could carry full text, but keeping it thin means
interval previews are computed fresh per card at review time (they're
grade-projections and should reflect the moment of grading).

### 2. Per-card fetch (API)

**Endpoint:** `GET /prompts/:id` — returns exactly the shape
`GET /topics/:id/prompts/next` already returns (prompt fields +
`previewIntervals` from the sr-engine), for one specific prompt. User-scoped
via the prompt's topic; 404 if not found / not the user's. `ReviewGate`
consumes this shape today, so the web session reuses it unchanged.

### 3. Session mode (web)

- **Entry:** Dashboard gets a primary **"Review all (N)"** button above the
  due list. N = queue length, served as a new `sessionQueueCount` field on
  the existing `GET /metrics/dashboard` payload (computed from the same
  queue assembly, count only). Hidden when zero.
- **`ReviewSession` component:** opens in the existing modal. Fetches the
  queue once at session start, holds a cursor, and for each item fetches
  `GET /prompts/:id` and runs the same recall → reveal → grade flow —
  `ReviewGate`'s recall step and `LogReviewForm` are reused (refactored as
  needed so the prompt can be passed in rather than fetched by topic).
- **Advance:** grading auto-advances to the next item. Progress indicator:
  "7 / 23 · Sliding Window" (position, total, current chapter).
- **Skip:** advances the cursor without grading — the card simply stays due.
  No re-queue-at-end in v1.
- **Interruption-safe:** every grade persists immediately via the existing
  `POST /reviews`. Closing the modal mid-session loses nothing; reopening
  builds a fresh queue minus whatever was graded.
- **End screen:** simple summary — cards reviewed, new cards started, then a
  close button. Dashboard queries invalidate/refetch on close (due counts,
  streak).
- **Fallback path unchanged:** the per-topic "Log" button and
  `TopicDetailPanel` review block stay as-is.

### 4. Telegram deep link

The digest's "Start review" button URL gains `/?session=1`. The Dashboard
reads the flag on load and auto-opens the session modal (then strips the
param). One-line change on the bot side, small effect on the Dashboard.

## Error handling & edge cases

- **Stale queue item** (card graded in another tab / suspended meanwhile):
  `GET /prompts/:id` still succeeds — grading an already-reviewed card is
  legitimate FSRS input. If the fetch 404s (deleted), the session skips to
  the next item silently.
- **Empty queue:** the "Review all" button doesn't render; direct
  `?session=1` deep link with nothing due shows the end screen immediately
  ("Nothing due — all caught up").
- **Evidence-only due topics:** not in the queue (card-based); still visible
  on the Dashboard list beneath the button.
- **Single-chapter due set:** round-robin degenerates to `nextReviewAt asc`
  within the chapter — correct and expected.

## Testing

- **`interleaveQueue` unit tests (jest, apps/api):** round-robin correctness
  across ≥3 chapters; single-chapter degenerate case; new-card mixing (after
  due within a chapter, present mid-queue not appended); determinism (stable
  output for same input); grouping fallbacks (no parent → domain → title).
- **Queue endpoint tests:** userId scoping, suspended/archived exclusion,
  new-card cap (5) and active-topics-only restriction, planned topics
  excluded.
- **`GET /prompts/:id` tests:** shape parity with `prompts/next`, ownership
  404.
- **Web (vitest):** session cursor/advance/skip reducer logic.
- **Full gate:** `yarn build && yarn test && yarn lint && yarn format:check`.
- **CDP smoke (Brave headless):** real account, open session, grade ≥2 cards
  from different chapters, verify auto-advance + progress text + end screen,
  0 console errors.

## Dependencies

Reads the same `dueCards` query the Telegram digest consumes (Stage 2) — no
changes to it. No schema/migration changes anticipated (queue is computed,
not stored).
