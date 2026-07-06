# Session-Driven Learning — Making the Claude Session Do the Teaching — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorm 2026-07-03)
**Supersedes:** Stage 4 ("Structured notes") of
`docs/superpowers/specs/2026-07-01-learning-science-roadmap-design.md`. That
stage's premise — "make the manual summary textarea structured" — was found
stale and low-leverage (structured summarization is a *low-utility* technique;
the manual field is passive and unreviewed). This design replaces it.

**Scope:** `apps/api` session-conduct + output-contract + import; one additive
field on the `learning-os` v2 import contract (`packages/types`); `apps/web`
Topic detail + Import screens. No DB migration, no in-app LLM calls, no change
to FSRS or self-graded recall.

## Problem

Terrain's architecture is deliberate: the app is a context store and scheduler;
Claude.ai is the intelligence (no in-app LLM calls). But the *content-bearing*
cognitive work is currently mis-placed:

1. **The Claude session is instructed to teach but not to examine or force
   work.** `REPEAT_CONDUCT`/`OUTPUT_CONTRACT` even tell Claude to give feedback
   and then step back: *"ask me to grade my own recall… never substitute your
   own judgment."* Self-grading recall is fine (see Non-goals), but the session
   never forces the learner to **reconstruct and justify** (elaboration /
   self-explanation) or to **actually do** the thing (apply it).
2. **Passive in-app fields stand in for that work.** The manual `summary`
   textarea asks the user to write a note that nobody reads or checks — "fill it
   and maybe you're right, maybe wrong, no one reviews." Elaboration and
   summarization should happen *in the session*, driven by Claude, not typed
   into a lonely field.
3. **"Doing" can't flow back from a session.** Mastery's *application* condition
   (`appEventCount ≥ 1`) can only be satisfied by manually clicking in the web
   `AppEventsPanel`. A session that made the learner solve a novel problem has
   no way to record it — another passive in-app action Claude should drive.

The learning-science framing: the app already ships every *high*-utility
technique (retrieval practice via prompts + ReviewGate; distributed practice via
FSRS + reminders; interleaving). The remaining moderate-utility levers —
**elaborative interrogation** and **self-explanation** — are generative acts
that belong inside the session, not a notes field. This design routes them there
and captures the outcome.

## Decision

Move all content-bearing cognitive work — teaching, elaboration,
application-checking, summarizing — into the Claude session, driven by a strong
enough brief that the session *forces* the learner to reconstruct, justify, and
do. The app captures what the session produced. The learner keeps self-grading
recall.

### Principles / guardrails

- No in-app LLM calls — all intelligence stays in the Claude session.
- Self-graded FSRS recall is unchanged: the `again|hard|good|easy` grade remains
  the learner's own verdict, recorded verbatim, never Claude's.
- Notes stay a **thin index into external tools**: the rich conspect (Obsidian)
  and drawings (OneNote) live externally; Terrain holds only a brief
  pointer-summary + one `noteRef`. No multi-ref notes schema.

### Part 1 — The session arc (conduct rewrite)

Both conduct scripts specialize one arc. The two genuinely new *forcing* moves
are **teach-back elaboration** and **do-and-capture**.

**`LEARN_CONDUCT` (new topic):**
1. **Teach** — Socratic, questions-before-explanations, enforce confusion time,
   connect to the listed prerequisites. *(kept from today)*
2. **Elaborate / teach-back** — the learner explains the concept back in their
   own words: why it works, the invariant, where it breaks. Claude probes gaps
   rather than accepting a fluent-sounding restatement.
3. **Do** — the learner implements-from-scratch or solves a novel variant fit to
   the topic type; Claude checks the result. A genuinely solved novel problem
   becomes an `applicationEvents` entry (Part 2).
4. **Conspect** — Claude writes an Obsidian-ready conspect as chat *prose* for
   the learner to paste into Obsidian, and describes any OneNote drawing. Depth
   lives here, not in the return block.
5. **Return block** — `proposedPrompts` (3–7 atomic), a **terse** `noteSummaries`
   pointer (Part 3), `studiedTopics`, `applicationEvents`, `nextSession`.

**`REPEAT_CONDUCT` (due cards):**
1. **Quiz** each due card one at a time; show the prompt, wait for the attempt,
   never reveal early; then brief feedback. *(kept)*
2. **Self-grade** — the learner grades recall `again|hard|good|easy`, recorded
   verbatim. *(kept)*
3. **Elaborate on misses** — for any card graded `again`/`hard`, the learner must
   briefly explain the correct reasoning before advancing (deepen the miss).
4. **Do when relevant** — an application-worthy due topic with no application
   event yet gets a novel problem; solved → an `applicationEvents` entry.
5. **Return block** — `reviews` (with the learner's grades), `applicationEvents`,
   `noteSummaries` only when a summary is genuinely refined, `nextSession`.

### Part 2 — `applicationEvents` contract & import path

The one capability addition: let a session record the "doing" that mastery's
*application* gate requires. **No DB migration** — the `ApplicationEvent` model
already exists (`{ userId, topicId, kind, description, url?, appliedAt }`); this
only opens an import path to it.

**Contract (`packages/types/src/index.ts`).** New array on `learningOsV2Schema`,
mirroring the existing `ApplicationEvent` shape and reusing `AppEventKind`:

```ts
const applicationEventSchema = z
  .object({
    topicTitle: z.string().min(1).max(300),
    kind: z.enum(['project_usage', 'problem_solved', 'audit_exercise', 'real_debugging']),
    description: z.string().min(1).max(2000),
    url: z.string().url().max(500).optional(),
  })
  .strict();

// in learningOsV2Schema:
applicationEvents: z.array(applicationEventSchema).max(50).default([]),
```

Version stays `2` — purely additive with `.default([])`, so pre-existing blocks
still parse. For DSA-style sessions `kind` will almost always be
`problem_solved`.

**Import path (`apps/api/src/import/import.service.ts`).** Follows the exact
pattern the other arrays already use:
- **Resolve** each `topicTitle` against existing DB topics ∪ in-batch
  `proposedTopics`, using the same title-normalization helper as
  `noteSummaries`/`reviews`. An unresolved title goes to the `unresolved` panel
  and **blocks apply** (all-or-nothing, matching today's behavior).
- **Apply** (inside the existing single `$transaction`): create `ApplicationEvent`
  rows with `userId`, resolved `topicId`, `kind`, `description`, `url ?? null`.
- **Dedup**: collapse identical `(topicTitle, kind, description)` entries in
  `buildPlan`, mirroring the existing proposed-topic / prerequisite dedup, so a
  re-pasted block doesn't double-insert.
- **Result**: `ImportResult` gains `appEventsApplied: number`.

**Mastery effect.** Once a row exists, `masteryStatus({ appEventCount })` sees
`count ≥ 1` and the *application* condition flips to ✓. The mastery logic itself
is unchanged — it just gets fed from sessions now.

**Distinction from evidence-reviews.** A `reviews[]` entry with only
`topicTitle` (evidence review) records that a topic was *worked on* but moves no
schedule and is not application. An `applicationEvents[]` entry records that it
was *applied* (solved/used) and counts toward mastery. Different signals, kept
separate.

### Part 3 — Notes as a thin external index

No schema change; single `noteRef`; existing `noteSummaries` shape retained. The
shift is in guidance and emphasis.

- **Conduct guidance (the real lever):** Claude puts depth in the Obsidian
  conspect (chat prose) and keeps the `noteSummaries` entry terse — `keyInsight`
  is a 1–2 sentence index, not a full explanation; `invariant`/`contradiction`
  only when genuinely sharp; `suggestedNoteRef` names the primary Obsidian
  location. Secondary artifacts (a OneNote drawing) are named *inside the summary
  prose*, not given a field — e.g. *"Monotonic stack keeps a decreasing
  invariant — full conspect in Obsidian: DSA/Stacks/Monotonic; flow sketch in
  OneNote > DSA > Stacks."*
- **`composeSummary()` is unchanged** (`**Key insight:** … **Invariant:** …
  **Watch out:** …`); imported and any manual notes still render identically —
  we only feed it pointer-sized content.
- **`suggestedNoteRef` → `noteRef`** on import continues to pre-fill the primary
  reference (already the behavior).
- **No multi-ref schema.** Splitting Obsidian vs OneNote into separate columns is
  over-build; one `noteRef` + prose for secondaries keeps Terrain an index, not a
  note manager. A structured multi-ref model remains a clean additive follow-up
  if ever wanted.

### Part 4 — Web changes

- **`apps/web/src/components/TopicDetailPanel.tsx` — retire passive
  note-authoring.** The "Notes & reference" section today shows a blank `summary`
  textarea the user is expected to fill. Instead:
  - Render Claude's `summary` as **read-only** markdown content — the user reads
    the index-summary, does not author it blind.
  - Keep `noteRef` editable with its Obsidian deep-link (a pointer the user may
    legitimately adjust).
  - **Decision: A (demote, not remove).** Manual `summary` editing survives only
    behind a collapsible "Edit summary manually" disclosure — for typo fixes /
    offline edits — so the default surface communicates "notes come from
    sessions" without painting the user into a re-import-only corner.
- **Import screen (`apps/web/src/screens/Import/`)** gains an **application-events
  KPI** in the existing result stat strip (next to `promptsCreated`/`reviews`),
  so an imported session visibly reports the events it recorded. `apps/web`'s
  `ImportResult` / `ApplicationEvent` mirror types in `api/types.ts` are updated
  to match the backend.
- **Mastery display** needs no change — the teaching/application checks already
  render; they simply start being satisfied from sessions instead of manual
  clicks.

## Non-goals

- No in-app LLM calls; no change to FSRS scheduling or self-graded recall.
- No correctness-verdict field — Claude gives feedback in-chat but records no
  grade of its own.
- No multi-ref notes schema (single `noteRef` + prose for secondaries).
- No Obsidian/OneNote sync — named reference only, as today.
- No DB migration — `ApplicationEvent` already exists.

## Testing

- **`packages/types` (vitest):** `applicationEventSchema` — valid entry parses;
  missing `description` / bad `kind` / bad `url` rejected; `applicationEvents`
  defaults to `[]` when omitted (old blocks still parse).
- **`import.service.spec` (jest):** application events resolve against existing +
  in-batch topics; an unresolved title blocks apply with no partial writes;
  duplicate `(topicTitle, kind, description)` deduped; `appEventsApplied`
  counted; a solved-problem block flips `masteryStatus.application` to ✓.
- **`session-conduct` / `output-contract` (jest text assertions, matching the
  existing specs):** the contract documents `applicationEvents`; both conduct
  scripts contain the elaboration/teach-back and do-and-capture steps; the
  grade-is-yours rule is preserved; notes-stay-terse guidance present.
- **`apps/web` (tsc gate):** `yarn workspace @terrain/web build` — mirror types
  compile; TopicDetailPanel renders.
- **Full gate + live smoke:** `yarn build && yarn test && yarn lint &&
  yarn format:check`, then one end-to-end learn session — copy the `learn`
  export, run the arc in Claude, import a block containing `applicationEvents` +
  a terse `noteSummaries`, confirm the event lands, mastery *application* flips,
  and the panel shows the read-only summary.

## Files touched

- `packages/types/src/index.ts` (+ tests)
- `apps/api/src/sessions/session-conduct.ts`
- `apps/api/src/sessions/output-contract.ts`
- `apps/api/src/import/import.service.ts` (+ `import.service.spec.ts`)
- `apps/api/src/sessions/{session-conduct,output-contract}.spec.ts` (text assertions)
- `apps/web/src/api/types.ts`
- `apps/web/src/components/TopicDetailPanel.tsx`
- `apps/web/src/screens/Import/` (result KPI)

## Repo convention

Per `CLAUDE.md` and standing user preference, work stays **uncommitted** in the
working tree — no git commits (this doc included) unless explicitly requested.
