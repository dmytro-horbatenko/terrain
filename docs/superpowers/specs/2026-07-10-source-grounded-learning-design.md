# Source-Grounded Learning — Design

**Date:** 2026-07-10  
**Status:** Approved in design review  
**Depends on:** existing `learn` export, strict `learning-os` v2 import,
session-driven learning, prepared courses

## Problem

Terrain's Web3 curriculum already gives each leaf topic a resource, build task,
and done-when criterion. The learning-session prompt does not enforce their
order, however. A session can begin with AI explanation, accept short answers,
perform the learner's build, and activate the topic without evidence that the
learner used the source. The result feels fluent while leaving coverage,
accuracy, and independent performance uncertain.

One bare `Resources:` URL also cannot express why a source was chosen, which
part to consume, whether multiple sources are complementary, which alternatives
fit the learner's preferences, or when a changing source should be rechecked.

## Goals

- Make curated sources the normal first source of knowledge for first exposure.
- Select one or more sources by topic needs, source roles, prior exposure, user
  preferences, and an explicit user decision.
- Require source-specific reconstruction before AI teaching.
- Allow equivalent substitutions, but never silent skipping.
- Prevent first-exposure activation when required source evidence is absent.
- Preserve the existing retrieval, teach-back, application, notes, and FSRS
  flow.
- Upgrade the prepared Web3 curriculum from bare URLs to reviewed source plans.

## Non-goals

- An embedded reader or video player.
- A global source catalogue, ratings, reviews, or recommendation engine.
- Automated claims that a learner genuinely watched or read something; Terrain
  can validate evidence structure, while the session evaluates its quality.
- General prepared-course synchronization. Existing Web3 topics receive one
  scoped backfill for this migration.
- Replacing external notes, source platforms, or Claude with in-app teaching.

## Approaches considered

### A. Prompt-only enforcement

Rewrite `LEARN_CONDUCT` to require source intake and forbid the model from doing
the build. This is the smallest change, but the import path cannot detect a
missing source stage. It does not satisfy strict accounting.

### B. Structured source plan plus evidence gate — chosen

Store a small validated source plan on each topic, export it into the session,
and import source-specific reconstruction as durable evidence. The existing
atomic import blocks first-exposure activation when an applicable source
requirement is missing.

### C. Full resource subsystem

Normalize all sources globally and add freshness jobs, ratings, recommendation
logic, and dashboards. This may become useful after real usage data exists, but
it would turn Terrain into a course platform before the core workflow is proven.

## Source plan

`Topic` gains a nullable Prisma `Json` field named `sourcePlan`. The value is
validated at every write boundary by a shared `@terrain/types` Zod schema.
Prepared-course content carries the same value through `proposedTopics`.

```ts
type SourcePlan =
  | {
      policy: 'none';
      rationale: string;
    }
  | {
      policy: 'required';
      requirements: Array<{
        id: string;
        purpose: string;
        requiredWhen: 'first_exposure' | 'always';
        options: Array<{
          id: string;
          title: string;
          url: string;
          format: 'article' | 'book' | 'video' | 'course' | 'documentation' | 'exercise';
          scope: string;
          estimatedMinutes: number;
          why: string;
          paid?: boolean;
          language?: string;
          verifiedAt?: string;
          recheckAfterDays?: number;
        }>;
      }>;
      optional?: Array<{
        id: string;
        title: string;
        url: string;
        format: 'article' | 'book' | 'video' | 'course' | 'documentation' | 'exercise';
        scope: string;
        estimatedMinutes: number;
        why: string;
        paid?: boolean;
        language?: string;
        verifiedAt?: string;
        recheckAfterDays?: number;
      }>;
    };
```

One selected option satisfies one requirement. Multiple complementary sources
are represented as multiple requirements, not `chooseCount` logic. Alternatives
inside one requirement cover the same purpose and let the learner choose by
format, time, language, access, or prior knowledge.

`scope` is mandatory and bounded, such as `Chapter 4, Accounts and Keys`,
`12:10–31:40`, or `Entire article (8 min)`. A provider homepage is not a valid
scope. `why` records the source's distinct contribution, preventing a list of
redundant explanations from masquerading as breadth.

`requiredWhen: first_exposure` is the normal policy. `always` is reserved for a
source that must be consulted each time because the task depends on its current
state, such as current protocol or security guidance. Skill-only topics may use
`policy: none`, but must explain why no intake source is useful.

For freshness-sensitive material, `verifiedAt` and `recheckAfterDays` are both
present. When the interval has elapsed, the export marks the option as requiring
live verification before it can be selected. Stable books and papers may omit
both. Expiry is a verification requirement, not automatic deletion.

## User source preferences

`Settings` gains four fields:

- `preferredSourceFormats String[]` — ordered preference, not a hard filter;
- `sourceTimeBudgetMinutes Int?` — normal intake budget for one topic;
- `sourceLanguage String?`;
- `allowPaidSources Boolean @default(false)`.

Preferences rank equivalent options but never waive a requirement. If no
curated option fits, the session either records an equivalent substitution or
stops without activating the topic. The learner confirms the final selection in
chat, so preferences do not become an inflexible hidden algorithm.

## Learning-session arc

A first-exposure `learn` session runs in this order:

1. **Cold orientation.** Ask one short diagnostic question to expose the
   learner's current model. Probe briefly, but do not teach.
2. **Source selection.** Explain each requirement's purpose, recommend an
   option using source metadata and preferences, and wait for the learner's
   decision.
3. **Source intake.** The learner leaves the chat and consumes the exact scopes.
   The model pauses and must not replace them with its own summary.
4. **Source reconstruction.** For every requirement, the learner states the
   main claim, a supporting mechanism or example, and any open question.
5. **Cross-source synthesis.** When multiple sources were used, the learner
   explains how they complement, repeat, or genuinely contradict each other.
6. **Socratic gap-filling.** Only now may the model teach, targeted at the gaps
   exposed above. Corrections cite the selected source when the claim comes from
   it and label model inference as inference.
7. **Closed-source teach-back.** The learner reconstructs the whole mechanism,
   invariant, failure modes, and prerequisite connections without looking.
8. **Application.** The learner performs the existing Build task or novel
   exercise. The model reviews and questions the attempt but must not edit
   files, execute the task, or write the learner's answer. It may provide the
   smallest necessary hint after a genuine attempt.
9. **Finalize.** Produce source evidence, cards, the terse Terrain note index,
   genuine application events, studied topics, and the next cold challenge.

For a previously studied topic, source selection and intake are normally
skipped. The session reopens a source only when recall exposes a source-level
gap, an `always` requirement applies, or freshness metadata requires
verification.

The conduct explicitly forbids recording `applicationEvents` for work performed
by the model. It also forbids adding the focus topic to `studiedTopics` before
all applicable source reconstruction and the closed-source teach-back finish.

## `learning-os` source evidence

The shared v2 contract gains an additive `sourceEvidence` array; version remains
2.

```ts
type SourceEvidence = {
  topicTitle: string;
  requirementId: string;
  sourceId?: string;
  sourceTitle: string;
  sourceUrl: string;
  mainClaim: string;
  supportingMechanism: string;
  openQuestion: string | null;
  substitutionReason: string | null;
  verifiedLiveAt: string | null;
  verificationNote: string | null;
};
```

`sourceTitle` and `sourceUrl` are snapshots so later curriculum changes do not
rewrite history. For a curated choice, `sourceId` must name an option inside the
requirement and `substitutionReason` must be null. For an unlisted equivalent,
`sourceId` is absent and a non-empty `substitutionReason` is mandatory.

When a curated option's verification interval has expired, `verifiedLiveAt` and
`verificationNote` are both mandatory. They record that the session checked the
current source and what remained valid or changed. Otherwise both fields are
null. Live verification satisfies that session; updating the shared curriculum
metadata remains a separate content-maintenance action.

An open question may genuinely be null; forcing filler text would lower evidence
quality. `mainClaim` and `supportingMechanism` are always required and non-empty.

## Persistence

Add a `SourceEvidence` model:

```prisma
model SourceEvidence {
  id                  String        @id @default(uuid())
  userId              String
  user                User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  topicId             String
  topic               Topic         @relation(fields: [topicId], references: [id], onDelete: Cascade)
  sessionExportId     String
  sessionExport       SessionExport @relation(fields: [sessionExportId], references: [id], onDelete: Cascade)
  requirementId       String
  sourceId             String?
  sourceTitle          String
  sourceUrl            String
  mainClaim            String
  supportingMechanism  String
  openQuestion         String?
  substitutionReason   String?
  verifiedLiveAt       DateTime?
  verificationNote     String?
  createdAt            DateTime      @default(now())

  @@unique([sessionExportId, topicId, requirementId])
  @@index([topicId, createdAt])
}
```

There is exactly one selected source per requirement, so the unique key matches
the source-plan model. Evidence is applied inside the existing import
transaction.

## Export and enforcement

`generateLearn()` adds `## SOURCE PLAN` between chapter context and the learning
goal. It includes applicable requirements, options, freshness state, estimated
time, user preferences, and prior evidence titles. `LEARN_CONDUCT` is rewritten
to enforce the approved session arc.

Import enforcement is based on the current topic state plus the source plan in
the database or in-batch proposed topic:

- A planned topic named in `studiedTopics` is first exposure and must satisfy
  every `first_exposure` and `always` requirement.
- An active or mastered topic must satisfy only `always` requirements; other
  evidence may still be imported voluntarily.
- `policy: none` has no requirements.
- A nullable legacy source plan does not block manual topics, but Preview shows
  `Source plan missing`. Prepared-course validation prevents new prepared
  reviewable leaves from entering this state.
- Curated evidence must resolve both requirement ID and source ID.
- Substitute evidence must include title, URL, and rationale.
- Duplicate evidence for one requirement is rejected by plan validation before
  the database unique constraint is reached.
- Missing or invented requirements, source IDs, expired options without paired
  live-verification evidence, and incomplete reconstructions make the plan
  inapplicable.
- As today, any inapplicable item blocks the entire import; there are no partial
  writes.

Terrain validates completeness and consistency. It does not claim to verify
that the learner honestly consumed the material or that every statement is
correct; those are session responsibilities.

## User interface

### Settings

Add the four source-preference controls to the existing Settings screen. Keep
the controls native: ordered format checkboxes/selects, numeric minutes,
language text/select, and a paid-source checkbox.

### Today and Session

The Learn card shows required source count and estimated intake time for Next
Up. The Session copy step repeats that estimate before context is copied. It
does not embed or proxy source content.

### Import Preview

Add a source-evidence section showing:

- each satisfied requirement and selected source;
- the learner's reconstruction;
- substitution badges and rationale;
- missing, unknown, stale, or duplicate requirements.

The existing Save action remains disabled for an inapplicable plan.

### Topic detail

Show the current source plan and historical evidence beneath the topic's
summary/reference section. Mark expired verification metadata visibly. Source
plans remain API-editable through normal topic updates; a specialized visual
source-plan editor is deferred until hand-editing becomes painful.

## Prepared Web3 curriculum migration

Every reviewable Web3 leaf is audited and converted from the `Resources:` prose
fragment to an explicit source plan. The audit must:

1. compare credible candidate sources;
2. identify each distinct instructional role;
3. choose alternatives only when they satisfy the same role;
4. use complementary requirement groups for genuinely different roles;
5. specify exact scopes and estimated time;
6. document why each option was selected;
7. mark freshness-sensitive sources with verification metadata;
8. use `policy: none` only with a concrete rationale.

The existing description keeps the concise concept explanation. Source URLs
move to `sourcePlan`; Build and Done-when stay in `aiContext` in this slice.

The content validator rejects a prepared reviewable leaf when:

- `sourcePlan` is absent;
- a required plan has no requirements or a requirement has no options;
- IDs collide within the plan;
- URL, scope, time, purpose, or selection reason is invalid or missing;
- a freshness-sensitive option has incomplete freshness metadata.

Existing imported Web3 topics receive a scoped, idempotent backfill that matches
`domain = Web3` and normalized title. It updates only `sourcePlan`, never user
status, notes, descriptions, cards, or prerequisite edits. Future course imports
receive source plans through the normal import path. General course sync remains
out of scope.

## Error handling

- Invalid source-plan JSON at an API/import boundary: 400 with the Zod path.
- First-exposure activation without required evidence: Preview is inapplicable
  and identifies each missing requirement.
- Unknown source/requirement ID: inapplicable; never silently treated as a
  substitute.
- Equivalent unlisted source without rationale: inapplicable.
- Curated source whose verification has expired: cannot be selected until the
  session records paired `verifiedLiveAt` and `verificationNote` evidence, or
  the plan's verification metadata is refreshed.
- Source inaccessible under current preferences: choose another curated option,
  substitute an equivalent, or stop the session without activation.
- Source intake exceeds the normal budget: the user may split the session or
  choose an equivalent shorter option; the system does not waive requirements.

## Testing

### Shared contract

- Valid `sourcePlan` variants and source evidence parse.
- Invalid URLs, empty scopes, invalid times, duplicate IDs, and incomplete
  freshness pairs fail.
- Curated evidence, expired-source live verification, and equivalent
  substitutions enforce their respective field rules.
- Existing v2 blocks without `sourceEvidence` still parse with an empty default.

### API

- Learn export renders source requirements before conduct and includes settings,
  timing, freshness, and prior evidence.
- First-exposure planned topics require all applicable evidence.
- Active/mastered topics require only `always` requirements.
- `policy: none` and nullable legacy behavior are distinct.
- Missing, duplicate, invented, stale, and substituted sources produce the
  specified preview results.
- Source evidence writes atomically with activation, cards, notes, and
  application events.
- Any invalid source evidence leaves every import side effect unapplied.
- User and topic scoping prevent cross-account evidence access.

### Prepared content

- All reviewable Web3 leaves have valid explicit policies.
- The content validator enforces exact scopes, reasons, times, IDs, and freshness
  metadata.
- The backfill is idempotent and updates only matching Web3 topics' source plan.

### Web

- Settings round-trip all source preferences.
- Today and Session show correct source counts and time.
- Preview renders satisfied, missing, stale, and substituted evidence.
- Topic detail renders current source plans and historical evidence.
- Production web build remains the compile/bundle gate.

### End-to-end smoke

Run one Web3 first-exposure session through source selection, intake,
reconstruction, cross-source synthesis, Socratic gap-filling, closed-source
teach-back, a learner-authored build, Preview, and Apply. Confirm evidence is
stored, activation succeeds, the application event exists only for learner work,
and the next cold challenge is preserved.

## Deferred until usage proves the need

- Global source deduplication and ratings.
- Automated link checking or scheduled freshness jobs.
- A visual source-plan editor.
- General prepared-course synchronization.
- Machine verification of video/article consumption.
