# Retrieval Prompts (Roadmap Stage 1) — Design

## Purpose

Stage 1 of `docs/superpowers/specs/2026-07-01-learning-science-roadmap-design.md`.
Today a Terrain review is a self-rated 0-5 quality score with no retrieval
step — nothing forces the user to actually recall anything before rating
themselves. The testing effect (effortful recall beats passive
re-reading/self-judgment) is one of the most robust findings in
learning-science research; this is the highest-leverage gap in the app.

Terrain has no in-app LLM calls (`CLAUDE.md`: Claude.ai is the AI layer via
the existing session-export/import round trip). This spec adds prompts as
data authored in a Claude session and imported the same way topics/notes
already are, plus the review-flow changes to use them.

## Scope

In scope: `Prompt` data model with its own SM-2 state, import-contract
extension, `GET /topics/:id/prompts/next` selection endpoint,
`POST /reviews` extended to update a prompt's SR state alongside the
topic's, and the web review-flow gate (prompt → recall → reveal → rate).

Out of scope: any in-app LLM/question-generation calls; changes to the SM-2
algorithm itself (`packages/sr-engine` `sm2()` is reused unchanged, just
invoked twice); Stages 2-4 of the roadmap (reminders, interleaving,
structured notes).

## Research grounding

- **Minimum information principle** (SuperMemo's 20 Rules, rule #4): a
  prompt should test exactly one atomic fact. Folded in as an explicit
  authoring instruction in the session-export contract text, not a schema
  constraint (nothing stops a bad prompt being imported, but Claude is told
  the rule).
- **Free-recall/short-answer beats multiple-choice** for retention breadth
  and self-efficacy — confirms the chosen design (free-text scratch answer,
  never a multiple-choice format).
- **Per-fact spaced scheduling** (how Anki/SuperMemo actually work) is more
  faithful to the research than one shared schedule per topic. Adopted via
  giving each `Prompt` its own independent SM-2 state — see Data Model
  below — while deliberately leaving the topic's own SM-2 state untouched,
  since Stages 2/3 of the roadmap (reminders, interleaving) and the
  existing roadmap-graph/streak features all key off `Topic.nextReviewAt`.
  Forking scheduling per-prompt would otherwise reopen the DSA-graph
  session's decision that sub-patterns, not individual facts/problems, are
  the graph's reviewable unit.

## Data model

New `Prompt` model (`apps/api/prisma/schema.prisma`), added alongside
`Topic`/`Prerequisite`/`Review`:

```prisma
model Prompt {
  id            String    @id @default(uuid())
  topicId       String
  topic         Topic     @relation(fields: [topicId], references: [id])
  promptText    String
  answerHint    String?
  easeFactor    Float     @default(2.5)
  interval      Int       @default(0)
  repetitions   Int       @default(0)
  nextReviewAt  DateTime?
  reviews       Review[]
  createdAt     DateTime  @default(now())

  @@index([topicId])
}
```

No `userId` column — scoped via `topic: { userId }`, the same pattern
`Prerequisite` already uses (it has no `userId` either).

`Review` gains one nullable column:

```prisma
model Review {
  // ...existing fields unchanged...
  promptId String?
  prompt   Prompt? @relation(fields: [promptId], references: [id])
}
```

Nullable because the no-prompt fallback (a topic with zero prompts) still
logs a review with no `promptId`.

New prompts (from import) are created with default SR state — `easeFactor:
2.5, interval: 0, repetitions: 0, nextReviewAt: null` — the same convention
new `Topic` rows already use, meaning a fresh prompt is immediately due.

## Import contract extension

`packages/types/src/index.ts` `learningOsSchema` gains:

```typescript
const proposedPromptSchema = z.object({
  topicTitle: z.string(),
  promptText: z.string(),
  answerHint: z.string().optional(),
});
// added to learningOsSchema:
proposedPrompts: z.array(proposedPromptSchema).default([]),
```

`apps/api/src/import/import.service.ts` resolves `topicTitle` exactly like
`noteSummaries` does today: exact-match against existing DB topics union
same-batch `proposedTopics`; ambiguous or missing title pushes an
`unresolved` entry (kind: `'prompt'`) that blocks the entire import,
consistent with the existing all-or-nothing transaction. Applying is
purely additive — importing more prompts for a topic that already has some
never replaces or removes existing ones, matching the "rotate through
multiple prompts" design.

The `SessionsService.export` output-contract text (the ` ```learning-os ` 
JSON shape shown to Claude) is updated to document `proposedPrompts` and to
state the minimum-information-principle rule: "keep each prompt atomic —
one fact or concept per prompt; split compound questions into separate
prompts."

## API surface

- **`GET /topics/:id/prompts/next`** — new endpoint (new `apps/api/src/prompts/` module: `prompts.controller.ts`, `prompts.service.ts`). Loads all `Prompt` rows for the topic (scoped `topic: {id, userId}`), returns the one with the earliest `nextReviewAt` (treating `null` as most-overdue — sorted in application code, not a DB-level null-ordering clause, since per-topic prompt counts are small). Returns `null` if the topic has no prompts.
- **`POST /reviews`** (`apps/api/src/reviews/`) — `LogReviewDto` gains an optional `promptId: string`. `ReviewsService.logReview`, when `promptId` is present, loads that `Prompt`, runs `sm2(quality, promptSrState, now)` in addition to the existing topic-level `sm2()` call, and in one transaction: updates the `Topic` row (unchanged behavior), updates the `Prompt` row with its own new SR fields, and creates the `Review` row with `promptId` stamped. Without `promptId`, behavior is identical to today.

## Web review flow

- **New `ReviewGate` component** (`apps/web/src/components/ReviewGate.tsx`), wrapping `LogReviewForm` at its two current call sites (`Dashboard` quick-log, `TopicDetailPanel`).
  - Fetches `GET /topics/:id/prompts/next` on mount.
  - No prompt → renders `children` (`LogReviewForm`) immediately; today's flow is unchanged.
  - Prompt present → shows `promptText`, a free-text scratch textarea (local component state, never sent to the server), and a **Reveal** button. Reveal shows `answerHint` (if present) plus the topic's existing notes/summary, and only then renders `LogReviewForm` below it — the quality picker and submit button are not present before Reveal is clicked.
- **`LogReviewForm`** gains an optional `promptId?: string` prop, included in the `POST /reviews` payload when set.

## Testing

- `packages/sr-engine`: unchanged — `sm2()` reused as-is.
- `apps/api`:
  - `import.service.spec.ts`: new cases for `proposedPrompts` — creates `Prompt` rows with default SR state; resolves existing/in-batch topic titles; `unresolved` on missing/ambiguous title (mirrors existing `noteSummaries` cases).
  - `reviews.service.spec.ts`: new case — `logReview` with `promptId` updates both the topic's and the prompt's SR state independently and stamps `Review.promptId`; existing no-`promptId` case still passes unchanged.
  - New `prompts.service.spec.ts`: `next()` picks the prompt with the earliest `nextReviewAt` (null treated as most-overdue); returns `null` for a topic with zero prompts.
- `apps/web`: manual check via the existing Brave-CDP smoke script (no Playwright in this repo) — confirm `ReviewGate` skips straight to `LogReviewForm` for a no-prompt topic (regression check), and shows prompt → reveal → rating for a topic with one (seed a test prompt on one of the DSA sub-pattern topics).
- End-to-end: import a small `learning-os` block with 2-3 `proposedPrompts` against existing DSA topics via `preview` then `apply`; confirm `GET /topics/:id/prompts/next` returns one with default SR state.
