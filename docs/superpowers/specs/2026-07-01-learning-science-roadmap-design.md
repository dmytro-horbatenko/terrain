# Learning-Science Roadmap — Design

## Purpose

Terrain currently implements real spaced repetition (SM-2 scheduling per
topic) but stops there. A review today is a self-rated 0-5 quality score
with no retrieval step, no reminder ever tells the user a review is due, no
interleaving happens across topics, and manually-edited notes are a single
unstructured textarea (despite the AI-import path already knowing how to
produce structured notes). This spec sequences four independent
improvements, each targeting one of these gaps, so the app moves from
"scheduler" toward "a system that actually applies what the learning-science
literature says works": the testing/retrieval effect, consistent spaced
practice (which requires reminders to actually happen), interleaving, and
elaborative encoding.

This document fixes **sequence, dependencies, and headline design** for each
stage. Each stage gets its own detailed spec + implementation plan when work
on it begins — this is not itself an implementation plan.

## Scope

In scope: sequencing and headline design of 4 sub-projects (retrieval
prompts, Telegram reminders, interleaved due-queue ordering, structured
manual notes).

Out of scope: implementation-level detail for any stage (schema field
names, exact endpoints, exact UI components) — that's each stage's own
future spec. Also out of scope: any change to the SM-2 algorithm itself,
any in-app LLM calls (Terrain remains a context store or Claude.ai per
`CLAUDE.md` — content generation stays in Claude sessions via the existing
import flow).

## Stage 1 — Retrieval prompts

**Problem:** a review is currently just a self-rating with no recall step,
so it's trivial to rate yourself well without having actually retrieved
anything. The testing effect (effortful recall, not passive review) is one
of the most robust findings in learning-science research — this is the
single highest-leverage gap.

**Design:** Terrain has no in-app LLM calls; content authoring already
happens in Claude sessions via the `learning-os` import block
(`packages/types` `learningOsSchema`, `apps/api/src/import/`). Extend that
contract with a new array, e.g. `proposedPrompts[]: {topicTitle, promptText,
answerHint?}`, imported the same way `proposedTopics`/`noteSummaries` are
today (title-resolved against existing/batch topics, all-or-nothing
transaction). Store prompts as a new entity or field associated with
`Topic`. Review flow changes so a due topic shows its prompt first, gives
the user a place to attempt recall (mentally, or typed into a non-graded
scratch field), reveals notes/answer, and only then presents the existing
0-5 self-rating. No automated correctness grading — the mechanism is
"recall before rating," not "check the answer."

**Depends on:** nothing.

## Stage 2 — Reminders (Telegram bot)

**Problem:** nothing ever tells the user a review is due — `Settings` has a
`telegramChatId` field and `ReviewMode` already includes `telegram_quick`,
but no bot exists (`CLAUDE.md` explicitly lists this as deferred Phase 1c).
Spaced repetition only works if the review actually happens near the
scheduled moment; right now that depends entirely on the user remembering
to open the app.

**Design:** build the Telegram bot against the existing schema fields. The
daily streak cron (`apps/api/src/streak/streak.cron.ts`, `@Cron('5 0 * * *')`)
gains a step that sends a due-topics digest to each user's
`telegramChatId`. Quick replies (or a deep link back into the app) log a
review via the existing `telegram_quick` mode.

**Depends on:** nothing (independent of Stage 1), but sequenced second
because Stage 1's retrieval prompts are most valuable once reviews are
actually happening on schedule.

## Stage 3 — Interleaving

**Problem:** the due-topics queue has no ordering logic beyond
`createdAt` — no attempt to mix categories/domains, which the interleaving
research shows improves discrimination between similar-looking concepts
(directly relevant given how many DSA sub-patterns are easy to confuse,
e.g. Union-Find vs. plain DFS-for-components).

**Design:** pure resequencing of whatever SM-2 already marks as due — no
change to scheduling itself. The due-queue query/endpoint reorders results
(e.g. round-robin or bucket-by-domain/category) so consecutive due topics
differ in category/domain wherever the due set allows it.

**Depends on:** reads from the same due-topics query Stage 2's digest
consumes — mild coupling, build Stage 2 first so Stage 3 has a stable
due-queue query to reorder rather than defining it from scratch.

## Stage 4 — Structured notes

**Problem:** the manual topic-edit UI (`apps/web` `TopicDetailPanel.tsx`)
exposes a single free-text `summary` textarea, while the AI-import path
already composes structured notes via `composeSummary()`
(`apps/api/src/import/import.service.ts`) from three fields: key insight,
invariant, and contradiction/watch-out. Manually-written notes don't get
the benefit of that structure.

**Design:** replace the single textarea with the same three fields
(`keyInsight`, `invariant`, `contradiction`) in the manual edit UI, composed
into the stored `summary` via the same `composeSummary()` function so
hand-written and Claude-imported notes are structurally identical. This
stage is about elaboration (explaining why/how a concept works and where it
breaks), a distinct mechanism from Stage 1's retrieval — deliberately not
adding retrieval-style cues (e.g. Cloze deletion) into notes, since that
would duplicate Stage 1's job rather than complementing it.

**Depends on:** fully independent; sequenced last by priority only, not by
technical dependency — could be built any time after this spec.

## Sequencing summary

1. Retrieval prompts (no dependencies)
2. Reminders / Telegram bot (no dependencies, but unlocks the value of 1)
3. Interleaving (builds on 2's due-queue query)
4. Structured notes (fully independent, lowest priority)
