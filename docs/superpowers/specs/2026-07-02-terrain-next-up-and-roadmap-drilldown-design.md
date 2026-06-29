# Terrain — "Next Up" Guidance + Roadmap Drill-Down — Design Spec

- **Date:** 2026-07-02
- **Status:** Design approved — ready for implementation planning
- **Owner:** Dima (single user)
- **Predecessor specs:** `2026-07-01-terrain-living-roadmap-design.md` (Phase 3 graph UI),
  `2026-07-02-dsa-curriculum-import-design.md` (the 100-topic import that exposed
  this problem)

> After importing the 100-topic / 308-card DSA curriculum, the app answers neither
> "what should I study now?" nor "what does my roadmap look like?". This spec fixes
> both: **Phase 1** adds a guided **Next up** surface with a one-click **Start** verb,
> **Phase 2** makes the Roadmap graph legible at 100+ nodes via chapter drill-down.
> The phases share semantics but are independently shippable.

---

## 0. Problem & governing decisions

**Two root causes (verified against the code):**

1. **No "what's actionable now" surface exists.** The Dashboard's due list only shows
   `active` topics with a set `nextReviewAt`; a freshly imported topic (`planned`,
   cards in `new` state) never appears anywhere actionable. "Starting" a topic today
   is two manual steps hidden in a drawer (flip status, then log a review) — and in
   practice users skip the first step: topics with real review history are still
   sitting at `planned`.
2. **The graph doesn't scale.** One flat dagre layout for ~110 nodes, two edge types
   drawn everywhere (prereq + dashed parent), no grouping — even though the import
   created a clean 3-level hierarchy (root → 18 chapters → 81 patterns) that the
   graph ignores. The domain filter is useless here (all 100 topics share domain
   `DSA`).

**Decisions made during brainstorming (with the user):**

- **Guided, not a menu:** the app recommends exactly **one** next topic. No skip /
  override affordance, no "pick another" list.
- **Curriculum order:** the suggestion follows creation order (`createdAt asc`,
  `id asc` tiebreak), which preserves the authored NeetCode-style chapter order
  01→18 and within-chapter order.
- **Gate = "prerequisites started", not "mastered":** the existing mastered-gate
  would stall progression for weeks under spaced repetition. The `blocked` predicate
  is redefined **app-wide** (one predicate, not two tiers).
- **One spec, two phases:** Phase 1 (Next up) and Phase 2 (graph drill-down) are
  designed together so they share semantics, but implemented and shippable
  separately.
- Repo conventions hold: no git commits by default; no new top-level screens; no
  schema migration is required by this design.

---

## 1. Shared semantics — `startable` replaces the mastered-gate

### 1.1 The predicate

In `MetricsService.topicLabels` (`apps/api/src/metrics/metrics.service.ts`):

```
blocked   = status === 'planned'
            && prerequisiteStatuses.some(s => s !== 'mastered' && s !== 'active')
startable = status === 'planned' && !blocked
```

- Direct prerequisites only, as today (no transitive walk — transitivity emerges
  naturally: a chain unlocks link by link as each topic is started).
- An `archived` or `planned` prerequisite blocks; an `active` or `mastered` one
  does not. "In my review rotation" is the unlock condition.
- This changes the meaning of the red ✗ everywhere it appears (Roadmap, Topics,
  drawer). A fresh import still shows most nodes blocked, but every started topic
  immediately unblocks its direct dependents — the graph visibly opens up as you
  progress.
- `startable` is derived client-side as `status === 'planned' && !labels.blocked`;
  no new API field is needed for it.

### 1.2 Tentative topics are suggestible; Start commits them

All 100 imported topics are currently tentative (`aiProposed: true`). Requiring
manual curation of 100 nodes before Next up works would kill the feature on day
one. Rule: **Next up considers `planned` topics regardless of `aiProposed`, and
the Start action commits the topic** (`aiProposed: false`) as a side effect —
starting a suggestion is the strongest form of "Keep". Graph-level curation
(Keep / Set aside per node) remains available and unchanged for everything not
yet started.

### 1.3 Metrics honesty

`newCardsCount` currently counts `new` cards of every non-archived topic, so ~80
blocked topics' starter cards inflate the Dashboard's "New: N" pill with no way to
study them. Change its topic scope to: **status `active` or `mastered`, or a
startable `planned` topic**. (Blocked planned topics are excluded; archived stays
excluded.) `dueCards` / `dueTopics` are unchanged — due-ness comes from review
history, and after cleanup (§5) studied topics are `active`.

---

## 2. Phase 1 backend — `nextUp` on the dashboard payload

Extend `GET /metrics/dashboard` (`MetricsService.dashboard`) with:

```ts
nextUp: {
  topic: Topic;                 // full topic row, as elsewhere in the payload
  chapterTitle: string | null;  // parent topic's title, null if parentless
  chapterProgress: { started: number; total: number } | null;
  // started = parent's children with status active|mastered; total = child count
} | null
```

Selection: among the user's `planned` topics (any `aiProposed`), ordered by
`createdAt asc, id asc`, return the first whose direct prerequisites are all
`active` or `mastered`. `null` when none qualifies (either nothing planned, or
everything planned is blocked — the two cases are distinguishable client-side
from `counts.planned`).

Domain-scoped dashboard requests (`?domain=`) scope the candidate set the same
way the rest of the payload is scoped.

No new module, controller, or endpoint; no schema change.

---

## 3. Phase 1 web — "Next up" hero card + Start verb

**Placement:** `apps/web/src/screens/Dashboard/index.tsx`, directly under the KPI
row, above "Due for review".

**Content:** chapter context line (`Stack · 2 of 4 started`), topic title, topic
type + ✦ badge if tentative, a short description snippet, and one primary button:
**Start**.

**Start behavior:**
1. `PATCH /topics/:id` with `{ status: 'active', aiProposed: false }` (reuses
   `useUpdateTopic`).
2. On success, open the existing ReviewGate/LogReviewForm modal for that topic —
   the same component the due-list "Log" button uses. `PromptsService.next`
   already falls back to the topic's `new` starter cards, so the user is grading
   their first card in one click. The first logged review materializes
   `Topic.nextReviewAt`, feeding the normal due flow thereafter.
3. Query invalidation (existing `useInvalidateAll`) refreshes the dashboard, so
   the card advances to the next suggestion immediately.

**Empty states:**
- `nextUp === null` and `counts.planned > 0` → muted card: "All remaining topics
  are blocked — keep reviewing to unlock them."
- `nextUp === null` and `counts.planned === 0` → card hidden entirely.

---

## 4. Phase 2 web — Roadmap chapter drill-down

Pure client-side re-projection in `apps/web/src/screens/Roadmap/*`. **No backend
work in this phase.**

### 4.1 View model

- The screen holds a **focus** stack (breadcrumb), not persisted. The canvas
  renders the **children of the current focus**; at the root level, all
  parentless topics (after the existing domain / parked filters).
- A visible topic **with children** renders as a **group node**; a childless one
  renders as today's `TopicNode`.
- **Click a group node → drill in** (push onto breadcrumb, e.g.
  `All › Data Structures & Algorithms › Trees`). Click a leaf → detail drawer,
  as today. Breadcrumb segments navigate back up.
- **Auto-drill:** if the root level would render exactly one group node and
  nothing else, start focused on it (breadcrumb still shows the full path), so
  the first paint of the DSA graph is the 18 chapters.
- Dagre lays out each level independently (`rankdir: 'LR'` as today) — ~20 nodes
  per level instead of ~110.

### 4.2 Group node face

- Title + type glyph.
- Subtree progress: `<started+mastered>/<total>` over the **whole subtree** (the
  chapter topic itself plus all descendants — chapters are real topics with cards).
- `▶ N startable` pill when the subtree contains startable topics.
- `✦ N` badge when the subtree contains uncurated tentative topics (imports must
  not become invisible when collapsed).
- The group containing the global next-up topic gets a **"Next up" ring**; at
  leaf level the next-up topic itself gets it.

### 4.3 Edges

- **Prerequisite edges aggregate by subtree:** for visible nodes A ≠ B, draw one
  A→B edge iff any topic in subtree(A) is a prerequisite of any topic in
  subtree(B). Aggregated (group-level) edges are non-selectable and
  non-deletable; leaf↔leaf edges keep today's behavior (selectable, Delete key
  removes the prereq).
- **Parent edges are eliminated by construction** — at a drilled level every
  visible node shares the focus as parent, and at collapsed levels containment
  is expressed by the grouping itself. The dashed/animated parent edge type is
  removed from the graph entirely.
- **Ghost nodes for external prerequisites:** when a visible leaf has a direct
  prerequisite outside the current level, render that prerequisite as a dimmed,
  non-editable ghost node labeled with its chapter. Clicking a ghost navigates
  to its chapter with the node selected.

### 4.4 Gestures (Phase 3 features, scoped per level)

- **Connect** (add prerequisite): leaf↔leaf at the same level, as today. Handles
  are disabled on group nodes and ghosts.
- **Drag-to-reparent:** dropping a leaf onto a sibling leaf or onto a **group
  node** reparents into it (`PATCH {parentId}`), with the existing 422
  cycle-guard/toast/snap-back behavior. **Changed:** dropping on empty canvas
  inside a drilled level is a **no-op snap-back** (previously un-parent) —
  un-parenting would silently teleport the node out of view. Un-parenting
  remains available from the detail drawer.
- **Curation** (Keep / Set aside hover controls on tentative leaves), the parked
  shelf toggle, the domain segmented control, and the legend all work unchanged.
  Parked nodes appear at their proper level when the shelf is on.

### 4.5 Emphasis

Mastered and blocked leaves render at reduced opacity; startable and active
leaves at full strength. (The legend gains no new entries; the existing four
statuses + blocked ✗ + tentative ✦ still cover everything.)

---

## 5. Data cleanup precondition (one-off, before Phase 1 ships)

Discovered during design, in the live DB:

- The import created **7 tentative duplicates** of topics that already existed
  committed with the same titles in domain `DSA` (root, Arrays & Hashing, Two
  Pointers, Prefix sums, Opposite-direction pointers, Hashing fundamentals,
  Two Sum / complement lookup). The committed originals carry real history
  (17 reviews, 16 cards); the tentative twins have 0 reviews / 20 cards.
- Several studied topics still sit at `status: 'planned'` (the missing Start
  verb in action) — they must become `active` or the new `blocked` predicate
  and `dueTopics` misclassify them.

One-off script in `scripts/` (`.mjs`, same style as `import-dsa.mjs`):

1. For each duplicate title within a (userId, domain): keep the topic with
   review history, **re-point prerequisite edges** referencing the tentative
   twin (both directions) to the survivor, re-point `parentId` of the twin's
   children to the survivor, then delete the twin (deletable — no reviews).
2. Set `status: 'active'` on any `planned` topic that has ≥1 review.
3. Idempotent; prints a summary; makes no changes when nothing matches.

Hardening the import service against title duplicates is **out of scope**
(follow-up candidate).

---

## 6. Testing & verification

**API (jest, existing suite style):**
- `topicLabels`: planned + prereq `active` → not blocked; planned + prereq
  `planned`/`archived` → blocked; planned + all prereqs `mastered` → not
  blocked; non-planned never blocked.
- `nextUp`: returns first startable planned topic in creation order; skips
  blocked; includes tentative; `null` when all planned are blocked and when no
  planned exist; chapter progress counts correct; domain scoping.
- `newCardsCount`: excludes blocked planned topics' cards; includes startable
  planned, active, mastered; still excludes archived and suspended.

**Web:** `yarn workspace @terrain/web build` (tsc + vite build) green.

**UI smoke (headless Brave/CDP per `docs/ops/local-dev.md`):**
- Dashboard shows the Next up card (after cleanup, the first suggestion should
  be the earliest-created startable DSA topic); Start opens the first card;
  grading it advances the card to the next suggestion.
- Roadmap first paint shows the 18 chapter group nodes (auto-drilled), with
  progress/startable/✦ badges; drill into Stack → 4 leaves, no parent edges;
  ghost prereq navigates across chapters; breadcrumb returns; reparent onto a
  group node works; canvas-drop no-ops.

**Gates:** `yarn workspace @terrain/api test` green + `nest build` 0 errors;
web build 0 errors; live boot smoke. Kill the dev API with
`kill -9 $(lsof -ti:3000)` (not `pkill`).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Redefined `blocked` surprises existing UI copy ("Blocked" tooltip semantics) | The change is intentional and app-wide; legend/tooltip copy stays "Blocked" — only the unlock condition changed. Jest pins the new truth table. |
| Next up suggests a stale pre-import topic first | Selection is honest creation order; cleanup (§5) merges duplicates. Anything else the user doesn't want suggested can be parked/archived — data curation, not code. |
| Start's two-step (PATCH then modal) leaves an activated topic unstudied if the user closes the modal | Acceptable: the topic is `active` with `new` cards; `newCardsCount` still counts it and its drawer studies it. Next up simply advances — no dangling state. |
| Aggregated edges hide *which* topic blocks a chapter | Drill-in + ghost nodes show the concrete blocker one click deep; the drawer lists direct prerequisites as today. |
| Group-node drop target conflicts with drill-on-click | Drill triggers on click (no drag); reparent triggers on `onNodeDragStop` intersection — distinct gestures, same as Phase 3's click-vs-drag split. |
| Dagre level-local layout makes cross-level mental mapping harder | Breadcrumb + ghost-node navigation keep orientation; positions were never stable across renders anyway (Phase 3 decision). |

---

## 8. Out of scope

- Skip/override or "pick another" affordances on Next up.
- Bulk "Keep all" curation action.
- Import-service dedup hardening (title-match or warn on collision).
- Persisting drill-in focus (URL or server).
- Transitive/multi-hop blocked computation.
- Any schema migration; Telegram bot (1c); everything deferred in prior specs.
