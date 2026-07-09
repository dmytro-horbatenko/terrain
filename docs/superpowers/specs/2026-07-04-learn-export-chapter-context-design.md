# Learn-Export Chapter Context & Roadmap-Extension Prompting — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm 2026-07-04)

## Problem

A `mode=learn` export's `LEARNING GOAL` focus topic is one specific
sub-pattern (e.g. "Hashing fundamentals"), but `generateLearn()` currently
attaches the **entire domain roadmap** — all ~100 DSA topics across every
chapter, rendered as a full nested tree via `roadmap()` — as orientation
context. This is mostly noise for a session about one narrow topic: the
model already gets precise prerequisite context via the "Builds on" list
(with per-topic summaries), and chapter progress is already a one-line stat
(`Chapter: X · N of M started`). Two concrete costs of the full dump:

1. It burns tokens on ~99 irrelevant topics per session.
2. It's an active distraction: in a live session, the model treated the
   full tree as more salient than the one-topic focus and, on top of a since-fixed
   `nextUp()` bug that had picked the domain root as focus, effectively
   abandoned the session's directive to just narrate roadmap status instead
   of teaching.

Separately, Terrain already has a mechanism for a learning session to
propose new roadmap topics (`proposedTopics` in the `learning-os` v2
contract, wired through `import.service.ts` into real `planned` topics with
prerequisite/parent edges — the same path used to author the original DSA
curriculum). But `LEARN_CONDUCT` never tells the model this capability
exists or when to use it, so in practice it's dormant unless the model
spontaneously decides to populate that field. There's also no way to ask
the model mid-chat "should we add X as a follow-up topic" and expect it to
either act on that or push back with a real opinion, because nothing
scripts that exchange.

## Solution overview

Replace the full-domain roadmap section in `learn` exports with a narrower
**chapter context**: the focus topic's siblings (other topics under the
same parent chapter) and that chapter's own direct prerequisite chapters,
both rendered as flat lists (title + status glyph), not a recursive tree.
Drop the now-redundant `Chapter: X · N of M started` line from `LEARNING
GOAL` since the sibling list shows this directly. Add an explicit
instruction to `LEARN_CONDUCT` inviting the model to propose genuinely
related/deeper topics via the existing `proposedTopics` field — both
unprompted when relevant and with a real opinion when asked directly — and
surface proposed topics by title (not just a count) on the review screen so
a bad proposal is easy to catch before saving.

`repeat` mode is unaffected — it's already deliberately roadmap-free to
keep that chat on-script.

## Scope

**In scope:**
- New `## CHAPTER CONTEXT` section in `generateLearn()`'s export, replacing
  `## ROADMAP — <domain>` in learn mode only: siblings under the focus's
  parent chapter, and the chapter's own direct prerequisite chapters — both
  flat, reusing the existing `glyph()`/`reviewingTag()` rendering.
- Removing the `Chapter: X · N of M started` line from the `LEARNING GOAL`
  section (superseded by the sibling list).
- `LEARN_CONDUCT` wording addition: propose a related/deeper topic via
  `proposedTopics` when one genuinely comes up, and give a real yes/no
  opinion (not reflexive agreement) if the user asks about adding one.
- Review screen (`apps/web/src/screens/Session/index.tsx`, `step ===
  'review'`): list each proposed topic's title + parent chapter +
  prerequisite titles, using data already present on `NewTopicPlan` — no
  API or type changes.
- Updated/added `export-generator.service.spec.ts` coverage for the new
  section (siblings + prereq chapters, empty-prereq case, no-parent case)
  and confirming the full-domain tree is gone from `learn` output.

**Out of scope:**
- `repeat` mode — no roadmap today, stays that way.
- Per-topic accept/reject checkboxes on the review screen. If a proposed
  topic is unwanted, the user edits the pasted `learning-os` block before
  Preview/Save — matches existing behavior for the whole plan.
- Any change to the `proposedTopics` → `import.service.ts` creation
  pipeline (prerequisite/parent wiring, `aiProposed: true`, `planned`
  status) — it already works correctly and needs no changes.
- Any change to `full` or `domain:<x>` export modes.
- A cap on how many topics a session may propose, or new curation UI beyond
  what Phase 3 (living roadmap) already provides (archiving unwanted
  `aiProposed` topics).
- Multi-domain or cross-chapter suggestions beyond what the model
  reasonably infers from chapter context — no new domain-modeling for
  "related topic" detection.

## Design

### 1. `## CHAPTER CONTEXT` section (replaces the full roadmap in `learn` mode)

In `export-generator.service.ts`, `generateLearn()`'s `focus` query currently
includes:

```ts
parent: { select: { title: true, children: { select: { status: true } } } },
```

Extend this to also pull the parent's own prerequisites:

```ts
parent: {
  select: {
    title: true,
    children: { select: { status: true } },
    prerequisites: { include: { prerequisite: { select: { id: true } } } },
  },
},
```

Replace the current `domainTopics` query (which fetches the whole domain)
with a narrower one scoped to exactly what's needed to render this section:
siblings (topics with `parentId === focus.parentId`) plus the chapter's
direct prerequisite topics (by id), using the same `TopicWithPrereqs`
include shape (`prerequisites` + `prompts`) so `glyph()`/`reviewingTag()`
work unchanged. Skip the query entirely (render nothing) when
`focus.parentId` is null (a topic with no chapter).

Render as a new private method, e.g. `chapterContext()`, producing:

```
## CHAPTER CONTEXT
In this chapter (Arrays & Hashing):
○ Two Sum / complement lookup
✗ Prefix sums
✗ Sorting-based array tricks

Builds on (chapters):
✓ Arrays & Hashing
```

(The "Builds on (chapters)" list is omitted entirely — not rendered with a
placeholder — when the chapter has no prerequisite chapters, e.g. an entry
chapter like "Arrays & Hashing" itself.) This section
replaces `this.roadmap(domainTopics...)` in the `sections` array built by
`generateLearn()`. `full` and `domain:<x>` modes keep using `roadmap()`
over the complete topic set, unchanged.

### 2. Drop the redundant chapter-progress line

In the `goal` array building code (`generateLearn()`, the block that pushes
`Chapter: ${focus.parent.title} · ${started} of ${focus.parent.children.length} in this chapter started`),
remove that line. The chapter title and sibling statuses are now visible
directly in `## CHAPTER CONTEXT`; `LEARNING GOAL` keeps `Topic:`,
`Description:`, `AI context:`, "Builds on (your existing knowledge)", and
"Existing cards" as today.

### 3. `LEARN_CONDUCT` prompting for roadmap extension

Add to `session-conduct.ts`'s `LEARN_CONDUCT`, near step 5 (the
`learning-os` block instructions): if a genuinely related or meaningfully
deeper topic comes up naturally while teaching, propose it via
`proposedTopics` (with real `prerequisiteTitles`/`parentTitle` wiring) —
don't manufacture unrelated topics just to fill the field, and don't stay
silent about one that's genuinely relevant. If the user directly asks
whether to add a topic, give a real opinion (yes/no + why), not reflexive
agreement.

### 4. Review screen: list proposed topics

In `SessionWizard`'s `step === 'review'` block
(`apps/web/src/screens/Session/index.tsx`), below the existing
`stat-strip`, add a small list rendering each `plan.newTopics.filter(t =>
!t.alreadyExists)` entry: title, `under {parentTitle}` when present,
`requires: {prerequisiteTitles.join(', ')}` when non-empty. All fields
already exist on `NewTopicPlan` (`apps/web/src/api/types.ts`) — purely
presentational, no type or API change.

## Testing

- `export-generator.service.spec.ts`: cover `chapterContext()` — siblings
  rendering, prerequisite-chapters rendering, the no-prerequisite-chapters
  case, and the no-parent case (renders nothing / omits the section).
  Confirm `learn`-mode output no longer contains the full multi-chapter
  tree that `full`/`domain:<x>` modes still produce.
- No new test for the `LEARN_CONDUCT` string change — static content, same
  convention as the rest of that file.
- Review-screen list: manually verify via the browser (paste a plan with a
  `proposedTopics` entry through Preview, confirm the list renders) —
  matches how that screen is verified today; no existing component test
  file to extend.
