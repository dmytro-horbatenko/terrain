# Prompt Graduation — Design

## Purpose

The second of three sequenced review-loop improvements agreed with the user
(write-from-scratch recall — done — → prompt graduation/dedup → FSRS
algorithm swap). Today a `Prompt` cycles through SM-2 forever no matter how
many times it's answered well — there's no way for the review queue to stop
testing something you've clearly mastered. DSA-focused spaced-repetition
tools (LeetSRS, grind, DSAPrep) converge on the opposite: only keep
something in rotation while it's still genuinely uncertain; retire it once
mastered.

Terrain already has a *topic*-level analog — `Topic.status = 'mastered'`,
set via a manual button in `TopicDetailPanel` gated on
`MetricsService.masteryStatus()` (interval ≥ 30, at least one
`ApplicationEvent`, and notes present) — and `MetricsService.dueTopics()`
already excludes non-`'active'` topics from the due queue. That mechanism
is a deliberate, heavier, whole-topic ceremony and is out of scope here.
This spec adds the lighter, automatic, per-`Prompt` equivalent that has no
existing analog.

## Scope

In scope: `Prompt.graduated`/`Prompt.consecutiveGood` fields, the
graduation rule inside `buildReviewWrites()`, excluding graduated prompts
from `PromptsService.next()`, a manual un-graduate endpoint, and a web
`PromptsPanel` to see/toggle it.

Out of scope: any change to `Topic.status = 'mastered'` or
`MetricsService.masteryStatus()`; any change to the SM-2 algorithm itself;
Stage 3 (the FSRS swap, next in sequence).

## Data model

`Prompt` (`apps/api/prisma/schema.prisma`) gains two fields:

```prisma
model Prompt {
  // ...existing fields (including promptKind from the prior stage)...
  graduated       Boolean @default(false)
  consecutiveGood Int     @default(0)
}
```

Per the user's standing "still initial setup" preference (established in
the prior write-from-scratch stage), this edits `schema.prisma` and the
single consolidated `20260701113254_init/migration.sql` directly — no new
migration file. The user re-applies it themselves via the dev-DB reset
after this lands.

## Graduation rule

`apps/api/src/reviews/sr-apply.ts`'s `buildReviewWrites()` already
branches on an optional `prompt` argument to compute the prompt's own SM-2
update alongside the topic's — both `ReviewsService.logReview` and
`ImportService.apply` funnel every prompt review through this one
function. The graduation rule is added in that same branch, after the
existing `promptAfter = sm2(...)` call:

```typescript
const GOOD_QUALITY = 4;
const GRADUATION_STREAK = 3;

// ...inside `if (prompt) { ... }`, after computing promptAfter:
const consecutiveGood = quality >= GOOD_QUALITY ? prompt.consecutiveGood + 1 : 0;
const graduated = prompt.graduated || consecutiveGood >= GRADUATION_STREAK;
promptWrite = {
  easeFactor: promptAfter.easeFactor,
  interval: promptAfter.interval,
  repetitions: promptAfter.repetitions,
  nextReviewAt: promptAfter.nextReviewAt,
  consecutiveGood,
  graduated,
};
```

`prompt.graduated ||` makes graduation sticky once earned through the
normal review flow — a single later quality<4 review before the user
happens to un-graduate it manually does not silently un-graduate it (only
the explicit endpoint below does that).

## Effect on rotation

`PromptsService.next()` (`apps/api/src/prompts/prompts.service.ts`) adds
`graduated: false` to its `prisma.prompt.findMany` filter:

```typescript
const prompts = await this.prisma.prompt.findMany({ where: { topicId, graduated: false } });
```

If every prompt for a topic is graduated, `prompts` is empty and `next()`
returns `null` exactly as it does today for a topic with zero prompts —
`ReviewGate.tsx` already renders `children()` directly (today's
no-recall-gate flow) in that case, so no web change is needed for this
part.

## Manual un-graduate

New endpoint, new `apps/api/src/prompts/prompts.controller.ts` route
(separate `@Controller('prompts')` block in the same file, since this
targets a prompt by its own id rather than nesting under a topic id like
the existing `next` route):

```typescript
@Controller('prompts')
export class PromptGraduationController {
  constructor(private service: PromptsService) {}

  @Patch(':id')
  setGraduated(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetGraduatedDto,
  ) {
    return this.service.setGraduated(userId, id, dto.graduated);
  }
}
```

`PromptsService.setGraduated(userId, id, graduated)`: loads the `Prompt`
scoped by `topic: { id: prompt.topicId, userId }` (the same
cross-user-safe relation-filter pattern `Prerequisite` already uses, since
`Prompt` has no direct `userId` column), 404s if not found/not owned,
updates `{ graduated, consecutiveGood: 0 }` — the counter always resets on
a manual toggle in either direction, so a manual un-graduate doesn't
immediately re-graduate after one more good review, and a manual
early-graduate doesn't carry over a stale streak.

`SetGraduatedDto`: `{ graduated: boolean }`, `class-validator`
`@IsBoolean()`, matching this repo's existing DTO conventions
(`apps/api/src/topics/dto.ts`).

## Web surface

New `apps/web/src/components/PromptsPanel.tsx`, following the existing
`AppEventsPanel.tsx` pattern (receives its data as a prop from the parent,
not its own fetch):

- Lists each `Prompt` for the topic: `promptText` (truncated), and either
  a `n/3` progress readout (`consecutiveGood`/`GRADUATION_STREAK`, using
  the same `3` constant surfaced to the client via the API response — no
  need to duplicate the constant, the panel just renders whatever
  `consecutiveGood` value it's given against a hardcoded `3` display
  label, matching the backend rule since both are this stage's fixed
  value) for prompts with `graduated: false`, or a "🎓 Graduated" badge
  and an "Un-graduate" button for `graduated: true` prompts.
- The button calls a new `usePromptGraduation` mutation
  (`PATCH /prompts/:id`), invalidating the topic detail query and the
  next-prompt query on success (same invalidation shape
  `useLogReview` already uses for `topicId`).

`TopicsService.getDetail()` (`apps/api/src/topics/topics.service.ts`)
gains `prompts` in its `include` (same pattern as the existing `appEvents`
key), so the topic detail payload carries the full prompt list. Mounted
in `TopicDetailPanel.tsx` alongside `AppEventsPanel`:

```tsx
<PromptsPanel topicId={t.id} prompts={t.prompts} />
```

## Testing

- `apps/api`:
  - `sr-apply.spec.ts`: `buildReviewWrites` with a prompt — quality ≥ 4
    increments `consecutiveGood`; quality < 4 resets it to `0`; reaching
    `3` sets `graduated: true`; an already-`graduated: true` prompt stays
    `graduated: true` even if a later quality < 4 review resets the
    streak (the `prompt.graduated ||` stickiness).
  - `prompts.service.spec.ts`: `next()` excludes `graduated: true`
    prompts from candidate selection; returns `null` when all of a
    topic's prompts are graduated; `setGraduated` 404s on a prompt
    belonging to another user's topic (cross-user isolation, matching
    this repo's established isolation-test pattern); `setGraduated`
    resets `consecutiveGood` to `0` on both un-graduate and (manual)
    graduate.
  - `reviews.service.spec.ts` / `import.service.spec.ts`: no new cases
    expected — both already exercise `buildReviewWrites` with a prompt
    via existing tests; the graduation fields flow through the same
    `promptWrite` object those tests already assert against.
- `apps/web`: manual Brave/CDP smoke — a prompt reviewed 3 times at
  quality ≥ 4 stops appearing from `GET /topics/:id/prompts/next`;
  `PromptsPanel` shows the "🎓 Graduated" badge and "Un-graduate" works
  (prompt reappears in rotation after); a fresh/low-quality prompt shows
  the `n/3` progress readout instead.
