# AI Session Loop — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm 2026-07-03)
**Depends on:** the interleaved review session
(`docs/superpowers/specs/2026-07-03-interleaved-review-session-design.md`,
plan `docs/superpowers/plans/2026-07-03-interleaved-review-session.md`) —
specifically `MetricsService.sessionQueue()`. That plan executes first.

## Problem

Terrain's stated purpose is to be a context store and progress mirror for
learning that happens *in Claude sessions*. The export → Claude → import
loop exists and its state machinery is strong (due cards with promptIds in
the export, strict `learning-os` v2 contract, FSRS replay on import). But a
2026-07-03 review found four gaps that keep the loop from being the
semi-automatic daily flow it's meant to be:

1. **No today-scoped export.** Modes are `full`, `domain:<x>`, and
   per-topic focus — every one dumps the entire landscape. There is no
   "today's repetition" export and no "teach me my next topic" export.
2. **No Dashboard → Export handoff.** The Dashboard suggests what to do
   (due list, Next Up) but never hands the user the matching context; they
   must navigate to Export and pick a mode themselves.
3. **Import can't activate topics.** Learning a topic with Claude and
   importing the session leaves it `planned` — nothing unblocks downstream
   until the user separately clicks "Start" in-app. The roadmap silently
   drifts from reality.
4. **No session-conduct instructions.** The output contract states rules
   about fields ("grade is the user's own recall verdict, never yours") but
   nothing scripts the session itself: present a card, wait for the
   attempt, ask for a self-grade. Session quality depends on Claude
   inferring the ritual.

## Solution overview

Two new first-class export modes (`repeat`, `learn`) built inside the
existing export generator, each carrying an explicit SESSION CONDUCT
script; one-click copy buttons on the Dashboard next to the surfaces that
motivate them; and a `studiedTopics` field in the `learning-os` contract so
a learning session's import activates the studied topic (with preview
visibility) and unblocks the next stage.

The daily loop becomes: open Dashboard → "Copy repetition context" → paste
into Claude chat 1 and review with self-grading → (optionally) "Copy
learning context" → paste into Claude chat 2 and learn the Next Up topic →
paste each chat's `learning-os` block into Import → preview shows reviews +
new cards + **activation** → Apply updates FSRS state, activates the
studied topic, unblocks successors, and stores the next focus.

## Scope

**In scope:**
- `mode=repeat` and `mode=learn` export modes (API + generator + persisted
  `exportMode` values).
- SESSION CONDUCT blocks for both modes.
- `studiedTopics` in the `learning-os` contract (packages/types), import
  preview + apply support, activation semantics.
- Dashboard copy buttons (repetition + learning) and Export-screen mode
  picker entries.
- Contract text update in `output-contract.ts` (mentions `studiedTopics`).

**Out of scope:**
- Any change to FSRS scheduling or the in-app review session.
- Time budgeting ("I have 20 min") — still deferred.
- Telegram changes (digest deep link already points at the session flow).
- Multi-topic learn exports (one focus topic per learn session).
- Editing/unticking individual import items in the preview UI — the
  preview stays read-only; the user edits the pasted JSON if something is
  wrong (matches current behavior).

## Design

### 1. `mode=repeat` — today's repetition context

`GET /sessions/export?mode=repeat`. Persisted `exportMode: 'repeat'`.
Sections, in order:

1. **Header** (unchanged: session id, mode).
2. **WHO I AM** (unchanged).
3. **TODAY'S REVIEW QUEUE** — the interleaved queue from
   `MetricsService.sessionQueue(userId, now)` (due cards + up to 5 new
   cards from active topics, round-robin by chapter), rendered in queue
   order, one line per card:
   `- card <promptId> [<kind>] (<chapterTitle>) <promptText>` with new
   cards additionally tagged `[NEW]`. A summary line above:
   `<n> cards (<dueCount> due, <newCount> new) · estimated <m> min`
   (minutes via the existing `estimateMinutes` heuristic used by the
   Telegram digest — reuse or mirror its logic).
4. **SESSION CONDUCT** — the repetition script (verbatim template, final
   wording owned by the implementation plan but covering exactly these
   rules):
   - Work through the queue in the listed order, one card at a time.
   - Show the prompt, then WAIT for the user's attempt. Never reveal the
     answer, hints, or your own solution before the attempt.
   - After the attempt, give brief feedback (correct/what was missed) —
     clarification, not lecturing.
   - Then ask the user to self-grade: again / hard / good / easy. Record
     their verdict verbatim as `grade`; never substitute your own
     assessment.
   - Cards tagged [NEW] have never been studied: give a short (2–4
     sentence) introduction first, then quiz as normal.
   - Reference every review by `promptId`.
5. **OUTPUT CONTRACT** (existing block, with the `studiedTopics` addition
   from §3 — present in all modes since the contract is shared).

Deliberately omitted: roadmap tree, parked ideas, mastery table, recent
sessions, struggle ratio. A lean context keeps the chat on-script.

Empty queue: the export still generates, with TODAY'S REVIEW QUEUE reading
`Nothing due today.` and no SESSION CONDUCT block. (The Dashboard button is
hidden in this case anyway; the endpoint stays safe for manual use.)

### 2. `mode=learn` — learning context for one topic

`GET /sessions/export?mode=learn&focusTopicId=<id>`; `focusTopicId`
optional — defaults to the Next Up topic (`MetricsService.nextUp`). If
there is no startable topic and no explicit focus, respond 422 with a clear
message. Persisted `exportMode: 'learn'`. Sections:

1. **Header**, **WHO I AM** (unchanged).
2. **ROADMAP — <focus topic's domain>** (existing tree renderer, scoped to
   that one domain) — Claude sees where the topic fits.
3. **LEARNING GOAL** — the focus topic: title, topicType, description,
   `aiContext` if present; its chapter (parent title + sibling progress
   `<started>/<total> in this chapter started`); its **direct
   prerequisites, each with its stored note summary** (the elaborative
   bridge: "builds on X — key insight: …"; prerequisites without summaries
   listed by title only); and any existing cards on the topic (id, kind,
   text) so Claude doesn't propose duplicates.
4. **SESSION CONDUCT** — the teaching script (same ownership rule as
   above; must cover):
   - Teach the focus topic Socratic-style: questions before explanations;
     push back if the user moves too fast; enforce confusion time (let the
     user sit with a hard question before rescuing them).
   - Connect new material to the listed prerequisites explicitly.
   - End of session: propose 3–7 atomic cards via `proposedPrompts`
     (mix of concept/code/problem as fits the topic; don't duplicate the
     existing cards listed above); write one `noteSummaries` entry for the
     topic (keyInsight required; invariant/contradiction when real); and
     **list the focus topic's title in `studiedTopics`**.
   - If the session genuinely covered additional existing topics in depth,
     they may also be listed in `studiedTopics`; do not list topics that
     were merely mentioned.
5. **OUTPUT CONTRACT** (shared).

### 3. Contract: `studiedTopics`

`packages/types` `learningOsV2Schema` gains:

```ts
studiedTopics: z.array(z.string().min(1)).max(20).optional()
```

Version stays `2` — the field is optional, so previously-generated exports
and old outputs remain valid; the strict parser now recognizes the key.
`output-contract.ts` adds the field to the JSON template and one rule line:

> `studiedTopics: titles of topics genuinely studied this session — a
> planned topic listed here is activated on import (its successors
> unblock).`

**Import semantics** (`import.service.ts`):

- **Resolution:** each title resolves case-insensitively against the
  user's topics *including topics created earlier in this same import's
  transaction* (same title-resolution pass prerequisites already use).
  Unresolved titles go to the Unresolved panel and **block apply**, like
  every other unresolved reference.
- **Planned topic** → `status: 'active'`, `aiProposed: false`,
  `startedAt`-equivalent side effects identical to the in-app Start action
  (the in-app action sets only `status` + `aiProposed`; mirror exactly
  that).
- **Active/mastered topic** → no-op, shown in the preview as already
  active (informational, not an error).
- **Archived topic** → treated as unresolved-class problem: shown in the
  Unresolved panel with reason "archived — unarchive in-app first";
  blocks apply. (Silently reviving archived topics would be surprising.)
- **Preview** (`buildPlan`): new plan section `activations: [{ topicTitle,
  currentStatus, willActivate: boolean }]`. **Apply result** gains
  `topicsActivated: number`.
- Activation happens in the same `$transaction` as everything else.

### 4. Dashboard handoff + Export screen

- **"Copy repetition context"** button on the Dashboard due section
  (rendered next to / consistent with the "Review all (N)" button from the
  in-app session feature; visible when `sessionQueueCount > 0`). Click →
  `GET /sessions/export?mode=repeat` → copy `exportMd` to clipboard →
  toast: "Repetition context copied — paste into a fresh Claude chat."
  Uses the Export screen's existing clipboard helper pattern (with its
  fallback for unavailable clipboard API).
- **"Copy learning context"** button on the Next Up card, next to the
  existing "Start" button (which stays — in-app activation remains
  possible). Click → `GET /sessions/export?mode=learn` (no focusTopicId;
  server defaults to Next Up) → copy + toast: "Learning context copied —
  paste into a fresh Claude chat." Hidden when `nextUp` is null.
- Both buttons show a brief pending state while the export generates
  (each call persists a SessionExport row, same as the Export screen).
- **Export screen**: mode picker gains `repeat` and `learn` entries.
  `learn` shows the existing topic `<select>` (like focus mode today) with
  the Next Up topic preselected. The `focus` mode remains unchanged for
  backward compatibility (it's a different intent: drive an *active* topic
  to mastery vs. learn a *new* one).

### 5. Sequencing note

The prior plan (in-app interleaved review session) is executed **first**;
this stage consumes its `sessionQueue()` method. Both features coexist by
design: in-app "Review all" for quick solo maintenance, `repeat` exports
for Claude-guided repetition. Both paths write the same Review rows and
advance the same FSRS state.

## Error handling & edge cases

- `mode=learn` with no startable topic and no `focusTopicId` → 422
  (`UnprocessableEntityException`) "No startable topic — pass focusTopicId
  or start something from the roadmap."
- `mode=learn` with a `focusTopicId` that is archived or not the user's →
  404 (matches existing focus behavior).
- `mode=repeat` with empty queue → valid export, "Nothing due today."
- `studiedTopics` naming a topic created by `proposedTopics` in the same
  block → resolves and activates it (planned → active) in one import.
- Duplicate titles in `studiedTopics` → deduplicate before resolution.
- Multiple user topics sharing a title (possible across domains) →
  resolution follows the importer's existing same-title disambiguation
  behavior; if ambiguous there, it lands in Unresolved (consistent with
  prerequisite resolution today).
- Clipboard API unavailable on the Dashboard → fall back to navigating to
  the Export screen with the generated export shown for manual copy (or
  the same manual-select fallback the Export screen uses — implementation
  plan picks the smaller one).

## Testing

- **Generator (jest, apps/api):** `mode=repeat` renders queue order
  exactly as `sessionQueue` returns it, tags [NEW] correctly, includes
  SESSION CONDUCT and omits roadmap/mastery; empty-queue variant; 
  `mode=learn` includes scoped roadmap, prerequisites with summaries,
  existing cards, conduct block, and 422/404 cases; both modes persist the
  right `exportMode` and round-trip the session id.
- **Contract (vitest, packages/types):** `studiedTopics` accepted
  (optional, max 20, dedup is importer-side not schema-side), unknown
  fields still rejected, version still 2.
- **Import (jest):** preview `activations` section for planned / active /
  archived / unresolved / same-import-created titles; apply activates
  planned topics (status + aiProposed), counts `topicsActivated`, blocks
  on unresolved and archived; activation inside the transaction.
- **Web:** build + vitest untouched-suite green; CDP smoke: both Dashboard
  buttons copy non-empty contexts with correct headers; full round-trip —
  export repeat, import a hand-crafted block containing one promptId
  review + one `studiedTopics` title for a planned topic, verify FSRS
  advanced, topic active, successors unblocked on the roadmap, preview
  showed the activation.
- **Full gate:** `yarn build && yarn test && yarn lint && yarn format:check`.
