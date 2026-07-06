# Learning-Science Roadmap — Design

> **Status (updated 2026-07-03 — supersedes the present-tense framing below).**
> This spec was written 2026-07-01 as forward-looking sequencing. Three of the
> four stages have since shipped; the problem statements below describe the
> *pre-build* world and are kept for history.
>
> - **Stage 1 — Retrieval prompts: SHIPPED (2026-07-01).** `Prompt` entity with
>   its own SR schedule, `proposedPrompts[]` in the import contract, `ReviewGate`
>   recall-then-reveal, prompt graduation/suspension, write-from-scratch code
>   recall. See `progress.md` ("RETRIEVAL PROMPTS", "PROMPT GRADUATION").
> - **Stage 2 — Reminders (Telegram): SHIPPED (2026-07-02).** grammY digest +
>   streak nudge, per-user hours, deep-link linking. Scope cut to digest+nudge
>   only (no in-Telegram grading) per the 2026-07-02 deep review. See
>   `progress.md` ("TELEGRAM DIGEST").
> - **Stage 3 — Interleaving: SHIPPED (2026-07-03).** Built as the Interleaved
>   Review Session (`interleaveQueue`, `sessionQueue`, in-app `ReviewSession`),
>   not merely a due-queue reorder. See `progress.md` ("Interleaved Review
>   Session"). *This stage's design paragraph below undersold what was built.*
> - **Stage 4 — Structured notes: NOT STARTED, premise stale — see the rewritten
>   Stage 4 section below for the current-reality scope + open product decision.**

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

> **Rewritten 2026-07-03 — the original design (kept at the bottom of this
> section) rested on assumptions that no longer hold. This stage now needs a
> product decision before any plan is written.**

**Original premise (2026-07-01):** the manual topic-edit UI exposes "a single
free-text `summary` textarea" with no structure, unlike AI imports.

**What's actually true now** (`apps/web/src/components/TopicDetailPanel.tsx`,
`apps/api/prisma/schema.prisma`):
- `Topic` carries **three** note-ish fields, all editable in the panel:
  `description` (short blurb), `summary` (the "Written summary (teaching
  condition)" textarea), and `noteRef` (external reference).
- `noteRef` is a full **external-note-system integration** — `User.noteSystem`
  + `Settings.obsidianVault` produce clickable `obsidian://` deep links
  (`noteRefHref`). This has existed since the original 2026-06-30 design, which
  deliberately positions Terrain as **not a note app**: real notes live in
  Obsidian/OneNote, Terrain holds only a short teaching summary + a named
  reference.
- `summary` is **load-bearing for mastery**: the "teaching" condition is
  `summary != null || noteRef != null`.
- `composeSummary()` (keyInsight / invariant / contradiction) and the
  `noteSummaries[]` import contract are **unchanged** — the original mechanism
  is still available if we want it.

**The open decision** (mechanically the original plan still works; the question
is whether it's worth it):
1. **Re-brainstorm** — decide what "better elaboration" means today given
   `description` + `summary` + `noteRef` + Obsidian already exist. Likely
   narrower/different than the 2026-07-01 sketch.
2. **Build as originally specced** — swap the `summary` textarea for the three
   `composeSummary()` fields. Small, ignores the `noteRef`/`description` overlap
   and the "don't be a note app" tension.
3. **Drop the stage** — accept that structured in-app notes fight the Obsidian
   philosophy; close the roadmap at Stage 3 and remove dangling Stage-4
   references (e.g. `2026-07-02-scheduling-core-fsrs-design.md` re: re-adding
   `DailyLog.eveningNote`).

**Depends on:** fully independent. **Decision owner: user (pending).**

---

**Original design text (2026-07-01, retained for history):** replace the single
textarea with the same three fields (`keyInsight`, `invariant`, `contradiction`)
in the manual edit UI, composed into the stored `summary` via the same
`composeSummary()` function so hand-written and Claude-imported notes are
structurally identical. Elaboration (why/how a concept works and where it
breaks), distinct from Stage 1's retrieval — deliberately no Cloze-style cues.

## Sequencing summary

1. Retrieval prompts (no dependencies) — **SHIPPED 2026-07-01**
2. Reminders / Telegram bot (no dependencies, but unlocks the value of 1) — **SHIPPED 2026-07-02**
3. Interleaving (builds on 2's due-queue query) — **SHIPPED 2026-07-03 (as the Interleaved Review Session)**
4. Structured notes (fully independent, lowest priority) — **NOT STARTED; premise stale, decision pending (see Stage 4 above)**
