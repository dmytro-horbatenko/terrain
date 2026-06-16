# Terrain — Phase 3: Living, Editable Roadmap — Design Spec

- **Date:** 2026-07-01
- **Status:** Design approved — ready for implementation planning
- **Owner:** Dima (single user)
- **Predecessor specs:** `2026-06-30-terrain-design.md` (§8 roadmap graph, §5–6 export/contract),
  `2026-06-30-terrain-import-design.md`, `2026-06-30-terrain-modernization-web.md`

> Turn the read-only Phase-2 roadmap into a **living, directly-editable knowledge
> graph**, and make imported Claude suggestions **curatable** in place. There is
> **no AI in the app** — the "AI" is the user talking to Claude.ai in a chat. The
> loop stays: export graph → paste into Claude → discuss → paste the `learning-os`
> block back → import. This phase is about curating what comes back and restructuring
> the graph by hand, plus enriching the export so that round-trip carries more context.

---

## 0. Mental model & governing decisions

**The round-trip is the only AI surface.** Imported `proposedTopics` are suggestions
from a Claude.ai conversation, not app-generated content. "Approve/reject" is therefore
**user curation of an import**, not an in-app AI action, and the language throughout the
UI reflects that (a ✦ node is "from Claude / imported", never "AI in the app").

**The whole graph is editable.** Not just tentative nodes — every topic can be
reparented, re-linked (prerequisites), fully edited, and deleted directly from the
Roadmap.

**Rejected ideas are retained, then rebuilt-from, then deleted.** Set-aside suggestions
are *parked* (kept, hidden from the active graph), flow back into context exports so the
user can ask Claude to rebuild the roadmap from them, and can later be deleted permanently.

**Positions are never persisted.** The graph remains a pure projection over `Topic` +
`Prerequisite`; dagre re-lays-out every render. Dragging is a *gesture* (reparent /
connect), not free positioning — a dragged node snaps to its new dagre position after the
structural change lands.

---

## 1. Goals & non-goals

**Goals**
1. Curate imported suggestions on the graph: **Keep**, **Set aside** (park), **Restore**, **Delete permanently**.
2. **Drag-to-reparent** topics, with server-side cycle protection.
3. **Drag-to-edit prerequisites** (add/remove DAG edges), with cycle protection.
4. **Full node editing** from the detail drawer (title/domain/type/description — currently not editable).
5. **Richer context exports**: parked ideas, per-node AI context, and recent-session history.

**Non-goals**
- No in-app AI / API calls anywhere. The export/import round-trip is unchanged in shape.
- No persisted node positions / manual layout. Dagre still owns layout.
- No new top-level screens. Everything lands on the existing Roadmap + its detail drawer + the Export generator.
- No git commits — work stays uncommitted in the working tree (standing preference).
- **Explicitly out of scope** (tracked as a separate follow-up sweep): Settings write UI,
  the `StreakState.lastEvaluatedDate` and `SessionExport.domains` bugs, the scaffold
  `GET /` "Hello World", and dead-code cleanup (`useReviews`, `Sparkline`).

---

## 2. State semantics — no migration required

A topic's curation lifecycle is expressed entirely with two **existing** fields
(`Topic.aiProposed: boolean`, `Topic.status: TopicStatus`). No schema change, no migration.

| State | Meaning | `aiProposed` | `status` |
|---|---|---|---|
| **Tentative** | Imported suggestion, awaiting curation | `true` | `planned` |
| **Committed** | Kept — an ordinary node | `false` | any |
| **Parked** | Set aside, retained for later rebuild | `true` | `archived` |
| **Deleted** | Removed permanently | — | (row gone) |

Derived rules:
- **Active graph** = topics with `status != archived`. Tentative nodes appear here (dashed + ✦); parked and ordinary-archived nodes do not.
- **Parked shelf** = topics with `aiProposed == true && status == archived`. (Ordinary archived topics — `aiProposed == false && status == archived` — are *not* shown in the shelf; they remain simply hidden. Surfacing general archived topics is out of scope.)

Import already sets `aiProposed: true` on applied `proposedTopics`, so after an import they
are tentative with no further backend change.

---

## 3. Backend design (Topics module)

All changes live in `apps/api/src/topics` unless noted. No new module.

### 3.1 Curation via the existing update path
Add one optional field to `UpdateTopicDto`:
- `@IsOptional() @IsBoolean() aiProposed?: boolean`

Curation actions then map to `PATCH /topics/:id`:
| Action | Request |
|---|---|
| Keep (commit) | `PATCH {aiProposed:false}` |
| Set aside (park) | `PATCH {status:'archived'}` (aiProposed stays true) |
| Restore | `PATCH {status:'planned'}` |

(The full node editor also uses `PATCH /topics/:id` — `title/domain/topicType/description`
are already accepted by `UpdateTopicDto`; `topicType` continues to auto-register in the
soft vocabulary via `registerType`.)

### 3.2 Cycle-safe reparent
`TopicsService.update()` gains a guard that runs **only when `parentId` is present in the DTO**:
- `parentId === id` → **422** (`UnprocessableEntityException`, "a topic cannot be its own parent").
- Otherwise walk the ancestor chain from the proposed parent upward via `parentId`; if it
  reaches `id`, the move would create a cycle → **422** ("reparenting would create a cycle").
- `parentId: null` (un-parent) is always allowed.
- A non-existent `parentId` → **404**.

The walk is a bounded loop over `topic.parentId` lookups (the tree is small, single-user);
guard against malformed data with a visited-set to avoid infinite loops on any pre-existing cycle.

### 3.3 Prerequisite editing (new endpoints)
The `Prerequisite` DAG currently has no mutation surface (edges are only created at import).
Add two endpoints on the Topics controller, backed by `TopicsService`:

- `POST /topics/:id/prerequisites` body `{ prerequisiteId: string }` → creates
  `Prerequisite(topicId=:id, prerequisiteId)` meaning **":id requires prerequisiteId"**.
- `DELETE /topics/:id/prerequisites/:prerequisiteId` → removes that edge.

Guards (add):
- Either topic missing → **404**.
- `prerequisiteId === :id` → **422** (self-prerequisite).
- **DAG cycle** → **422**: adding ":id requires R" is a cycle iff R already (transitively)
  requires :id. Walk the *requires-closure* of R (follow `Prerequisite.prerequisiteId`
  edges outward from R); if it reaches `:id`, reject. Visited-set bounded.
- Duplicate edge → **idempotent 200/201** (composite PK `[topicId, prerequisiteId]` already
  guarantees uniqueness; upsert-style so a repeat is a no-op, never a 500).
- `DELETE` of a non-existent edge → idempotent (204/200), not 404.

DTO: `class AddPrerequisiteDto { @IsString() prerequisiteId!: string }`.

### 3.4 Delete rule made usable
Today `remove()` rethrows any FK violation (P2003) as **409** — so a topic with prerequisite
edges can never be deleted, only archived. Rewrite the rule to serve "deletable" while still
protecting learning history:

> **A topic that has review or application-event history must be archived (409).
> Any topic without that history can be deleted** — cascading its structural graph edges.

`remove(id)`:
1. Load the topic with `_count` of `reviews` and `appEvents`.
2. If `reviews > 0 || appEvents > 0` → **409** (`ConflictException`, "has review/application
   history — archive it instead of deleting").
3. Otherwise, in one `$transaction`: delete `Prerequisite` rows where `topicId == id` **or**
   `prerequisiteId == id`; null-out children (`update where parentId==id set parentId=null` —
   Prisma's optional-relation `SetNull` also covers this, but do it explicitly for clarity);
   then delete the topic row.

This lets parked ideas (no reviews, no app events) delete cleanly while real learning nodes
stay protected. `newTopicsCreated` audit arrays on `SessionExport` are plain string arrays
(no FK) and are unaffected.

### 3.5 Endpoint / status summary

| Method & route | Purpose | Notable statuses |
|---|---|---|
| `PATCH /topics/:id` | edit fields, keep/park/restore, reparent | 200; 404 missing; 422 cycle/self-parent |
| `DELETE /topics/:id` | permanent delete | 200; 409 has review/app history |
| `POST /topics/:id/prerequisites` | add requires-edge | 200/201; 404; 422 self/cycle; idempotent on dup |
| `DELETE /topics/:id/prerequisites/:prerequisiteId` | remove requires-edge | 200/204; idempotent if absent |

---

## 4. Roadmap graph interactions (`apps/web`)

All changes land in `apps/web/src/screens/Roadmap/*`, the detail drawer/components, and the
api client/hooks. The graph stays a projection of `useTopics()` data.

### 4.1 Tentative-node curation
- Tentative nodes (`aiProposed && status!='archived'`) render with a **dashed border + ✦**.
- On hover, inline controls: **✓ Keep** and **✗ Set aside**.
- `aiContext` is shown as a hover tooltip on the node.
- Keep → `PATCH {aiProposed:false}`; Set aside → `PATCH {status:'archived'}`.

### 4.2 Parked-ideas shelf
- A **"Parked ideas (N)" toggle** in the Roadmap toolbar. Off by default.
- When on, parked nodes (`aiProposed && status=='archived'`) render greyed/muted within the
  graph (or a side list — implementer's call, greyed nodes preferred for "rebuild in context"),
  each with **Restore** (`PATCH {status:'planned'}`) and **Delete permanently**
  (`DELETE /topics/:id`, with a confirm).

### 4.3 Drag-to-reparent
- Enable node dragging. On `onNodeDragStop`, use React Flow intersection helpers
  (`getIntersectingNodes`) on the dragged node:
  - Intersects exactly one node → set it as `parentId` (`PATCH {parentId:<target>}`).
  - Intersects none (dropped on empty canvas) → un-parent (`PATCH {parentId:null}`).
  - Intersects more than one → ignore (no-op; node snaps back).
- Optimistic: apply, toast "Moved <title> under <parent>" / "Un-parented <title>". A **422**
  cycle rejection → error toast + query invalidation (node snaps back to its real position).

### 4.4 Drag-to-edit prerequisites
- Add source/target connection **handles** to `TopicNode`. Dragging a connection from node A
  to node B creates **"B requires A"** — i.e. `POST /topics/B/prerequisites {prerequisiteId:A}`
  — matching the existing arrow convention (edge source = prerequisite → target = dependent).
- Prerequisite edges become **selectable/deletable**: selecting an edge + Delete (or an edge
  context action) → `DELETE /topics/:target/prerequisites/:source`.
- **Parent edges are not hand-deletable** (they are derived from `parentId` and managed by
  reparent). Keep them visually distinct (the existing dashed/animated style) and mark them
  non-selectable so the two edge types don't get confused.
- 422 cycle / self errors surface as an error toast; the transient edge is dropped on failure.

### 4.5 Full node editor
- Upgrade `TopicDetailPanel` from partial editing (status/noteRef/summary) to a **full editor**:
  `title`, `domain`, `topicType` (with the existing `TypeAutocomplete`), and `description`
  become editable, all via `PATCH /topics/:id`. This closes the current gap where those fields
  have no update UI and makes nodes truly "changeable."

### 4.6 Toasts
- The web app has no toast/notification primitive today. Add a **minimal toast utility**
  (a small context + a corner stack, auto-dismiss) used for action feedback and for surfacing
  422/409 errors from the interactions above. No external dependency.

### 4.7 API client / hooks
Add to `apps/web/src/api/client.ts` + `hooks.ts`:
- `keepTopic` / `parkTopic` / `restoreTopic` (thin wrappers over `PATCH /topics/:id`) or a
  single `updateTopic` reused — implementer's call; keep the hook names intention-revealing.
- `addPrerequisite(topicId, prerequisiteId)`, `removePrerequisite(topicId, prerequisiteId)`.
- All mutations invalidate the topics/detail queries (reuse `useInvalidateAll`).

---

## 5. Richer exports (`ExportGeneratorService`)

Extend the generated markdown; each new section is **omitted entirely when empty** so exports
stay clean for a fresh graph. The invariants from the master spec (§5) hold: `WHO I AM` and
the `OUTPUT CONTRACT` + worked example are always present and never trimmed.

1. **PARKED IDEAS** — lists parked suggestions (`aiProposed && status=='archived'`):
   `- <title> (<type>, <domain>) — <aiContext>`. Enables "rebuild my roadmap from these parked
   ideas." Included automatically (per the approved model), omitted when there are none.
2. **AI CONTEXT annotations** — in the ROADMAP section, tentative (✦) nodes carry their
   `aiContext` inline so Claude sees *why* each suggestion was made when reasoning about them.
3. **RECENT SESSIONS** — a short history derived from recent `SessionExport` rows: for the last
   N (e.g. 3), show `generatedAt`, whether/when imported (`importedAt`), `newTopicsCreated`
   count, and the recorded `nextFocusTitle`. Gives Claude continuity across otherwise-stateless
   chats. Omitted when there is no history.

Domain-scoped exports (`mode: domain:<X>`) scope PARKED IDEAS and ROADMAP annotations to that
domain, consistent with existing behavior; RECENT SESSIONS is global.

---

## 6. Testing & verification

**Backend (jest, service-level, matching the existing suite style):**
- Reparent cycle guard: self-parent → 422; descendant-as-parent → 422; valid move → 200; un-parent → 200.
- Prerequisite guards: self → 422; direct + transitive cycle → 422; duplicate → idempotent; valid add/remove round-trip; missing topic → 404.
- Delete rule: never-reviewed topic with prerequisite edges + children → deletes, edges gone, children `parentId` nulled; topic with a review → 409; topic with an app event → 409.
- Keep/park/restore: field transitions via `PATCH` produce the expected `aiProposed`/`status`.
- Export generator: PARKED IDEAS / AI CONTEXT / RECENT SESSIONS render when data present and are omitted when empty; existing invariants (WHO I AM, OUTPUT CONTRACT, SESSION GOAL on focus) still hold.

**Web (headless Brave/CDP smoke, per `docs/ops/local-dev.md`):**
- Import a `learning-os` block → tentative nodes appear (dashed ✦) → Keep one (commits) / Set aside one (moves to parked shelf) → Restore it → Delete a parked idea.
- Drag a node onto another → reparent persists after reload; drag to canvas → un-parents.
- Connect two nodes → prerequisite edge persists; delete the edge → gone. Attempt a cycle → error toast, no edge.
- Edit a node's title/domain/type/description in the drawer → persists.
- Generate an export with parked ideas present → PARKED IDEAS + RECENT SESSIONS sections appear.

**Gates:** `yarn workspace @terrain/api test` green + `nest build` 0; `yarn workspace @terrain/web build` (tsc --noEmit + vite build) 0; live boot smoke. Kill the dev API with `kill -9 $(lsof -ti:3000)` (not `pkill -f "nest start"`).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Dagre re-layout fights node dragging (nodes snap back mid-gesture) | Treat drag as a *gesture*: only `onNodeDragStop` matters; the structural change triggers a re-layout to the correct position. Don't persist positions. |
| A pre-existing cyclic `parentId` (bad data) hangs the ancestor walk | Visited-set bounds both the reparent and prerequisite walks. |
| Deleting a topic that a *real* node depends on silently orphans it | Delete cascades only structural edges of the *deleted* node; nodes that depend on it lose that prerequisite edge (acceptable — the node is gone). Review/app-event history still blocks deletion (409). |
| Confusing parent edges vs prerequisite edges when both are draggable/deletable | Only prerequisite edges are selectable/deletable; parent edges are visually distinct and non-selectable; reparent is a node-drop gesture, prerequisite is a handle-connect gesture. |
| Optimistic mutation leaves the graph inconsistent on error | Every mutation invalidates topic queries; errors surface as toasts and the query refetch restores truth. |

---

## 8. Open items (non-blocking)
- Exact placement of parked nodes when the shelf is on (greyed in-graph vs. a side list) — greyed in-graph preferred for "rebuild in context"; final call at implementation.
- `RECENT SESSIONS` depth (N) — start at 3, tune from real exports.
- Whether Keep/Park/Restore get intention-named hooks or reuse a single `updateTopic` — cosmetic; keep call sites readable.
