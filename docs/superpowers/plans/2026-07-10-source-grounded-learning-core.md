# Source-Grounded Learning Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured per-topic source plans, source-specific session evidence, and a strict first-exposure activation gate to Terrain.

**Architecture:** A validated JSON `Topic.sourcePlan` keeps curated choices local to each user-owned topic. A normalized `SourceEvidence` row stores what the learner reconstructed in a session. Pure source-plan helpers feed import validation, export rendering, timing summaries, and UI without creating a global resource subsystem.

**Tech Stack:** TypeScript 6, Zod, NestJS 11, Prisma 7/Postgres, React 19, TanStack Query, Jest, Vitest.

## Global Constraints

- Keep `learning-os` at version 2; `sourceEvidence` is additive and defaults to `[]`.
- One selected source satisfies one requirement; multiple required sources use multiple requirements.
- Prepared-course leaf validation is delivered in the separate Web3 rollout plan.
- Legacy/manual topics with `sourcePlan = null` warn but do not block activation.
- `policy: 'none'` is explicit and requires a rationale.
- Source preferences rank choices; they never waive requirements.
- Import remains atomic: any blocking source issue prevents every write.
- The model must never perform the learner's build or record its own work as an application event.
- Add no dependencies.
- Preserve unrelated working-tree changes.
- Do not execute a commit step unless the user explicitly authorizes commits.

---

## File map

- `packages/types/src/index.ts` — canonical source-plan and source-evidence schemas/types.
- `apps/api/src/sources/source-plan.ts` — pure parsing, applicability, expiry, and summary helpers.
- `apps/api/prisma/schema.prisma` + one migration — persistence for plans, preferences, and evidence.
- `apps/api/src/settings/*` — preference API.
- `apps/api/src/topics/*` — source-plan writes and evidence reads.
- `apps/api/src/import/import.service.ts` — resolve, preview, gate, and atomically store evidence.
- `apps/api/src/sessions/*` — render the source plan and enforce the learning ritual.
- `apps/api/src/metrics/*` — add source count/time to Next Up.
- `apps/web/src/api/types.ts` — API mirrors.
- `apps/web/src/screens/Settings/index.tsx` — preference controls.
- `apps/web/src/screens/Import/*` — evidence and issue preview.
- `apps/web/src/screens/Dashboard/TodayCard.tsx` — source estimate.
- `apps/web/src/components/TopicDetailPanel.tsx` — plan and evidence history.

---

### Task 1: Shared source schemas

**Files:**
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/src/learning-os.test.ts`

**Interfaces:**
- Produces: `sourcePlanSchema`, `SourcePlan`, `SourceRequirement`, `SourceOption`, `SourceEvidence`, and `LearningOsV2['sourceEvidence']`.
- Consumed by: Prisma-boundary helpers, import planning, topic DTOs, course content, and web mirror types.

- [ ] **Step 1: Add failing source-plan tests**

Add focused cases to `packages/types/src/learning-os.test.ts`:

```ts
import { learningOsV2Schema, sourcePlanSchema } from './index';

const option = {
  id: 'ethereum-accounts',
  title: 'Ethereum accounts',
  url: 'https://ethereum.org/developers/docs/accounts/',
  format: 'documentation' as const,
  scope: 'Externally-owned accounts',
  estimatedMinutes: 12,
  why: 'Canonical account semantics',
  verifiedAt: '2026-07-10',
  recheckAfterDays: 180,
};

it('accepts required and none source plans', () => {
  expect(
    sourcePlanSchema.parse({
      policy: 'required',
      requirements: [{
        id: 'canonical-account-model',
        purpose: 'Verify exact account semantics',
        requiredWhen: 'first_exposure',
        options: [option],
      }],
    }).policy,
  ).toBe('required');
  expect(sourcePlanSchema.parse({ policy: 'none', rationale: 'Pure drill' }).policy).toBe('none');
});

it('rejects duplicate ids and half-specified freshness', () => {
  const requirement = {
    id: 'canonical',
    purpose: 'Precision',
    requiredWhen: 'first_exposure' as const,
    options: [option, { ...option }],
  };
  expect(sourcePlanSchema.safeParse({ policy: 'required', requirements: [requirement] }).success)
    .toBe(false);
  expect(
    sourcePlanSchema.safeParse({
      policy: 'required',
      requirements: [{ ...requirement, options: [{ ...option, recheckAfterDays: undefined }] }],
    }).success,
  ).toBe(false);
});
```

- [ ] **Step 2: Add failing learning-os evidence tests**

```ts
const base = {
  version: 2 as const,
  reviews: [],
  proposedTopics: [],
  proposedPrompts: [],
  noteSummaries: [],
  applicationEvents: [],
};

it('defaults sourceEvidence and accepts curated evidence', () => {
  expect(learningOsV2Schema.parse(base).sourceEvidence).toEqual([]);
  const parsed = learningOsV2Schema.parse({
    ...base,
    sourceEvidence: [{
      topicTitle: 'Public-key cryptography & wallets',
      requirementId: 'canonical-account-model',
      sourceId: 'ethereum-accounts',
      sourceTitle: 'Ethereum accounts',
      sourceUrl: 'https://ethereum.org/developers/docs/accounts/',
      mainClaim: 'An EOA is controlled by its private key.',
      supportingMechanism: 'A transaction signature lets peers recover the public key.',
      openQuestion: null,
      substitutionReason: null,
      verifiedLiveAt: null,
      verificationNote: null,
    }],
  });
  expect(parsed.sourceEvidence).toHaveLength(1);
});

it('requires a rationale for an unlisted substitute', () => {
  const result = learningOsV2Schema.safeParse({
    ...base,
    sourceEvidence: [{
      topicTitle: 'T',
      requirementId: 'r',
      sourceTitle: 'Replacement',
      sourceUrl: 'https://example.com/replacement',
      mainClaim: 'Claim',
      supportingMechanism: 'Mechanism',
      openQuestion: null,
      substitutionReason: null,
      verifiedLiveAt: null,
      verificationNote: null,
    }],
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 3: Run the package tests and confirm RED**

Run: `yarn workspace @terrain/types test`

Expected: FAIL because `sourcePlanSchema` and `sourceEvidence` do not exist.

- [ ] **Step 4: Implement the schemas and exports**

Add the following shapes to `packages/types/src/index.ts`; use `.strict()` on every object and `.superRefine()` for duplicate IDs and paired freshness/live-verification fields:

```ts
const SOURCE_FORMATS = [
  'article', 'book', 'video', 'course', 'documentation', 'exercise',
] as const;

const sourceOptionSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  url: z.string().url().max(500),
  format: z.enum(SOURCE_FORMATS),
  scope: z.string().min(1).max(500),
  estimatedMinutes: z.number().int().min(1).max(600),
  why: z.string().min(1).max(1000),
  paid: z.boolean().optional(),
  language: z.string().min(2).max(50).optional(),
  verifiedAt: z.string().date().optional(),
  recheckAfterDays: z.number().int().min(1).max(3650).optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.verifiedAt == null) !== (value.recheckAfterDays == null)) {
    ctx.addIssue({ code: 'custom', message: 'verifiedAt and recheckAfterDays must appear together' });
  }
});

const sourceRequirementSchema = z.object({
  id: z.string().min(1).max(100),
  purpose: z.string().min(1).max(1000),
  requiredWhen: z.enum(['first_exposure', 'always']),
  options: z.array(sourceOptionSchema).min(1).max(20),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.options.map((option) => option.id)).size !== value.options.length) {
    ctx.addIssue({ code: 'custom', message: 'source option ids must be unique' });
  }
});

const requiredSourcePlanSchema = z.object({
  policy: z.literal('required'),
  requirements: z.array(sourceRequirementSchema).min(1).max(20),
  optional: z.array(sourceOptionSchema).max(50).optional(),
}).strict();

export const sourcePlanSchema = z.discriminatedUnion('policy', [
  z.object({ policy: z.literal('none'), rationale: z.string().min(1).max(1000) }).strict(),
  requiredSourcePlanSchema,
]).superRefine((value, ctx) => {
  if (value.policy === 'required') {
    const ids = value.requirements.map((requirement) => requirement.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'source requirement ids must be unique' });
    }
  }
});

export type SourcePlan = z.infer<typeof sourcePlanSchema>;
export type SourceRequirement = Extract<SourcePlan, { policy: 'required' }>['requirements'][number];
export type SourceOption = SourceRequirement['options'][number];
```

Extend `proposedTopicSchema` with `sourcePlan: sourcePlanSchema.optional()` and add a strict `sourceEvidenceSchema`. Its `.superRefine()` must enforce:

```ts
const curated = value.sourceId != null;
if (curated === (value.substitutionReason != null)) addIssue('curated evidence has no substitution; replacements require one');
if ((value.verifiedLiveAt == null) !== (value.verificationNote == null)) addIssue('live verification fields must appear together');
```

Add `sourceEvidence: z.array(sourceEvidenceSchema).max(50).default([])` to `learningOsV2Schema` and export `SourceEvidence`.

- [ ] **Step 5: Run tests and build the package**

Run: `yarn workspace @terrain/types test && yarn workspace @terrain/types build`

Expected: all types tests pass and `packages/types/dist` is regenerated.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add packages/types/src/index.ts packages/types/src/learning-os.test.ts
git commit -m "feat: define source plans and evidence contract"
```

---

### Task 2: Database persistence and pure source-plan helpers

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_source_grounded_learning/migration.sql`
- Create: `apps/api/src/sources/source-plan.ts`
- Test: `apps/api/src/sources/source-plan.spec.ts`

**Interfaces:**
- Consumes: `SourcePlan`, `SourceOption`, and `sourcePlanSchema` from Task 1.
- Produces: `parseStoredSourcePlan(value)`, `applicableRequirements(plan, status)`, `isSourceExpired(option, now)`, and `sourcePlanStats(plan, status, now)`.

- [ ] **Step 1: Write failing helper tests**

```ts
import {
  applicableRequirements,
  isSourceExpired,
  parseStoredSourcePlan,
  sourcePlanStats,
} from './source-plan';

const plan = {
  policy: 'required' as const,
  requirements: [
    { id: 'intro', purpose: 'Learn', requiredWhen: 'first_exposure' as const,
      options: [{ id: 'a', title: 'A', url: 'https://example.com/a', format: 'article' as const,
        scope: 'Entire article', estimatedMinutes: 10, why: 'Clear' }] },
    { id: 'current', purpose: 'Verify', requiredWhen: 'always' as const,
      options: [{ id: 'b', title: 'B', url: 'https://example.com/b', format: 'documentation' as const,
        scope: 'API section', estimatedMinutes: 5, why: 'Current', verifiedAt: '2026-01-01', recheckAfterDays: 30 }] },
  ],
};

it('selects first-exposure plus always requirements only for planned topics', () => {
  expect(applicableRequirements(plan, 'planned').map((r) => r.id)).toEqual(['intro', 'current']);
  expect(applicableRequirements(plan, 'active').map((r) => r.id)).toEqual(['current']);
});

it('computes expiry and minimum required time', () => {
  const now = new Date('2026-07-10T00:00:00Z');
  expect(isSourceExpired(plan.requirements[1].options[0], now)).toBe(true);
  expect(sourcePlanStats(plan, 'planned', now)).toEqual({ requiredCount: 2, estimatedMinutes: 15, hasExpired: true });
});

it('returns null for legacy storage and rejects malformed JSON', () => {
  expect(parseStoredSourcePlan(null)).toBeNull();
  expect(() => parseStoredSourcePlan({ policy: 'required', requirements: [] })).toThrow();
});
```

- [ ] **Step 2: Run the helper test and confirm RED**

Run: `yarn workspace @terrain/api test --runInBand src/sources/source-plan.spec.ts`

Expected: FAIL because the source helper does not exist.

- [ ] **Step 3: Extend the Prisma schema**

Add:

```prisma
model Topic {
  // existing fields
  sourcePlan      Json?
  sourceEvidence  SourceEvidence[]
}

model User {
  // existing fields
  sourceEvidence SourceEvidence[]
}

model SessionExport {
  // existing fields
  sourceEvidence SourceEvidence[]
}

model Settings {
  // existing fields
  preferredSourceFormats  String[] @default([])
  sourceTimeBudgetMinutes Int?
  sourceLanguage          String?
  allowPaidSources        Boolean  @default(false)
}

model SourceEvidence {
  id                  String        @id @default(uuid())
  userId              String
  user                User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  topicId             String
  topic               Topic         @relation(fields: [topicId], references: [id], onDelete: Cascade)
  sessionExportId     String
  sessionExport       SessionExport @relation(fields: [sessionExportId], references: [id], onDelete: Cascade)
  requirementId       String
  sourceId            String?
  sourceTitle         String
  sourceUrl           String
  mainClaim           String
  supportingMechanism String
  openQuestion        String?
  substitutionReason  String?
  verifiedLiveAt      DateTime?
  verificationNote    String?
  createdAt           DateTime      @default(now())

  @@unique([sessionExportId, topicId, requirementId])
  @@index([topicId, createdAt])
}
```

Generate the migration with `yarn workspace @terrain/api exec prisma migrate dev --name source_grounded_learning`, inspect the SQL, and retain only the additive columns/table/indexes above.

- [ ] **Step 4: Implement the pure helper**

In `apps/api/src/sources/source-plan.ts`, parse unknown Prisma JSON with `sourcePlanSchema`, return `[]` for `null`/`policy: none`, define expiry as `verifiedAt + recheckAfterDays < now`, and compute required time as the sum of the shortest option in each applicable requirement.

```ts
export function applicableRequirements(
  plan: SourcePlan | null,
  status: TopicStatus,
): SourceRequirement[];

export function isSourceExpired(option: SourceOption, now: Date): boolean;

export function sourcePlanStats(
  plan: SourcePlan | null,
  status: TopicStatus,
  now: Date,
): { requiredCount: number; estimatedMinutes: number; hasExpired: boolean };
```

- [ ] **Step 5: Generate Prisma and run tests**

Run:

```bash
yarn workspace @terrain/api exec prisma generate
yarn workspace @terrain/api test --runInBand src/sources/source-plan.spec.ts
yarn workspace @terrain/api build
```

Expected: helper tests pass and Nest builds.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add apps/api/prisma apps/api/src/sources
git commit -m "feat: persist source plans and evidence"
```

---

### Task 3: Source preference settings

**Files:**
- Modify: `apps/api/src/settings/dto.ts`
- Modify: `apps/api/src/settings/settings.service.ts`
- Test: `apps/api/src/settings/settings.service.spec.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/screens/Settings/index.tsx`

**Interfaces:**
- Produces API fields `preferredSourceFormats`, `sourceTimeBudgetMinutes`, `sourceLanguage`, and `allowPaidSources`.
- Consumed by learn export rendering and source option recommendations.

- [ ] **Step 1: Add failing settings service tests**

Add cases asserting defaults and allowlisted writes:

```ts
expect(await service.get('u1')).toMatchObject({
  preferredSourceFormats: [],
  sourceTimeBudgetMinutes: null,
  sourceLanguage: null,
  allowPaidSources: false,
});

await service.update('u1', {
  preferredSourceFormats: ['documentation', 'video'],
  sourceTimeBudgetMinutes: 45,
  sourceLanguage: 'en',
  allowPaidSources: false,
});
expect(prisma.settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
  update: expect.objectContaining({ sourceTimeBudgetMinutes: 45 }),
}));
```

- [ ] **Step 2: Run settings tests and confirm RED**

Run: `yarn workspace @terrain/api test --runInBand src/settings/settings.service.spec.ts`

Expected: FAIL because the fields are missing.

- [ ] **Step 3: Implement API validation and allowlisted persistence**

Use class-validator only:

```ts
const SOURCE_FORMATS = ['article', 'book', 'video', 'course', 'documentation', 'exercise'];

@IsOptional() @IsArray() @ArrayMaxSize(6) @IsIn(SOURCE_FORMATS, { each: true })
preferredSourceFormats?: string[];
@IsOptional() @IsInt() @Min(5) @Max(600) sourceTimeBudgetMinutes?: number | null;
@IsOptional() @IsString() @MaxLength(50) sourceLanguage?: string | null;
@IsOptional() @IsBoolean() allowPaidSources?: boolean;
```

Extend `SettingsView`, `DEFAULTS`, `toView()`, and the explicit `data` allowlist. Never spread the DTO into Prisma.

- [ ] **Step 4: Run API settings tests**

Run: `yarn workspace @terrain/api test --runInBand src/settings/settings.service.spec.ts src/settings/settings.controller.spec.ts`

Expected: PASS.

- [ ] **Step 5: Add the web types and one native Settings card**

Extend `Settings`/`UpdateSettingsInput`. Add a `Learning sources` card with:

- checkboxes for the six fixed formats plus Up/Down buttons beside each selected
  format; the array order shown is the array order sent to the API;
- numeric input `min=5`, `max=600`;
- language input;
- paid-source checkbox;
- its own Save button calling the existing `useUpdateSettings()` mutation.

Keep its local state separate from notification state so saving one card does not overwrite the other.

- [ ] **Step 6: Build web and run API tests**

Run:

```bash
yarn workspace @terrain/web build
yarn workspace @terrain/api test --runInBand src/settings
```

Expected: both pass.

- [ ] **Step 7: Commit checkpoint (only with explicit approval)**

```bash
git add apps/api/src/settings apps/web/src/api/types.ts apps/web/src/screens/Settings/index.tsx
git commit -m "feat: configure learning source preferences"
```

---

### Task 4: Topic source-plan writes and evidence reads

**Files:**
- Modify: `apps/api/src/topics/dto.ts`
- Modify: `apps/api/src/topics/topics.service.ts`
- Test: `apps/api/src/topics/topics.service.spec.ts`
- Modify: `apps/web/src/api/types.ts`

**Interfaces:**
- Produces: source-plan-aware create/update and `TopicDetail.sourceEvidence`.
- Consumed by prepared-course import, manual API edits, and Topic Detail UI.

- [ ] **Step 1: Add failing topic tests**

Add tests that create/update a valid plan, reject an invalid plan with 400, and return evidence newest-first in `getDetail()`.

```ts
await service.update('u1', 't1', { sourcePlan: validPlan });
expect(prisma.topic.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ sourcePlan: validPlan }),
}));

await expect(service.update('u1', 't1', {
  sourcePlan: { policy: 'required', requirements: [] },
} as never)).rejects.toThrow(BadRequestException);
```

- [ ] **Step 2: Run topic tests and confirm RED**

Run: `yarn workspace @terrain/api test --runInBand src/topics/topics.service.spec.ts`

Expected: FAIL because DTOs and detail queries do not support sources.

- [ ] **Step 3: Add a narrow source-plan DTO boundary**

Decorate the raw JSON property with `@IsOptional()` so the global whitelist
keeps it, then call `sourcePlanSchema.safeParse()` in `TopicsService`. Keep the
service allowlist explicit:

```ts
private parseSourcePlan(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  const parsed = sourcePlanSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data as Prisma.InputJsonValue;
}
```

Add `sourcePlan?: unknown | null` to create/update DTOs and use the parsed value rather than spreading raw DTO data into Prisma.

- [ ] **Step 4: Include evidence in topic detail**

Add `sourceEvidence: { orderBy: { createdAt: 'desc' } }` to `getDetail()` and
return it unchanged. Import `SourcePlan` and `SourceEvidence` from
`@terrain/types` in the web mirror, then define:

```ts
export interface SourceEvidenceRecord extends SourceEvidence {
  id: string;
  topicId: string;
  sessionExportId: string;
  verifiedLiveAt: string | null;
  createdAt: string;
}
```

Extend `Topic`/`TopicDetail` with `sourcePlan: SourcePlan | null` and
`sourceEvidence: SourceEvidenceRecord[]`.

- [ ] **Step 5: Run tests and builds**

Run:

```bash
yarn workspace @terrain/api test --runInBand src/topics/topics.service.spec.ts
yarn workspace @terrain/api build
yarn workspace @terrain/web build
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add apps/api/src/topics apps/web/src/api/types.ts
git commit -m "feat: expose topic source plans and evidence"
```

---

### Task 5: Import preview, strict source gate, and atomic evidence writes

**Files:**
- Modify: `apps/api/src/import/import.service.ts`
- Test: `apps/api/src/import/import.service.spec.ts`
- Modify: `apps/web/src/api/types.ts`

**Interfaces:**
- Consumes: `LearningOsV2['sourceEvidence']`, `parseStoredSourcePlan()`, `applicableRequirements()`, and `isSourceExpired()`.
- Produces: `SourceEvidencePlan[]`, `SourceIssue[]`, `ImportPlan.sourceEvidence`, `ImportPlan.sourceIssues`, and `ImportResult.sourceEvidenceApplied`.

- [ ] **Step 1: Define failing plan tests for valid curated evidence**

Create a planned topic with a two-requirement source plan, name it in `studiedTopics`, and provide both evidence entries. Assert:

```ts
expect(plan.sourceIssues).toEqual([]);
expect(plan.sourceEvidence).toHaveLength(2);
expect(plan.applicable).toBe(true);
```

- [ ] **Step 2: Add failing gate tests**

Cover each exact rule in separate tests:

```ts
expect(preview({ studiedTopics: ['T'], sourceEvidence: [] }).sourceIssues)
  .toContainEqual(expect.objectContaining({ requirementId: 'intro', reason: 'missing-evidence', blocking: true }));
expect(preview({ sourceEvidence: [unknownRequirement] }).sourceIssues)
  .toContainEqual(expect.objectContaining({ reason: 'unknown-requirement' }));
expect(preview({ sourceEvidence: [unknownCuratedSource] }).sourceIssues)
  .toContainEqual(expect.objectContaining({ reason: 'unknown-source' }));
expect(preview({ sourceEvidence: [duplicateRequirement, duplicateRequirement] }).sourceIssues)
  .toContainEqual(expect.objectContaining({ reason: 'duplicate' }));
```

Also test:

- planned studied topic requires `first_exposure` and `always`;
- active/mastered studied topic requires only `always`;
- `policy: none` passes;
- null legacy plan yields non-blocking `missing-plan`;
- expired curated option requires paired live-verification evidence;
- replacement without `sourceId` and with rationale passes;
- invalid source issue makes `applicable = false` even when `unresolved = []`.

- [ ] **Step 3: Run import tests and confirm RED**

Run: `yarn workspace @terrain/api test --runInBand src/import/import.service.spec.ts`

Expected: FAIL because source plans are ignored.

- [ ] **Step 4: Add plan shapes**

Define:

```ts
export type SourceEvidencePlan = LearningOsV2['sourceEvidence'][number] & {
  resolvedTopicId: string | null;
  substituted: boolean;
};

export interface SourceIssue {
  topicTitle: string;
  requirementId?: string;
  sourceId?: string;
  reason:
    | 'missing-plan'
    | 'missing-evidence'
    | 'unknown-requirement'
    | 'unknown-source'
    | 'duplicate'
    | 'verification-required';
  blocking: boolean;
  message: string;
}
```

Add `sourcePlan?: SourcePlan` to `NewTopicPlan`, `sourceEvidence` and `sourceIssues` to `ImportPlan`, and `sourceEvidenceApplied` to `ImportResult`.

- [ ] **Step 5: Build evidence plans after activations**

In `buildPlan()`, construct activations before source gating. For every evidence item:

1. resolve `topicTitle` against existing and in-batch topics;
2. obtain the existing topic's parsed source plan or the in-batch topic's `sourcePlan`;
3. reject repeated `(normalized topicTitle, requirementId)` pairs;
4. resolve curated `sourceId`, or validate the already-schema-checked substitute;
5. require live verification when `isSourceExpired(option, now)` is true.

Then walk every activation target and call `applicableRequirements()` using `planned` for in-batch topics. Add `missing-evidence` for each uncovered requirement. Add one non-blocking `missing-plan` issue for a null legacy plan.

Set:

```ts
applicable:
  unresolved.length === 0 &&
  !sourceIssues.some((issue) => issue.blocking) &&
  !alreadyImported
```

- [ ] **Step 6: Block apply on either unresolved references or source issues**

Replace the unresolved-only guard with:

```ts
const blockingSourceIssues = plan.sourceIssues.filter((issue) => issue.blocking);
if (plan.unresolved.length > 0 || blockingSourceIssues.length > 0) {
  throw new UnprocessableEntityException({
    message: 'Unresolved references or source requirements block import.',
    unresolved: plan.unresolved,
    sourceIssues: blockingSourceIssues,
  });
}
```

- [ ] **Step 7: Persist source plans and evidence atomically**

When creating a proposed topic, write `sourcePlan` if present. After creating topics and before activation, create each `SourceEvidence` row with the resolved topic id and current session-export id. Parse `verifiedLiveAt` into a `Date`; write null for optional fields. Return the exact created count as `sourceEvidenceApplied`.

- [ ] **Step 8: Prove rollback**

Add a transaction test where valid notes/application events accompany missing source evidence. Assert `$transaction` is never called or no write mocks run, matching the existing import test style.

- [ ] **Step 9: Run import tests and builds**

Run:

```bash
yarn workspace @terrain/api test --runInBand src/import/import.service.spec.ts
yarn workspace @terrain/api build
yarn workspace @terrain/web build
```

Expected: PASS.

- [ ] **Step 10: Commit checkpoint (only with explicit approval)**

```bash
git add apps/api/src/import apps/web/src/api/types.ts
git commit -m "feat: gate topic activation on source evidence"
```

---

### Task 6: Learn export and conduct enforcement

**Files:**
- Modify: `apps/api/src/sessions/export-generator.service.ts`
- Test: `apps/api/src/sessions/export-generator.service.spec.ts`
- Modify: `apps/api/src/sessions/session-conduct.ts`
- Test: `apps/api/src/sessions/session-conduct.spec.ts`
- Modify: `apps/api/src/sessions/output-contract.ts`
- Test: `apps/api/src/sessions/output-contract.spec.ts`

**Interfaces:**
- Consumes: stored source plans, evidence history, source preferences, and source-plan helpers.
- Produces: `## SOURCE PLAN`, the enforced nine-stage ritual, and documented `sourceEvidence` output.

- [ ] **Step 1: Add failing export tests**

For a planned focus topic with a two-requirement plan, assert ordering and content:

```ts
expect(md.indexOf('## SOURCE PLAN')).toBeLessThan(md.indexOf('## LEARNING GOAL'));
expect(md).toContain('canonical-account-model');
expect(md).toContain('Ethereum accounts');
expect(md).toContain('Scope: Externally-owned accounts');
expect(md).toContain('Estimated required intake: 2 sources · 27 min');
expect(md).toContain('Preferred formats: documentation, video');
```

Add cases for `policy: none`, null legacy plan warning, expired source marker, and active focus omitting `first_exposure` requirements.

- [ ] **Step 2: Add failing conduct/contract assertions**

Assert `LEARN_CONDUCT` includes the source order, pause, reconstruction, synthesis, closed-source teach-back, and exact prohibition:

```ts
expect(LEARN_CONDUCT).toContain('Do not teach the topic before required source reconstruction');
expect(LEARN_CONDUCT).toContain('do not edit files, execute the task, or write my answer');
expect(LEARN_CONDUCT).toContain('Do not list the topic in studiedTopics');
expect(OUTPUT_CONTRACT).toContain('"sourceEvidence"');
expect(OUTPUT_CONTRACT).toContain('substitutionReason');
expect(OUTPUT_CONTRACT).toContain('verifiedLiveAt');
```

- [ ] **Step 3: Run session tests and confirm RED**

Run:

```bash
yarn workspace @terrain/api test --runInBand src/sessions/export-generator.service.spec.ts src/sessions/session-conduct.spec.ts src/sessions/output-contract.spec.ts
```

Expected: FAIL on missing source content.

- [ ] **Step 4: Load the minimum extra data in `generateLearn()`**

Extend the focus selection with `sourcePlan` and the latest evidence titles. Fetch Settings once. Parse with `parseStoredSourcePlan()`. Render only applicable requirements using the current focus status. Show every option's ID, format, scope, time, why, paid/language flags, and expired marker.

Do not fetch or render source bodies.

- [ ] **Step 5: Rewrite `LEARN_CONDUCT` to the approved nine stages**

Keep the current elaborate/do/conspect/suggest behavior, but place it after source reconstruction. Include these hard gates verbatim:

```text
Do not teach the topic before every required source has been selected, consumed,
and reconstructed by me. Pause while I leave the chat to consume it; your own
summary is not a substitute.

During DO, do not edit files, execute the task, or write my answer. Review only
work I actually provide. Never record your own work in applicationEvents.

Do not list the topic in studiedTopics until required source reconstruction and
the closed-source teach-back are complete.
```

- [ ] **Step 6: Extend the output contract example and rules**

Add one curated evidence example with all nullable fields present. State that replacements omit `sourceId` and require a rationale; expired curated sources require both live-verification fields; entries describe what the learner actually reconstructed.

- [ ] **Step 7: Run session tests**

Run:

```bash
yarn workspace @terrain/api test --runInBand src/sessions/export-generator.service.spec.ts src/sessions/session-conduct.spec.ts src/sessions/output-contract.spec.ts
yarn workspace @terrain/api build
```

Expected: PASS.

- [ ] **Step 8: Commit checkpoint (only with explicit approval)**

```bash
git add apps/api/src/sessions
git commit -m "feat: enforce source-grounded learning sessions"
```

---

### Task 7: Next Up source timing

**Files:**
- Modify: `apps/api/src/metrics/metrics.service.ts`
- Test: `apps/api/src/metrics/metrics.service.spec.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/screens/Dashboard/TodayCard.tsx`
- Modify: `apps/web/src/screens/Session/index.tsx`

**Interfaces:**
- Consumes: `sourcePlanStats()`.
- Produces: `nextUp.sourcePlanStats = { requiredCount, estimatedMinutes, hasExpired }`.

- [ ] **Step 1: Add failing Next Up tests**

Add a planned Next Up topic with source-plan JSON and assert the returned DTO includes minimum required source count/time. Add null-plan and `policy: none` cases returning zeros.

- [ ] **Step 2: Run metrics tests and confirm RED**

Run: `yarn workspace @terrain/api test --runInBand src/metrics/metrics.service.spec.ts`

Expected: FAIL because Next Up has no source stats.

- [ ] **Step 3: Enrich the existing Next Up result**

Select `sourcePlan`, parse it once, and attach `sourcePlanStats(plan, topic.status, new Date())`. Do not add a second query.

- [ ] **Step 4: Render the estimate in TodayCard and Session copy step**

Extend the web DTO and render beneath the chapter line:

```tsx
{nextUp.sourcePlanStats.requiredCount > 0 && (
  <div className="faint" style={{ fontSize: 12.5 }}>
    {nextUp.sourcePlanStats.requiredCount} required source
    {nextUp.sourcePlanStats.requiredCount === 1 ? '' : 's'} ·
    {' '}~{nextUp.sourcePlanStats.estimatedMinutes} min intake
    {nextUp.sourcePlanStats.hasExpired ? ' · verification needed' : ''}
  </div>
)}
```

In `Session/index.tsx`, render the same line inside the `step === 'copy'` card
when `mode === 'learn'` and `dash.nextUp` exists. Reuse the dashboard DTO; do not
parse `exportMd`.

- [ ] **Step 5: Test and build**

Run:

```bash
yarn workspace @terrain/api test --runInBand src/metrics/metrics.service.spec.ts
yarn workspace @terrain/web build
```

Expected: PASS.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git add apps/api/src/metrics apps/web/src/api/types.ts apps/web/src/screens/Dashboard/TodayCard.tsx apps/web/src/screens/Session/index.tsx
git commit -m "feat: show source intake for next topic"
```

---

### Task 8: Import Preview and Topic Detail source UI

**Files:**
- Modify: `apps/web/src/screens/Import/sections.tsx`
- Modify: `apps/web/src/screens/Import/index.tsx`
- Modify: `apps/web/src/components/TopicDetailPanel.tsx`
- Create: `apps/web/src/screens/Import/sourceProjection.ts`
- Test: `apps/web/src/screens/Import/sourceProjection.test.ts`

**Interfaces:**
- Consumes: `ImportPlan.sourceEvidence`, `ImportPlan.sourceIssues`, `TopicDetail.sourcePlan`, and `TopicDetail.sourceEvidence`.
- Produces: visible proof, substitutions, warnings, and blocking reasons.

- [ ] **Step 1: Write the failing source-preview projection test**

Create `sourceProjection.test.ts` with one blocking issue and one warning, then
define the intended helper signature in the assertion:

```ts
expect(sourceIssueSummary(issues)).toEqual({
  blocking: [issues[0]],
  warnings: [issues[1]],
});
```

Use `reason: 'missing-evidence', blocking: true` and
`reason: 'missing-plan', blocking: false`.

- [ ] **Step 2: Run the focused web test and confirm RED**

Run: `yarn workspace @terrain/web test sourceProjection.test.ts`

Expected: FAIL because `sourceProjection.ts` does not exist.

- [ ] **Step 3: Implement the pure projection**

```ts
import type { SourceIssue } from '../../api/types';

export function sourceIssueSummary(issues: SourceIssue[]) {
  return {
    blocking: issues.filter((issue) => issue.blocking),
    warnings: issues.filter((issue) => !issue.blocking),
  };
}
```

- [ ] **Step 4: Add `SourceEvidenceSection` and `SourceIssuesPanel`**

Render each evidence entry with topic, requirement, selected source link, main claim, mechanism, open question, substitution badge/rationale, and live-verification note. Render blocking issues in the existing blocked color and warnings separately.

Insert both sections before Activations so users see why activation is or is not allowed. Keep Save disabled through the existing `plan.applicable` condition.

- [ ] **Step 5: Add the applied-result count**

Add `sourceEvidenceApplied` to the result stat strip with copy `source reconstructions stored`.

- [ ] **Step 6: Render source plans and evidence in Topic Detail**

Add a read-only `Learning sources` section:

- plan requirements/options with exact scopes and reasons;
- `No intake source — <rationale>` for `policy: none`;
- `Source plan missing` for null;
- evidence history grouped by session date, newest first;
- expired verification badges calculated in `sourceProjection.ts` as
  `Date.parse(verifiedAt) + recheckAfterDays * 86_400_000 < Date.now()`; omit the
  badge when either freshness field is absent.

Do not add a visual plan editor.

- [ ] **Step 7: Run focused tests and production build**

```bash
yarn workspace @terrain/web test sourceProjection.test.ts
yarn workspace @terrain/web build
```

Expected: tests and production build pass.

- [ ] **Step 8: Commit checkpoint (only with explicit approval)**

```bash
git add apps/web/src/screens/Import apps/web/src/components/TopicDetailPanel.tsx
git commit -m "feat: review source evidence in the web app"
```

---

### Task 9: Core verification and live smoke

**Files:**
- Modify only if verification exposes a defect in files already listed above.

**Interfaces:**
- Consumes the complete core.
- Produces a verified mechanism ready for the Web3 content rollout.

- [ ] **Step 1: Run focused package and API suites**

```bash
yarn workspace @terrain/types test
yarn workspace @terrain/api test --runInBand src/sources src/settings src/topics src/import src/sessions src/metrics
yarn workspace @terrain/web build
```

Expected: all pass.

- [ ] **Step 2: Run the repository gate**

```bash
yarn build
yarn test
yarn lint
yarn format:check
```

Expected: all commands exit 0. Preserve and report any failure caused by pre-existing unrelated working-tree changes rather than rewriting those files.

- [ ] **Step 3: Run database migration smoke**

```bash
docker compose up -d
yarn workspace @terrain/api exec prisma migrate deploy
yarn workspace @terrain/api exec prisma migrate status
```

Expected: migration applies and status reports the database is up to date.

- [ ] **Step 4: Run one strict first-exposure round trip**

Seed or create a planned topic with two source requirements. Generate `mode=learn`; confirm `SOURCE PLAN` precedes teaching. Prepare one `learning-os` block missing evidence and verify Preview is inapplicable. Add curated evidence for both requirements and verify Preview becomes applicable. Apply and confirm:

- two `SourceEvidence` rows exist;
- the topic becomes active;
- cards/notes/application event apply in the same transaction;
- Topic Detail shows the evidence;
- the next cold challenge survives.

- [ ] **Step 5: Verify rollback with the live API**

Generate another session, include a note and application event but omit one required source. Apply must return 422; query the topic and confirm neither note nor event changed.

- [ ] **Step 6: Commit checkpoint (only with explicit approval)**

```bash
git status --short
git add packages/types apps/api apps/web docs/superpowers/plans/2026-07-10-source-grounded-learning-core.md
git commit -m "feat: add source-grounded learning"
```

Expected: only files belonging to this plan are staged; unrelated user changes remain unstaged.
