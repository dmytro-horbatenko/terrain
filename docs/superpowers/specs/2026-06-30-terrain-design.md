# Terrain — Design Spec

> A personal **Learning OS**: a persistent, evolving knowledge-management and
> spaced-repetition system. Domain-agnostic (DSA, Web3/DeFi, Networking, System
> Design). **Claude.ai is the AI layer, not the app.** Terrain is a context
> store, a scheduler, and a progress mirror.

- **Date:** 2026-06-30
- **Status:** Design approved — ready for implementation planning
- **Owner:** Dima (single user)

---

## 1. Purpose & philosophy

Most learning fails because it relies on internal motivation, which predictably
collapses around week 3. Terrain is the external system that holds the learning
in place when motivation dips. It does **not** teach (Claude.ai does), **not**
take notes (Obsidian/OneNote do), and **not** embed an AI tutor. It:

1. Maintains a **living knowledge graph** (topics, dependencies, mastery state).
2. Runs **SM-2 spaced repetition** to schedule reviews.
3. Generates **session context exports** that bootstrap stateless Claude.ai sessions.
4. Sends **Telegram briefs** so the system initiates even on low-energy days.
5. Links to Obsidian/OneNote notes **by name** (no sync — a named reference only).

### Five problems → solutions

| Problem | Solution |
|---|---|
| Forgetting | SM-2 spaced repetition on every topic |
| No clear path | Living roadmap always shows what's next |
| Invisible progress | Interval-growth charts, mastery state, roadmap graph |
| Session amnesia | Structured context export bootstraps every Claude.ai session |
| Week-3 collapse | Telegram initiates; minimum session = log a recall quality; streak + freezes |

### Explicit non-goals
- No note sync with Obsidian/OneNote — reference by name only.
- No in-app AI / API credits — the Claude.ai subscription is the AI layer.
- No mobile app — Telegram is the mobile surface.
- No multi-user / social features — single user, API key in env.
- No automated note creation — writing notes by hand is a valued step.

---

## 2. Core design principle: store facts and inputs, derive everything else

The governing decision for the whole schema. For a single-user app the compute
cost of derivation is nil, and it eliminates a class of consistency bugs.

- **Stored:** facts (a review happened, with its quality and the SM-2 result at
  that time), inputs (evening note, session quality), and genuine **temporal
  game state** that is path-dependent (streak, freeze balance, per-day type).
- **Derived (never stored):** mastery conditions, "blocked"/"reviewing" display
  labels, and all daily metrics (counts, struggle ratio, heatmap).

This is why `masteryConditions` and the `DailyLog` counters from the original
draft are **removed** — they were redundant copies of derivable data.

---

## 3. Data model

Prisma-flavored. Postgres via Prisma.

```prisma
enum TopicStatus    { planned active mastered archived }  // "reviewing"/"blocked" are DERIVED
enum ReviewMode     { telegram_quick app_log claude_session }
enum AppEventKind   { project_usage problem_solved audit_exercise real_debugging }
enum DayType        { active quiet frozen break }
enum SessionQuality { shallow normal deep }

model Topic {
  id          String   @id @default(uuid())
  title       String
  domain      String
  topicType   String                         // soft vocabulary → TopicType.key
  status      TopicStatus @default(planned)
  description String?
  summary     String?                         // written personal summary (teaching condition)
  noteRef     String?                         // "OneNote > DSA > Stacks" | "Obsidian: ..." | URL

  parentId    String?                         // self-relation, strict tree (≤1 parent)
  parent      Topic?  @relation("SubTopics", fields: [parentId], references: [id])
  children    Topic[] @relation("SubTopics")

  prerequisites Prerequisite[] @relation("Dependent")  // edges: this topic depends on others
  dependents    Prerequisite[] @relation("Prereq")     // edges: others depend on this topic

  easeFactor   Float @default(2.5)
  interval     Int   @default(0)
  repetitions  Int   @default(0)
  nextReviewAt DateTime?
  learnedAt    DateTime?

  aiProposed Boolean @default(false)
  aiContext  String?

  reviews   Review[]
  appEvents ApplicationEvent[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Prerequisite {            // DAG edge: `topic` requires `prerequisite`
  topicId        String
  prerequisiteId String
  topic          Topic @relation("Dependent", fields: [topicId], references: [id])
  prerequisite   Topic @relation("Prereq",    fields: [prerequisiteId], references: [id])
  @@id([topicId, prerequisiteId])
}

model Review {
  id             String @id @default(uuid())
  topicId        String
  topic          Topic  @relation(fields: [topicId], references: [id])
  quality        Int                          // 0–5
  mode           ReviewMode
  durationMin    Int?
  note           String?
  intervalBefore Int                          // historical SM-2 facts (interval-growth chart)
  intervalAfter  Int
  reviewedAt     DateTime @default(now())
}

model ApplicationEvent {
  id          String @id @default(uuid())
  topicId     String
  topic       Topic  @relation(fields: [topicId], references: [id])
  kind        AppEventKind
  description String
  url         String?
  appliedAt   DateTime @default(now())
}

model SessionExport {
  id                String   @id @default(uuid())
  generatedAt       DateTime @default(now())
  mode              String                     // "full" | "domain:DSA" | "focus:<id>"
  domains           String[]
  focusTopicId      String?
  exportMd          String                     // full pasted-into-Claude context
  importedAt        DateTime?
  importedOutputRaw String?                    // raw pasted-back output
  newTopicsCreated  String[]                   // audit array (no FK integrity needed)
}

model DailyLog {                               // one row per day, written by nightly cron
  date           DateTime @id @db.Date
  dayType        DayType
  eveningNote    String?
  sessionQuality SessionQuality?
}

model StreakState {                            // singleton, path-dependent game state
  id                Int @id @default(1)
  currentStreak     Int @default(0)
  longestStreak     Int @default(0)
  freezeBalance     Int @default(0)
  lastEvaluatedDate DateTime? @db.Date
}

model TopicType {                              // soft vocabulary, auto-grows
  key   String @id                            // normalized (trim + lowercase)
  label String                                // display form
  color String?                               // for the roadmap graph
}

model Settings {                               // singleton
  id             Int @id @default(1)
  obsidianVault  String?                       // enables obsidian:// deep links
  telegramChatId String?
}
```

### Derived logic (computed in services, never stored)

- **`masteryStatus(topic)`** = `{ retention: interval ≥ 30, application: appEvents.count ≥ 1, teaching: noteRef != null || summary != null }`. A topic is *eligible* for mastery when all three are true; the user then confirms, setting `status = mastered`. (The "3+ novel variants" form of the application condition is satisfied by multiple `problem_solved` ApplicationEvents — i.e. `count ≥ 1` of any kind, with multiple variants being the same mechanism.)
- **`blocked`** display label = `status == planned && ∃ prerequisite with status != mastered`.
- **`reviewing`** display label = `status == active && repetitions > 0`.
- **Daily metrics** (topics reviewed/learned, struggle ratio, activity heatmap) = aggregates over `Review` and `DailyLog`.
- **Struggle ratio (7d)** = share of reviews in the last 7 days with quality ≤ 2; target band 40–60%.

---

## 4. SM-2 engine (`packages/sr-engine`)

Pure TypeScript, zero external deps, fully unit-tested.

```typescript
function sm2(quality: number, state: SRState): SRState {
  if (quality < 3) {
    return { ...state, repetitions: 0, interval: 1, nextReviewAt: tomorrow() }
  }
  const newEF = Math.max(1.3,
    state.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
  const interval =
    state.repetitions === 0 ? 1 :
    state.repetitions === 1 ? 6 :
    Math.round(state.interval * newEF)
  return {
    easeFactor: newEF,
    interval,
    repetitions: state.repetitions + 1,
    nextReviewAt: addDays(new Date(), interval),
  }
}
```

**Auto-escalation rule:** if a topic has ≥ 3 reviews in the past 7 days with
quality ≤ 2, reset its interval to 1 regardless of current state. (Phase 4 to
wire into the cron; the engine exposes the predicate from the start.)

Every review writes `intervalBefore`/`intervalAfter` so the interval-growth
chart reads historical facts, not recomputed estimates.

---

## 5. Session context export (app → Claude.ai)

### 5.1 One parameterized generator
A single pure generator (`state → markdown`) as a standalone service, callable
from any surface. Parameters **scope and emphasize**; they never trim the
reliability-critical sections.

- `mode: full` (default) — entire roadmap across all domains + everything due.
- `mode: domain:<X>` — filters roadmap + due list to one domain (the only
  legitimate trim, for large multi-domain graphs).
- `focusTopicId` — **adds** a `SESSION GOAL / FOCUS` section, pins that topic +
  its prerequisites to the top, sets the Socratic instruction. Pure emphasis.

**Invariant:** `WHO I AM` and the **output-format contract + worked example** are
present in *every* export regardless of mode — they are what make the stateless
AI layer reliable, so they are never trimmable.

**Phase 1 surface:** web app screen with a Copy button only. The generator is a
standalone service so a Telegram `/brief` surface or new modes can be added
later as additional callers. Each export persists a `SessionExport` row.

### 5.2 Export structure (markdown)

```markdown
---
TERRAIN — SESSION CONTEXT
Generated: <ts>   Session: <sessionExportId>
Export: full | domain:DSA | focus:<title>
---

## WHO I AM (stable)
Name / role / learning style / code style / note system.

## ROADMAP — <domain>
Tree with status glyphs (✓ mastered, ● active, ○ planned, ✗ blocked) and
AI-proposed markers + dates.

## DUE FOR REVIEW TODAY
OVERDUE: <topic> — overdue Nd, last quality, confusion note, noteRef
DUE TODAY: <topic> — last quality

## RECENT SIGNALS
Struggle ratio 7d; topics flagged for re-acquisition.

## LAST SESSION (<date>)
Topics, key confusion, what Claude proposed / imported.

## MASTERY CONDITIONS
Per active topic: retention / application / teaching ✓/✗.

## SESSION GOAL          (only when focusTopicId set)
Suggested focus + Socratic style instruction.

## OUTPUT CONTRACT  ← embedded every time
Schema + worked example of the `learning-os` JSON block (see §6).
```

---

## 6. Session output contract (Claude.ai → app)

**The single most important format.** One fenced JSON block is the sole
machine-readable contract; all prose lives outside it and is ignored by the
parser.

````
```learning-os
{
  "version": 1,
  "sessionId": "<echoed from the export>",
  "reviews": [
    { "topicTitle": "Monotonic stack", "topicId": "uuid-or-null",
      "quality": 3, "note": "direction confusion resolved" }
  ],
  "proposedTopics": [
    { "title": "Decreasing monotonic stack", "type": "pattern", "domain": "DSA",
      "description": "...", "prerequisiteTitles": ["Monotonic stack"],
      "parentTitle": "Monotonic stack",
      "aiContext": "user confused decreasing vs increasing" }
  ],
  "noteSummaries": [
    { "topicTitle": "Monotonic stack (decreasing)", "keyInsight": "...",
      "invariant": "...", "contradiction": "...",
      "suggestedNoteRef": "OneNote > DSA > Stacks > ..." }
  ],
  "nextSession": { "focusTitle": "...", "coldChallenge": "LeetCode #84" }
}
```
````

Design rationale:
1. **Robust parse** — find the one ` ```learning-os ` fence, `JSON.parse`. No
   markdown-list parsing. Malformed JSON → reject the whole import with a clear
   error; never import half.
2. **AI stays free** — Claude writes teaching/encouragement as prose around the block.
3. **No duplication** — the app **renders** Obsidian-ready markdown *from*
   `noteSummaries` on import; Claude emits the data once.
4. **`version`** lets the format evolve without breaking old `SessionExport` rows.
5. **Title-based references** — Claude reliably knows topic *titles* from the
   export, not UUIDs. Imports resolve titles → IDs against the DB; `topicId` is
   an optional exact-match echo when the export supplied one.
6. **`sessionId` echo** ties output back to its `SessionExport` so `importedAt`
   and `newTopicsCreated` are recorded automatically.

The contract is defined once as a **Zod schema in `packages/types`**, used both
to render the worked example in the export and to validate on import.

---

## 7. Import flow (Phase 2)

**Paste → parse → review/diff screen → confirm (single transaction).**

Review screen, four sections mirroring the JSON, each item individually
toggleable and editable:

1. **Reviews to apply** — `topic → quality`, resolved topic, and a **preview of
   the SM-2 result** ("interval 6d → 15d, next review Jul 14"). Unresolved title
   = red with a dropdown to pick the right topic or explicitly skip.
2. **New topics to create** — title, type (autocomplete), domain,
   prerequisite/parent links (title-resolved, with "create as new" when the
   parent is itself new in this batch).
3. **Note summaries** — rendered as Obsidian-ready markdown with a copy button;
   `suggestedNoteRef` pre-fills the topic's `noteRef` (toggle to accept).
4. **Next session** — stored on `SessionExport` / surfaced as the next export's
   suggested goal.

Confirm applies everything in **one transaction** and stamps the originating
`SessionExport` (`importedAt`, `newTopicsCreated`).

**Decisions:**
- **Unresolved review title blocks confirm** until it resolves or is explicitly
  skipped. Reviews change SR state; nothing is silently dropped.
- No live re-parsing as you edit raw text (re-paste if the JSON was wrong).
- No inline AI on the review screen — it's a deterministic diff, not a chat.

---

## 8. Roadmap graph (Phase 2)

**React Flow + dagre auto-layout.** The graph is a pure projection over `Topic`
+ `Prerequisite`; **no graph state in the DB**, node positions computed by dagre
each render (never persisted).

- Renders the DAG (prerequisites) over the tree (parent→child), node color by
  status (planned/active/mastered + derived blocked), AI-proposed marker.
- **Phase 2:** read-mostly. Click node → side panel (details + edit status,
  noteRef, mastery checklist). Filter by domain. No manual dragging.
- **Phase 3:** inline approve/reject of AI-proposed nodes, drag to re-parent.

Rejected for cause: D3 force layout (unstable/unreadable for a path); plain tree
view (structurally cannot show cross-prerequisite edges — the core value).

---

## 9. Streak & freeze economy (Duolingo-style)

The streak must feel *losable* and protection must be *scarce and earned*.

Day classification, evaluated by the nightly cron:

- **Quiet day** (nothing due) → streak continues, free. (SR has genuinely empty
  days; they must not punish.)
- **Active day** (≥1 review logged) → streak +1.
- **Missed day** (reviews due, none logged):
  - freeze available → auto-consume one → day **frozen**, streak preserved.
  - no freeze → **break**, streak resets to 0.

Freezes are scarce and earned:
- **Earn 1 freeze per 5 active days.**
- **Hard cap of 2** held at once.
- `/skip` **manually spends a freeze** for today; fails with "no freezes left"
  when empty. Voluntary rest and missed-day protection are the *same* scarce
  resource — there is no separate "rest day" concept.

State lives in the `StreakState` singleton (path-dependent), and each day's
`DayType` is recorded in `DailyLog` for the heatmap. Dashboard shows current
streak, freezes held (🛡️), longest streak.

---

## 10. Topic type vocabulary (soft)

- `Topic.topicType` is a **plain string** — imports never fail on an unknown type.
- `TopicType` lookup table **auto-grows**: seeded set + any new value from UI or
  import is registered, carrying `label` + `color`.
- Add-topic form and import review offer **autocomplete from existing types**.
- Normalize on write (trim + lowercase key, keep display label) so
  `Pattern`/`pattern` collapse.
- Starter seed: `pattern, concept, problem, vulnerability, tradeoff, technique,
  protocol, theorem`.

---

## 11. Telegram bot (Phase 1, `telegraf`)

- **Morning brief (09:00):** what's due (overdue flagged), streak. Buttons:
  `[Open app]` `[Quick log]` `[Skip today]`. (No Claude export in Phase 1.)
- **Quick-log flow:** bot sends each due topic one at a time; inline keyboard
  `[0 Blackout] [1 Wrong] [2 Almost] [3 Effort] [4 Good] [5 Perfect]`; SM-2 runs
  server-side after each tap (`mode = telegram_quick`).
- **Evening check-in (21:00):** reviews completed; session quality
  (shallow/normal/deep); optional evening note → `DailyLog`.
- **Commands (Phase 1):** `/today` `/log` `/add` `/streak` `/skip` `/snooze`.
  (`/brief` Claude export, `/roadmap`, `/stats` deferred.)

---

## 12. Second-brain integration

- `noteRef` is a plain string on every topic — Obsidian filename, OneNote
  section path, or URL. **No sync.**
- **Obsidian URI deep link (Phase 1.5):** if `Settings.obsidianVault` is set, the
  app generates `obsidian://open?vault=X&file=Y` clickable links.
- Import renders note summaries as Obsidian-ready markdown for manual paste.

---

## 13. Tech stack & monorepo

- **Backend:** NestJS + PostgreSQL + Prisma + node-cron.
- **Frontend:** React + Vite + Recharts (charts) + React Flow (graph).
- **Bot:** Telegram Bot API via `telegraf`.
- **Monorepo:** Yarn 4 workspaces (`.yarnrc.yml` already present; Node 24).
- **Auth:** single-user, API key in env. No auth system.
- **Deployment:** self-hosted server, Docker Compose.

**Packages:**
- `apps/api` — NestJS (Topics, Reviews, AppEvents, Sessions/export, Import,
  Streak/cron, Telegram modules).
- `apps/web` — React + Vite.
- `packages/sr-engine` — pure SM-2 + auto-escalation predicate, zero deps.
- `packages/types` — shared TS types **+ the `learning-os` JSON contract as a Zod
  schema** (export worked-example + import validation share it).

**Scaffolding discipline:** initialize via generators (`yarn init -2`,
`nest new`, `npm create vite`, Prisma init) — do **not** hand-create the first
project files.

---

## 14. Build phasing

**Phase 1 — The loop (build first):**
- Topic CRUD + Review logging + `sr-engine`.
- Telegram: morning brief, quick-log, evening check-in (no Claude export).
- Web export screen with Copy button; `learning-os` contract defined in `types`.
- Streak/freeze nightly cron.
- Basic web UI: topic list, add/edit topic, log review, streak + freezes.
- Pre-seed DSA modules: mastered ones → `mastered`; reviewing ones → `active`,
  interval 14, `nextReviewAt = now + 14d`.

**Phase 2 — Visibility:** roadmap graph (React Flow + dagre), growth charts +
heatmap + struggle ratio, mastery checklist, `noteRef` + Obsidian URI,
ApplicationEvent UI, **session import parser** (paste → review/diff → confirm).

**Phase 3 — Living roadmap:** AI-proposed node approve/reject inline, multi-domain
graph, richer exports with session history + AI context.

**Phase 4 — Polish:** weekly Telegram digest, auto-escalation wired into cron,
shareable roadmap export.

---

## 15. Pre-seed data (current DSA state)

| Module | Seed status | Notes |
|---|---|---|
| Arrays & hash maps | mastered | |
| Two pointers & sliding window | active (reviewing) | interval ~38 |
| Linked lists | mastered | |
| Graphs DFS/BFS | active (reviewing) | |
| Backtracking | active (reviewing) | |
| 1D dynamic programming | mastered | prefer tabulation |
| Stacks & queues | active | current module |
| Heaps & priority queues … Bit manipulation (9 more) | planned | |

Other active learning to seed later: Networking (Kurose & Ross), Web3 (Midas
production work — ERC-4626, Band, Morpho/Aave, Safe multisig).

---

## 16. Open items deferred (not blocking Phase 1)
- Exact pre-seed `easeFactor`/`repetitions` per reviewing module (use defaults:
  EF 2.5, repetitions 2, interval per table).
- Obsidian vs OneNote `noteRef` string conventions (free string for now).
- Auto-escalation cron wiring (engine predicate exists from Phase 1).
