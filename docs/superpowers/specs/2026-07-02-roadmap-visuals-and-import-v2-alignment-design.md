# Roadmap chapter-node fix + Import screen v2 alignment — design

**Date:** 2026-07-02
**Status:** approved (brainstormed in-session)
**Related:**
- `docs/superpowers/specs/2026-07-02-terrain-next-up-and-roadmap-drilldown-design.md` (introduced the chapter/group node)
- `docs/superpowers/specs/2026-07-02-scheduling-core-fsrs-design.md` (introduced the v2 `learning-os` contract; its final review filed the web Import alignment as a mandatory follow-up)

## Problem

Two defects block a clean daily-learning experience:

1. **Roadmap "redundant squares".** The drill-down rewrite registered the
   collapsed-chapter node under the React Flow type name `'group'`. That name is
   a **built-in React Flow node type**: the node wrapper receives the
   `react-flow__node-group` class, and the stock stylesheet
   (`@xyflow/react/dist/style.css`) applies `width: 150px; padding: 10px;
   border; background` to it. Every chapter therefore renders our `.rf-node`
   card *inside* a misaligned stock frame — the double-box artifact in the
   user's screenshot.

   (Diagnosis note: the sparse two-chapter view in the reporting screenshot was
   the **demo seed account** (`demo@terrain.local`, 9 topics). The real account
   has 100 topics / 18 chapters. The double-frame bug is account-independent.)

2. **Import preview renders stale v1 shapes.** `apps/web/src/api/types.ts`'s
   import-flow types and `screens/Import/sections.tsx` predate the v2
   contract. Against the current backend (`apps/api/src/import/import.service.ts`):
   - Card reviews (`{kind:'card', promptId, topicId, grade, cardPreview}`)
     render with a blank title, a `qundefined` badge (UI expects `quality:
     0–5`), and "no projection" (UI reads `srPreview`, backend sends
     `cardPreview`).
   - `newPrompts` (cards Claude proposes) are **entirely invisible** in the
     preview — the user approves card creation blind.
   - `Unresolved` entries keyed by `ref` (a `promptId` miss) render a blank
     title.
   - The UI still speaks the legacy 0–5 quality scale; the app's real grade
     vocabulary is `again/hard/good/easy`.
   - Backend gap: `ResolvedCardReview` carries only opaque ids — no topic
     title / prompt text — so even a corrected UI cannot label card-review
     rows without a small API enrichment.

## Decisions (user-approved)

- **Roadmap:** keep the drill-down design; fix visuals only. No projection or
  behavior changes.
- **Import:** full v2 alignment, including the backend display enrichment.
  Do not simplify away the preview sections — the unresolved-blocking preview
  is the import loop's safety mechanism.

## Design

### A. Roadmap: rename the chapter node type

Rename the React Flow node type `'group'` → `'chapter'` (a non-reserved name):

- `apps/web/src/screens/Roadmap/index.tsx`: the `nodeTypes` map
  (`{ topic, chapter, ghost }`), group-node construction (`type: 'chapter'`),
  and `onNodeClick`'s `node.type === 'group'` check.
- `apps/web/src/screens/Roadmap/GroupNode.tsx`:
  `type GroupNodeType = Node<GroupNodeData, 'chapter'>`. Component/file names
  stay `GroupNode` (rename of files is churn without benefit).

`'topic'` and `'ghost'` are not reserved names — unchanged. No layout changes:
without the stock frame, chapter cards use the same `.rf-node` sizing
(150–210px) as topic nodes, matching `layout.ts`'s dagre constants (190×56).

### B. Import backend: display enrichment (additive only)

- `ResolvedCardReview` gains `topicTitle: string | null` and
  `promptText: string | null`, populated from the resolved Prompt row (and its
  topic) when `promptId` resolves; `null` on a miss (the row is blocked by an
  `Unresolved` entry anyway).
- `ImportResult` gains `promptsCreated: number` (count of prompts inserted by
  `apply()`), so the post-apply summary can report new cards.
- No change to the `learning-os` v2 Zod contract (`packages/types`) — this is
  server → web plan/result shape only. Existing jest tests extended to assert
  the new fields.

### C. Import web: v2 alignment

- `apps/web/src/api/types.ts`: replace the import-flow types with mirrors of
  the backend's v2 shapes — discriminated `ResolvedReview`
  (`card`/`evidence`), `CardPreview`, `NewPromptPlan`, `Unresolved` with
  optional `title`/`ref`, `ImportPlan.newPrompts`,
  `ImportResult.promptsCreated`. Dates arrive as ISO strings over JSON.
- `apps/web/src/screens/Import/sections.tsx`:
  - Replace the 0–5 `QualityBadge` with a `GradeBadge` for
    `again/hard/good/easy` (again = red, hard = amber, good = green,
    easy = dark green) — same visual language as the app's `GradePicker`.
  - `ReviewRow` splits by `kind`: **card** rows show topic title + prompt-text
    snippet + grade + interval projection from `cardPreview`
    (`intervalBefore → intervalAfter · next <date>`); **evidence** rows show
    topic title + grade + an "evidence" chip and no projection (correct —
    evidence reviews schedule nothing).
  - New `ProposedCardsSection` for `plan.newPrompts`: topic title, kind badge
    (`concept`/`code`/`problem`), prompt text, and difficulty / estimated
    minutes / url chips when present.
  - `UnresolvedPanel` renders ref-only entries as `prompt <ref>` (monospace)
    instead of a blank title.
- `apps/web/src/screens/Import/index.tsx`: render `ProposedCardsSection` in
  the diff stack; add a `promptsCreated` KPI to the apply-result strip.
- Untouched: note summaries, next-session section, paste → preview → apply
  flow (already v2-correct).

## Out of scope

- Any change to the drill-down projection, auto-drill, ghost, or breadcrumb
  behavior (`projection.ts` untouched).
- Any change to the `learning-os` export prompt/contract.
- Simplifying/removing Import preview sections.
- The known accepted minors from prior reviews (dead `useDeletePrompt`, etc.).

## Verification

1. Full monorepo gate: `yarn build && yarn test && yarn lint && yarn format:check`.
2. Live CDP smoke (Brave headless, per `docs/ops/local-dev.md`):
   - Roadmap as the real account: top level shows 18 single-frame chapter
     tiles (no stock `react-flow__node-group` styling), click drills in,
     breadcrumb works.
   - Import preview with a crafted v2 paste containing a card review (real
     promptId from the account), an evidence review, and a proposed prompt —
     assert all three render labeled (title/text/grade), then apply and check
     the result strip includes the prompts-created KPI.
