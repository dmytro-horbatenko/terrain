# Terrain Phase 2 (backend) — Session Import Design

- **Status:** Design approved (brainstorm) — ready for implementation planning
- **Scope:** Backend import parser only. The web review/diff screen (§7 of the master design spec) and the roadmap graph (§8) are deferred to later web slices.
- **Builds on:** Phase 1a (Topics, Reviews+SM-2, Prisma schema), Phase 1b (Sessions export, `SessionExport`, `ExportGeneratorService`). Master design spec: `docs/superpowers/specs/2026-06-30-terrain-design.md` (§6 contract, §7 import flow).

## 1. Goal

Close the export → Claude → app round-trip. A Claude.ai session produces one `learning-os` JSON block (taught by the 1b export's OUTPUT CONTRACT). This slice ingests that block: validate it, resolve its title references against the DB, and apply it — recording spaced-repetition reviews, creating AI-proposed topics, applying note summaries, and capturing the next-session suggestion — **atomically**, stamping the originating `SessionExport`.

## 2. The contract (reused, not redefined)

`@terrain/types` already defines `learningOsSchema` (Zod) and `parseLearningOs(raw)`, which finds the single ` ```learning-os ` fence, `JSON.parse`s it, and validates. This slice consumes that as-is. Shape (v1):

- `version: 1`, `sessionId: string`
- `reviews[]`: `{ topicTitle, topicId?, quality (0–5), note? }`
- `proposedTopics[]`: `{ title, type, domain, description?, prerequisiteTitles[], parentTitle?, aiContext? }`
- `noteSummaries[]`: `{ topicTitle, keyInsight, invariant?, contradiction?, suggestedNoteRef? }`
- `nextSession?`: `{ focusTitle?, coldChallenge? }`

## 3. Architecture

New `ImportModule` (registered in `AppModule`):
- **`ImportService`** — a `resolve+plan` core shared by two public methods:
  - `preview(raw): Promise<ImportPlan>` — parse + resolve + compute the diff. **No writes.**
  - `apply(raw): Promise<ImportResult>` — commit the plan in **one interactive transaction**; refuses to write anything if the plan is not fully applicable.
- **`ImportController`** — `POST /sessions/import/preview` and `POST /sessions/import`, both `{ raw: string }`. `sessionId` is taken from the parsed block, never the URL.
- **Reuse:** `parseLearningOs` from `@terrain/types`; the SM-2 write-builder extracted from `ReviewsService` (see §6).

### 3.1 `ImportPlan` (preview output / internal plan)
```
ResolvedReview   = { topicTitle; topicId?; quality; note?; resolvedTopicId: string | null;
                     srPreview?: { intervalBefore: number; intervalAfter: number; nextReviewAt: Date } }
NewTopicPlan     = { title; topicType; domain; description?; prerequisiteTitles: string[];
                     parentTitle: string | null; aiContext?; alreadyExists: boolean }
NoteSummaryPlan  = { topicTitle; resolvedTopicId: string | null; composedSummary: string; suggestedNoteRef? }
Unresolved       = { kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent'; title: string;
                     context: string; reason: 'missing' | 'ambiguous' | 'self-reference' }
ImportPlan       = { sessionExportId: string; alreadyImported: boolean;
                     reviews: ResolvedReview[]; newTopics: NewTopicPlan[]; noteSummaries: NoteSummaryPlan[];
                     nextSession?: { focusTitle?; coldChallenge? };
                     unresolved: Unresolved[]; applicable: boolean }
```
`applicable = unresolved.length === 0 && !alreadyImported`.

**Preview SR accuracy.** `srPreview` is computed exactly as `apply` would write it: preview simulates reviews **sequentially per topic in-memory** (each review's SM-2 result becomes the `intervalBefore`/state for the next review on the same topic), and uses **default SR state** (`interval 0`, `easeFactor 2.5`, `repetitions 0`) for a review targeting a batch-created (not-yet-persisted) topic. So preview numbers match the eventual apply outcome.

## 4. Resolution rules

A **batch title set** is built first: every existing `Topic.title` in the DB, **unioned** with the `proposedTopics[].title` in this block (so references to topics created in the same import resolve).

- **Reviews:** resolve to a topic by `topicId` (exact id, if present and found) else exact `topicTitle`. Resolve against existing topics ∪ batch-created topics. Imported reviews are recorded with `mode = claude_session`.
- **Note summaries:** resolve `topicTitle` against existing ∪ batch (the spec's example note summary targets a just-proposed topic).
- **Proposed topics:** a proposed title that **already exists** as a `Topic` is treated as that existing topic (`alreadyExists: true`, no duplicate row created). `parentTitle` and each `prerequisiteTitles[]` entry resolve against existing ∪ batch.
- **Unresolved** = any review/noteSummary/parent/prerequisite title that resolves to neither existing nor batch. Each is recorded in `unresolved[]` with its context (which item referenced it) and a `reason`.
- **Normalized matching:** title comparison is **trim + case-insensitive** (the OUTPUT CONTRACT still instructs Claude to echo exact titles; normalization is a safety net against trivial drift, not a fuzzy matcher). `alreadyExists` detection and the `title → id` map use the same normalized key.
- **Ambiguity (no `@unique` on `Topic.title`):** if a normalized title matches **more than one existing topic**, the reference is **unresolved** with `reason: 'ambiguous'` — never write to an arbitrarily-chosen row. A review carrying an exact `topicId` bypasses title matching entirely.
- **Self-reference:** a proposed topic whose `parentTitle` or any `prerequisiteTitles[]` entry resolves to **itself** is **unresolved** with `reason: 'self-reference'` — no `parentId = self` or `Prerequisite(X, X)` self-loop is ever written. (Mutual parent cycles across the batch are out of scope for this slice; the roadmap-graph slice owns deep traversal.)
- **`alreadyExists` reuse is read-only:** when a proposed title matches an existing topic, it is reused (no duplicate row) and its proposed `parentTitle` / `prerequisiteTitles[]` / `aiContext` are **ignored** — the proposed-topic path never edits an existing row. (Reviews and note summaries still mutate their target topics; that is their purpose.)

## 5. Apply semantics — single transaction, all-or-nothing

`apply(raw)`:
1. Parse + resolve + build the plan (§3.1, §4).
2. **Guards (before any write):** `alreadyImported` → reject; `unresolved.length > 0` → reject (see §9). Nothing is written on rejection — "never import half."
3. Open one **interactive** `prisma.$transaction(async (tx) => { … })`:
   a. **Create new topics** (those with `alreadyExists === false`): `aiProposed: true`, `aiContext`, `topicType = proposed.type`, `status = planned`. For each created topic, **register its type** in the same `tx` by upserting `TopicType` with a normalized key (`key = type.trim().toLowerCase()`, `label = type.trim()`), mirroring `TopicsService.registerType` (master spec §10 — import never fails on an unknown type and the type joins autocomplete). Build a **normalized-title → id** map covering existing + newly created topics.
   b. **Wire links** (second pass, **newly-created topics only**): set each new topic's `parentId` (from `parentTitle`) and create `Prerequisite` rows (`topicId = newTopic.id`, `prerequisiteId = resolved prereq id`). `alreadyExists` topics are skipped here (read-only reuse, per §4).
   c. **Apply reviews** sequentially (so multiple reviews on one topic compound): re-read the topic state within `tx`, build the SR writes via the shared helper (§6), `tx.review.create` + `tx.topic.update`.
   d. **Apply note summaries:** set `summary = composedSummary` (§10) and, when `suggestedNoteRef` is present, `noteRef = suggestedNoteRef`, on the resolved topic.
   e. **Stamp the originating `SessionExport`:** `importedAt = now`, `importedOutputRaw = raw`, `newTopicsCreated = [created ids]`, `nextFocusTitle = nextSession?.focusTitle`, `nextColdChallenge = nextSession?.coldChallenge`.
4. Return `ImportResult = { sessionExportId, reviewsApplied, topicsCreated: string[], noteSummariesApplied, nextSessionStored: boolean }`. `nextSessionStored = true` iff `nextSession?.focusTitle` is a non-empty string. `nextColdChallenge` is stored whenever present (even with no focus title); `focusTitle` is stored as **opaque text** (never resolved to a topic).

## 6. SR-apply reuse refactor (Approach A)

Extract the pure SM-2 write-builder so import and the existing review endpoint share one source of truth (no drift):

```
// apps/api/src/reviews/sr-apply.ts
buildReviewWrites(topic, quality, mode, note, now, durationMin?) -> {
  review: <Review create data>,        // incl. intervalBefore/After, reviewedAt, mode, note, durationMin
  topic:  <Topic update data>,         // sm2 result: easeFactor/interval/repetitions/nextReviewAt,
                                        // learnedAt ??= now, status: planned -> active
}
```
- `ReviewsService.logReview` is refactored to call `buildReviewWrites` then run its existing two-statement `$transaction` — behavior unchanged, existing reviews tests still green.
- `ImportService` calls `buildReviewWrites` inside its interactive `tx`.

## 7. Schema change

Add to `model SessionExport`:
```
nextFocusTitle    String?
nextColdChallenge String?
```
Migration: `prisma migrate dev --name session_next_focus` (pinned binary). These store the imported `nextSession`.

## 8. `nextSession` surfacing in the export (closes the loop)

`ExportGeneratorService.generate`: when **no explicit `focusTopicId`** is provided, look up the most-recently-imported `SessionExport` (`importedAt != null`, `nextFocusTitle != null`, ordered by `importedAt desc`) and, if found, append a section:
```
## SUGGESTED NEXT FOCUS (from last session)
Focus: <nextFocusTitle>
Cold challenge: <nextColdChallenge>   (only when present)
```
This is **additive** (never removes content — respects the export invariant). An explicit `focusTopicId` still produces the existing `SESSION GOAL` section and takes precedence (the suggested-focus section is only emitted when no explicit focus is given).

## 9. Error handling (clear, all-or-nothing)

| Condition | Status | Notes |
|---|---|---|
| No `learning-os` fence / malformed JSON / Zod-invalid | **400** | from `parseLearningOs` |
| `sessionId` from block not found in `SessionExport` | **404** | |
| Already imported (`importedAt` set) | **409** | `apply` only; `preview` returns 200 with `alreadyImported: true` |
| Any unresolved reference — **missing**, **ambiguous** (title matches >1 topic), or **self-referential** | **422** | `apply` only; body lists every `unresolved[]` entry with its `reason`; nothing written |

`preview` is read-only: it returns **200** with the full plan (including `unresolved[]`, `alreadyImported`, `applicable`) for 404-passing inputs; it still surfaces 400 (unparseable) and 404 (unknown session) because it can't plan without a valid block + session.

## 10. Note-summary composition

`composedSummary` is Obsidian-ready markdown built from the summary fields:
```
**Key insight:** <keyInsight>

**Invariant:** <invariant>          (omitted when absent)

**Watch out:** <contradiction>      (omitted when absent)
```
Stored on `Topic.summary`. `suggestedNoteRef` (when present) → `Topic.noteRef`.

## 11. Testing

- **Unit (mocked Prisma):**
  - `buildReviewWrites` pure helper — SR transition + the planned→active flip + `learnedAt` default.
  - `ImportService.preview` — resolution (id vs title, existing ∪ batch), SM-2 preview numbers, `alreadyExists`, `unresolved[]` population, `applicable` flag, `alreadyImported`.
  - Guard behavior: `apply` throws 409 when already imported and 422 when unresolved, **without** invoking any write.
  - Preview SM-2 numbers **compound** for two reviews on one topic, and use **default SR state** for a review targeting a batch-created topic (both must match apply).
  - Unresolved `reason` cases: an **ambiguous** title (matches two existing topics) and a **self-referential** parent/prerequisite each land in `unresolved[]` → `applicable: false`.
  - **ExportGeneratorService tests (§8 change):** extend the existing `prisma` mock with `sessionExport: { findFirst: jest.fn().mockResolvedValue(null) }` — the new lookup runs on the no-`focusTopicId` path that all current export tests hit, so without this they throw. Add a test: the **SUGGESTED NEXT FOCUS** section appears only when a prior imported export with `nextFocusTitle` exists and no explicit `focusTopicId` is passed.
- **Live smoke (real DB):** generate a real export (`GET /sessions/export`), hand-craft a `learning-os` block referencing a seeded topic + a new proposed topic + a note summary + `nextSession`; `POST /sessions/import/preview` (inspect the diff), then `POST /sessions/import`; verify the review moved SR state (interval/nextReviewAt), the proposed topic exists (`aiProposed`), the note summary landed on `summary`/`noteRef`, the `SessionExport` is stamped, and a subsequent `GET /sessions/export` shows the SUGGESTED NEXT FOCUS section. Re-`POST /sessions/import` → **409**.

## 12. Out of scope (later slices)

- Web review/diff screen + per-item curated apply (toggle/edit/skip individual items) — needs `apps/web`.
- Roadmap graph (master spec §8).
- Phase 3: inline approve/reject of AI-proposed topics.

## 13. Open decisions resolved in brainstorm

- Scope = **backend import only**.
- API = **preview + apply** (preview is the seam for the future diff screen and the main unit-test surface).
- `nextSession` = **persist on `SessionExport` + surface as a suggested-next-focus section** in the next export.
- SR reuse = **Approach A** (extract `buildReviewWrites`, refactor `logReview` to share it).
- Title matching = **trim + case-insensitive**; ambiguous (multi-match) and self-referential refs are unresolved → 422.

## 14. Spec-review hardening

A 4-lens adversarial review (completeness · consistency · feasibility-vs-code · master-spec alignment) with refute-biased verification confirmed 10 edge-case gaps, all folded in above — title ambiguity/normalization (§4), self-reference rejection (§4), `alreadyExists` read-only reuse (§4), `TopicType` registration on import (§5.3a), preview SR compounding + default state (§3.1/§11), `nextSessionStored` semantics (§5), and the `ExportGeneratorService` mock/test fix the §8 change requires (§11). The core design is unchanged.
