# Adaptive Learning Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make roadmap progression chapter-safe, let the learner start any
eligible topic, support guided/source-first sessions, and expose one
authenticated learning-context response shared by REST and learn exports.

**Architecture:** A pure roadmap-policy module is the only definition of
leaf/group prerequisite satisfaction. A new `LearningContextService` queries
user-scoped data, applies that policy, and produces the shared Zod contract;
metrics, sessions, and the REST controller delegate to it. The existing session
wizard gains an explicit focus and learning-approach choice without adding a
new screen.

**Tech Stack:** Node 24, TypeScript 6, NestJS 11, Prisma 7/Postgres, Zod,
React 19, TanStack Router/react-query, Jest, Vitest.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-24-adaptive-learning-context-mcp-design.md`.
- A leaf is learned at `active|mastered`; FSRS mastery remains unchanged.
- A group prerequisite is satisfied only when every descendant leaf is
  `active|mastered`; planned and archived leaves block.
- Imported next focus is advisory and cannot leave the learnable frontier.
- All reads are current-user scoped; foreign topic IDs return `404`.
- `GET /learning/context` returns `Cache-Control: private, no-store`.
- Keep the `learning-os` v2 import/output contract unchanged.
- No MCP SDK, OAuth, vector store, embeddings, or write-capable AI tool in this
  plan.
- No new runtime dependency.
- Do not commit unless the user explicitly asks; replace commit checkpoints
  with `git diff --check` and focused test evidence.

---

## File map

**Create**

- `apps/api/src/learning/roadmap-policy.ts` — pure hierarchy/eligibility rules.
- `apps/api/src/learning/roadmap-policy.spec.ts` — exact chapter-completion and
  cycle fixtures.
- `apps/api/src/learning/approach.ts` — pure recommendation rule.
- `apps/api/src/learning/approach.spec.ts` — recommendation truth table.
- `apps/api/src/learning/learning-context.service.ts` — selection, evidence,
  blockers, and canonical context.
- `apps/api/src/learning/learning-context.service.spec.ts` — context,
  isolation, and selection-trace tests.
- `apps/api/src/learning/learning.controller.ts` — authenticated diagnostic
  endpoint.
- `apps/api/src/learning/learning.controller.spec.ts` — response/header/error
  contract.
- `apps/api/src/learning/learning.module.ts` — exports the context service.
- `packages/types/src/learning-context.test.ts` — shared contract tests.
- `apps/web/src/screens/Session/sessionChoice.ts` — pure focus/approach choice
  helpers.
- `apps/web/src/screens/Session/sessionChoice.test.ts` — client behavior tests.

**Modify**

- `packages/types/src/index.ts` — `LearningContext` Zod schema and types.
- `apps/api/src/app.module.ts` — import `LearningModule`.
- `apps/api/src/metrics/metrics.module.ts` — import `LearningModule`.
- `apps/api/src/metrics/metrics.service.ts` — delegate startable/Next Up policy.
- `apps/api/src/metrics/metrics.service.spec.ts` — new eligibility inputs.
- `apps/api/src/topics/topics.service.ts` — derive labels/blockers from policy.
- `apps/api/src/topics/topics.service.spec.ts` — chapter blocker response.
- `apps/api/src/sessions/session-conduct.ts` — two learning conduct scripts.
- `apps/api/src/sessions/session-conduct.spec.ts` — pin both rituals.
- `apps/api/src/sessions/export-generator.service.ts` — render learn mode from
  canonical context.
- `apps/api/src/sessions/export-generator.service.spec.ts` — explicit
  focus/approach/context coverage.
- `apps/api/src/sessions/sessions.service.ts` — resolve and persist focus and
  approach.
- `apps/api/src/sessions/sessions.service.spec.ts` — persistence tests.
- `apps/api/src/sessions/sessions.controller.ts` — validate/pass `approach`.
- `apps/api/src/sessions/sessions.module.ts` — import `LearningModule`.
- `apps/api/prisma/schema.prisma` — persisted learning approach.
- `apps/api/prisma/migrations/20260724000001_session_learning_approach/migration.sql`
  — enum/column migration.
- `apps/web/src/api/types.ts` — context, blocker, pending-focus, and approach
  response types.
- `apps/web/src/api/client.ts` — learning-context query and export approach.
- `apps/web/src/api/hooks.ts` — context hook and updated export mutation.
- `apps/web/src/app/router.tsx` — typed session search.
- `apps/web/src/components/TopicDetailPanel.tsx` — Learn/Deepen/blocker action.
- `apps/web/src/screens/Session/index.tsx` — approach choice and exact focus.
- `apps/web/src/screens/Dashboard/TodayCard.tsx` — focus-aware session link.

---

### Task 1: Pure recursive roadmap policy

**Files:**

- Create: `apps/api/src/learning/roadmap-policy.ts`
- Create: `apps/api/src/learning/roadmap-policy.spec.ts`

**Interfaces:**

- Consumes: flat, already user-scoped `RoadmapNode[]`.
- Produces:
  `buildRoadmapPolicy(nodes: RoadmapNode[]): Map<string, RoadmapEligibility>`.

- [ ] **Step 1: Write the exact failing Web3 regression**

```ts
import { buildRoadmapPolicy, type RoadmapNode } from './roadmap-policy';

const node = (
  id: string,
  status: RoadmapNode['status'],
  parentId: string | null = null,
  prerequisiteIds: string[] = [],
): RoadmapNode => ({ id, status, parentId, prerequisiteIds });

describe('buildRoadmapPolicy', () => {
  it('keeps Accounts blocked while Blockchain basics is 5/13', () => {
    const basics = Array.from({ length: 13 }, (_, i) =>
      node(`basic-${i + 1}`, i < 5 ? 'active' : 'planned', 'basics'),
    );
    const result = buildRoadmapPolicy([
      node('basics', 'active'),
      ...basics,
      node('accounts', 'planned', null, ['basics']),
    ]);

    expect(result.get('basics')).toMatchObject({
      kind: 'group',
      satisfied: false,
      learnedLeaves: 5,
      totalLeaves: 13,
    });
    expect(result.get('accounts')).toMatchObject({
      learnable: false,
      blockerIds: ['basics'],
    });
  });

  it('unlocks Accounts at 13/13 active or mastered', () => {
    const result = buildRoadmapPolicy([
      node('basics', 'active'),
      ...Array.from({ length: 13 }, (_, i) =>
        node(`basic-${i + 1}`, i % 2 ? 'active' : 'mastered', 'basics'),
      ),
      node('accounts', 'planned', null, ['basics']),
    ]);

    expect(result.get('accounts')?.learnable).toBe(true);
  });

  it('treats an archived descendant as unfinished', () => {
    const result = buildRoadmapPolicy([
      node('basics', 'active'),
      node('wallets', 'active', 'basics'),
      node('hashing', 'archived', 'basics'),
      node('accounts', 'planned', null, ['basics']),
    ]);
    expect(result.get('accounts')?.learnable).toBe(false);
    expect(result.get('basics')?.unfinishedLeafIds).toEqual(['hashing']);
  });

  it('preserves the active direct-leaf prerequisite rule', () => {
    const result = buildRoadmapPolicy([
      node('arrays', 'active'),
      node('two-sum', 'planned', null, ['arrays']),
    ]);
    expect(result.get('two-sum')?.learnable).toBe(true);
  });

  it('fails closed and terminates on a hierarchy cycle', () => {
    const result = buildRoadmapPolicy([
      node('a', 'active', 'b'),
      node('b', 'active', 'a'),
      node('target', 'planned', null, ['a']),
    ]);
    expect(result.get('a')?.cycle).toBe(true);
    expect(result.get('target')?.learnable).toBe(false);
  });

  it('fails closed when a prerequisite is outside the owned graph', () => {
    const result = buildRoadmapPolicy([
      node('target', 'planned', null, ['unavailable']),
    ]);
    expect(result.get('target')).toMatchObject({
      learnable: false,
      blockerIds: ['unavailable'],
    });
  });
});
```

- [ ] **Step 2: Run the regression and verify RED**

Run:

```bash
yarn workspace @terrain/api test --runInBand roadmap-policy.spec.ts
```

Expected: FAIL because `./roadmap-policy` does not exist.

- [ ] **Step 3: Implement the minimum policy**

```ts
import type { TopicStatus } from '@prisma/client';

export type RoadmapNode = {
  id: string;
  parentId: string | null;
  status: TopicStatus;
  prerequisiteIds: string[];
};

export type RoadmapEligibility = {
  kind: 'leaf' | 'group';
  learned: boolean;
  satisfied: boolean;
  learnable: boolean;
  learnedLeaves: number;
  totalLeaves: number;
  unfinishedLeafIds: string[];
  blockerIds: string[];
  cycle: boolean;
};

const learned = (status: TopicStatus) => status === 'active' || status === 'mastered';

export function buildRoadmapPolicy(
  nodes: RoadmapNode[],
): Map<string, RoadmapEligibility> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  }

  const facts = new Map<
    string,
    { leafIds: string[]; satisfied: boolean; cycle: boolean }
  >();
  const inspect = (
    id: string,
    visiting = new Set<string>(),
  ): { leafIds: string[]; satisfied: boolean; cycle: boolean } => {
    const cached = facts.get(id);
    if (cached) return cached;
    const current = byId.get(id);
    if (!current || visiting.has(id)) return { leafIds: [], satisfied: false, cycle: true };
    const childIds = children.get(id) ?? [];
    if (childIds.length === 0) {
      const fact = { leafIds: [id], satisfied: learned(current.status), cycle: false };
      facts.set(id, fact);
      return fact;
    }
    const next = new Set(visiting).add(id);
    const childFacts = childIds.map((childId) => inspect(childId, next));
    const leafIds = childFacts.flatMap((fact) => fact.leafIds);
    const cycle = childFacts.some((fact) => fact.cycle);
    const fact = {
      leafIds,
      satisfied:
        !cycle &&
        (leafIds.length > 0
          ? leafIds.every((leafId) => learned(byId.get(leafId)!.status))
          : learned(current.status)),
      cycle,
    };
    facts.set(id, fact);
    return fact;
  };

  for (const node of nodes) inspect(node.id);

  return new Map(
    nodes.map((node) => {
      const fact = inspect(node.id);
      const kind = (children.get(node.id) ?? []).length > 0 ? 'group' : 'leaf';
      const unfinishedLeafIds = fact.leafIds.filter(
        (leafId) => !learned(byId.get(leafId)!.status),
      );
      const blockerIds = node.prerequisiteIds.filter(
        (prerequisiteId) => !inspect(prerequisiteId).satisfied,
      );
      return [
        node.id,
        {
          kind,
          learned: learned(node.status),
          satisfied: fact.satisfied,
          learnable: node.status === 'planned' && kind === 'leaf' && blockerIds.length === 0,
          learnedLeaves: fact.leafIds.length - unfinishedLeafIds.length,
          totalLeaves: fact.leafIds.length,
          unfinishedLeafIds,
          blockerIds,
          cycle: fact.cycle,
        },
      ];
    }),
  );
}
```

- [ ] **Step 4: Run policy tests and verify GREEN**

Run the Task 1 command again.

Expected: 6 tests pass.

- [ ] **Step 5: Check the task diff**

Run:

```bash
git diff --check
git status --short
```

Expected: only the two new policy files plus the already-approved spec/plan
documents are new or modified.

---

### Task 2: Make metrics and topic labels consume the policy

**Files:**

- Modify: `apps/api/src/metrics/metrics.service.ts`
- Modify: `apps/api/src/metrics/metrics.service.spec.ts`
- Modify: `apps/api/src/topics/topics.service.ts`
- Modify: `apps/api/src/topics/topics.service.spec.ts`

**Interfaces:**

- Consumes: `buildRoadmapPolicy(RoadmapNode[])`.
- Produces: unchanged `nextUp()`/dashboard response plus topic
  `labels.blocked`, `blockers`, and `descendantProgress`.

- [ ] **Step 1: Replace the old truth-table tests with policy-backed failures**

Add a metrics test whose `topic.findMany` returns the 5/13 fixture and assert:

```ts
it('nextUp does not cross an incomplete prerequisite chapter', async () => {
  prisma.topic.findMany.mockResolvedValue([
    {
      id: 'basics',
      title: 'Blockchain basics',
      parentId: null,
      status: 'active',
      createdAt: new Date('2026-01-01'),
      prerequisites: [],
    },
    ...Array.from({ length: 13 }, (_, i) => ({
      id: `basic-${i + 1}`,
      title: `Basic ${i + 1}`,
      parentId: 'basics',
      status: i < 5 ? 'active' : 'planned',
      createdAt: new Date(`2026-01-${String(i + 2).padStart(2, '0')}`),
      prerequisites: [],
    })),
    {
      id: 'accounts',
      title: 'Accounts, transactions & gas',
      parentId: null,
      status: 'planned',
      createdAt: new Date('2026-02-01'),
      prerequisites: [{ prerequisiteId: 'basics' }],
    },
  ]);

  expect(await service.nextUp('userA')).toMatchObject({
    topic: { id: 'basic-6', title: 'Basic 6' },
  });
});
```

Extend `TopicsService.findAll` coverage to expect:

```ts
expect(accounts.labels.blocked).toBe(true);
expect(accounts.blockers).toEqual([
  {
    id: 'basics',
    title: 'Blockchain basics',
    learnedLeaves: 5,
    totalLeaves: 13,
    unfinishedLeaves: expect.arrayContaining([
      expect.objectContaining({ id: 'basic-6', status: 'planned' }),
    ]),
  },
]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
yarn workspace @terrain/api test --runInBand metrics.service.spec.ts topics.service.spec.ts
```

Expected: the 5/13 metrics case incorrectly selects Accounts instead of Basic
6, and topic results have no `blockers`.

- [ ] **Step 3: Replace `startablePlannedIds` with one graph query**

Load the whole owned topology so a cross-domain prerequisite is never mistaken
for missing. Filter candidate leaves by the requested/enabled domains after
policy evaluation, preserving SQL order:

```ts
const topics = await this.prisma.topic.findMany({
  where: { userId },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: {
    id: true,
    domain: true,
    parentId: true,
    status: true,
    prerequisites: { select: { prerequisiteId: true } },
  },
});
const policy = buildRoadmapPolicy(
  topics.map((topic) => ({
    id: topic.id,
    parentId: topic.parentId,
    status: topic.status,
    prerequisiteIds: topic.prerequisites.map((edge) => edge.prerequisiteId),
  })),
);
return topics
  .filter((topic) =>
    domain ? topic.domain === domain : !disabledDomains.includes(topic.domain),
  )
  .filter((topic) => policy.get(topic.id)?.learnable)
  .map((topic) => topic.id);
```

Change `topicLabels` to accept the already-derived value:

```ts
topicLabels(input: { status: string; cards: { reps: number }[]; blocked: boolean }) {
  return {
    blocked: input.status === 'planned' && input.blocked,
    reviewing: input.status === 'active' && input.cards.some((card) => card.reps > 0),
  };
}
```

- [ ] **Step 4: Derive topic labels and blocker details once in `findAll`**

After the existing topic query, build the policy from the returned flat graph.
For each blocker ID, project:

```ts
const blocker = topicById.get(blockerId);
if (!blocker) {
  return {
    id: blockerId,
    title: 'Unavailable prerequisite',
    learnedLeaves: 0,
    totalLeaves: 0,
    unfinishedLeaves: [],
  };
}
const blockerPolicy = policy.get(blockerId)!;
return {
  id: blocker.id,
  title: blocker.title,
  learnedLeaves: blockerPolicy.learnedLeaves,
  totalLeaves: blockerPolicy.totalLeaves,
  unfinishedLeaves: blockerPolicy.unfinishedLeafIds.map((id) => {
    const leaf = topicById.get(id)!;
    return { id: leaf.id, title: leaf.title, status: leaf.status };
  }),
}
```

Never query a missing blocker without `userId` and never reveal a foreign
topic title. Add a malformed cross-user-edge fixture that returns
`Unavailable prerequisite` and remains blocked.

Add the same topology-only query to `getDetail`; do not recursively query per
prerequisite.

- [ ] **Step 5: Update old `topicLabels` callers/tests**

Every call now passes:

```ts
blocked: topic.status === 'planned' && policy.get(topic.id)?.learnable === false
```

Reviewing tests pass `blocked: false`; delete all tests that try to reconstruct
chapter policy from only `prerequisiteStatuses`.

- [ ] **Step 6: Run focused and full API tests**

```bash
yarn workspace @terrain/api test --runInBand metrics.service.spec.ts topics.service.spec.ts
yarn workspace @terrain/api test --runInBand
```

Expected: both commands pass.

- [ ] **Step 7: Check the task diff**

Run `git diff --check` and inspect only the four intended production/test files
plus Task 1 files.

---

### Task 3: Add the shared learning-context contract

**Files:**

- Modify: `packages/types/src/index.ts`
- Create: `packages/types/src/learning-context.test.ts`

**Interfaces:**

- Produces: `learningContextSchema`, `LearningContext`,
  `LearningApproach`, `LEARNING_APPROACHES`.
- Consumers: Tasks 4–7 API/web code.

- [ ] **Step 1: Write schema tests first**

```ts
import { learningContextSchema } from './index';

const minimal = {
  schemaVersion: 1,
  generatedAt: '2026-07-24T12:00:00.000Z',
  learner: { role: null, learningStyle: null, codeStyle: null, noteSystem: null },
  target: null,
  selection: { source: 'none', importedFocus: null, learnableAlternatives: [] },
  prerequisites: [],
  mayRelyOn: [],
  doNotAssume: [],
  blockers: [],
};

it('parses the minimal no-target context', () => {
  expect(learningContextSchema.parse(minimal)).toEqual(minimal);
});

it('rejects unknown fields so transport payloads cannot drift', () => {
  expect(learningContextSchema.safeParse({ ...minimal, token: 'secret' }).success).toBe(false);
});

it('accepts a guided target with source plan and prompt evidence', () => {
  expect(
    learningContextSchema.safeParse({
      ...minimal,
      target: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Hashing',
        domain: 'Web3',
        topicType: 'pattern',
        kind: 'leaf',
        sessionEligible: true,
        status: 'planned',
        description: null,
        sourcePlan: { policy: 'none', rationale: 'Guided implementation' },
        chapter: {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Basics',
          learnedLeaves: 5,
          totalLeaves: 13,
        },
        approach: { recommended: 'guided', reasons: ['contains a code prompt'] },
        prompts: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            kind: 'code',
            text: 'Implement hashing',
            state: 'new',
            difficulty: null,
            stability: null,
            lastGrade: null,
          },
        ],
      },
    }).success,
  ).toBe(true);
});
```

- [ ] **Step 2: Run types tests and verify RED**

```bash
yarn workspace @terrain/types test --run learning-context.test.ts
```

Expected: FAIL because `learningContextSchema` is not exported.

- [ ] **Step 3: Add strict schemas and inferred types**

Add `LEARNING_APPROACHES = ['guided', 'source-first'] as const`. Reuse
`sourcePlanSchema` and `GRADES`; add these strict schemas:

```ts
export const LEARNING_APPROACHES = ['guided', 'source-first'] as const;
export type LearningApproach = (typeof LEARNING_APPROACHES)[number];

const topicStatusSchema = z.enum(['planned', 'active', 'mastered', 'archived']);
const knowledgeLevelSchema = z.enum(['unseen', 'introduced', 'practicing', 'mastered']);
const evidenceSchema = z
  .object({
    recentGrades: z.array(z.enum(GRADES)).max(3),
    lastReviewedAt: z.string().datetime().nullable(),
    sourceTitles: z.array(z.string()),
    applicationCount: z.number().int().nonnegative(),
    latestApplication: z.string().nullable(),
  })
  .strict();

const knowledgeContextSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    status: topicStatusSchema,
    level: knowledgeLevelSchema,
    reason: z.string(),
    summary: z.string().nullable(),
    evidence: evidenceSchema,
  })
  .strict();

type PrerequisiteContextShape = {
  id: string;
  title: string;
  status: TopicStatus;
  satisfied: boolean;
  reason: string;
  learnedLeaves: number;
  totalLeaves: number;
  summary: string | null;
  evidence: z.infer<typeof evidenceSchema>;
  children: PrerequisiteContextShape[];
};

const prerequisiteContextSchema: z.ZodType<PrerequisiteContextShape> = z.lazy(() =>
  z
    .object({
      id: z.string().uuid(),
      title: z.string(),
      status: topicStatusSchema,
      satisfied: z.boolean(),
      reason: z.string(),
      learnedLeaves: z.number().int().nonnegative(),
      totalLeaves: z.number().int().nonnegative(),
      summary: z.string().nullable(),
      evidence: evidenceSchema,
      children: z.array(prerequisiteContextSchema),
    })
    .strict(),
);

export const learningContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().datetime(),
    learner: z
      .object({
        role: z.string().nullable(),
        learningStyle: z.string().nullable(),
        codeStyle: z.string().nullable(),
        noteSystem: z.string().nullable(),
      })
      .strict(),
    target: z
      .object({
        id: z.string().uuid(),
        title: z.string(),
        domain: z.string(),
        topicType: z.string(),
        kind: z.enum(['leaf', 'group']),
        sessionEligible: z.boolean(),
        status: topicStatusSchema,
        description: z.string().nullable(),
        sourcePlan: sourcePlanSchema.nullable(),
        chapter: z
          .object({
            id: z.string().uuid(),
            title: z.string(),
            learnedLeaves: z.number().int().nonnegative(),
            totalLeaves: z.number().int().nonnegative(),
          })
          .strict()
          .nullable(),
        approach: z
          .object({
            recommended: z.enum(LEARNING_APPROACHES),
            reasons: z.array(z.string().min(1)).min(1),
          })
          .strict(),
        prompts: z.array(
          z
            .object({
              id: z.string().uuid(),
              kind: z.enum(['concept', 'code', 'problem']),
              text: z.string(),
              state: z.enum(['new', 'learning', 'review', 'relearning']),
              difficulty: z.number().nullable(),
              stability: z.number().nullable(),
              lastGrade: z.enum(GRADES).nullable(),
            })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
    selection: z
      .object({
        source: z.enum(['explicit', 'imported-focus', 'authored-order', 'none']),
        importedFocus: z
          .object({
            title: z.string(),
            accepted: z.boolean(),
            reason: z.string(),
          })
          .strict()
          .nullable(),
        learnableAlternatives: z.array(
          z
            .object({
              id: z.string().uuid(),
              title: z.string(),
              chapterTitle: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    prerequisites: z.array(prerequisiteContextSchema),
    mayRelyOn: z.array(knowledgeContextSchema),
    doNotAssume: z.array(knowledgeContextSchema),
    blockers: z.array(
      z
        .object({
          topicId: z.string().uuid(),
          title: z.string(),
          reason: z.string(),
          learnedLeaves: z.number().int().nonnegative().optional(),
          totalLeaves: z.number().int().nonnegative().optional(),
          unfinishedLeaves: z
            .array(
              z
                .object({
                  id: z.string().uuid(),
                  title: z.string(),
                  status: topicStatusSchema,
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type LearningContext = z.infer<typeof learningContextSchema>;
```

- [ ] **Step 4: Run the package tests and build**

```bash
yarn workspace @terrain/types test
yarn workspace @terrain/types build
```

Expected: all tests pass and TypeScript exits 0.

- [ ] **Step 5: Check the task diff**

Run `git diff --check`; verify no `learning-os` schema field changed.

---

### Task 4: Implement the explainable approach recommendation

**Files:**

- Create: `apps/api/src/learning/approach.ts`
- Create: `apps/api/src/learning/approach.spec.ts`

**Interfaces:**

- Consumes:
  `SourcePlan | null`, topic status, current time, recent grades, and active
  prompt kinds.
- Produces:
  `recommendApproach(input): { recommended: LearningApproach; reasons: string[] }`.

- [ ] **Step 1: Write the failing truth table**

Cover these exact outcomes:

```ts
it.each([
  [{ status: 'active', recentGrades: [], promptKinds: [], plan: null }, 'guided'],
  [{ status: 'planned', recentGrades: ['hard'], promptKinds: [], plan: null }, 'guided'],
  [{ status: 'planned', recentGrades: [], promptKinds: ['code'], plan: null }, 'guided'],
  [{ status: 'planned', recentGrades: [], promptKinds: [], plan: oneSourcePlan }, 'source-first'],
  [{ status: 'planned', recentGrades: [], promptKinds: [], plan: twoSourcePlan }, 'guided'],
  [{ status: 'planned', recentGrades: ['hard'], promptKinds: ['code'], plan: alwaysPlan }, 'source-first'],
])('recommends from explainable signals', (input, expected) => {
  expect(recommendApproach({ ...input, now: NOW }).recommended).toBe(expected);
});
```

Also assert that every result has at least one non-empty reason.

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand approach.spec.ts
```

Expected: FAIL because `approach.ts` does not exist.

- [ ] **Step 3: Implement the ordered rule**

Use `parseStoredSourcePlan`, `applicableRequirements`, and `isSourceExpired`.
“No non-expired option” is:

```ts
requirements.some(
  (requirement) =>
    requirement.requiredWhen === 'always' ||
    requirement.options.every((option) => isSourceExpired(option, input.now)),
)
```

Then apply, in order: authoritative/current source requirement; active/mastered;
recent `again|hard`; `code|problem`; two or more requirements; exactly one
requirement; guided fallback. Return the first matching rule and its concrete
reason string.

- [ ] **Step 4: Run and verify GREEN**

Run the Task 4 command again.

Expected: all approach cases pass.

---

### Task 5: Build canonical context and the diagnostic endpoint

**Files:**

- Create: `apps/api/src/learning/learning-context.service.ts`
- Create: `apps/api/src/learning/learning-context.service.spec.ts`
- Create: `apps/api/src/learning/learning.controller.ts`
- Create: `apps/api/src/learning/learning.controller.spec.ts`
- Create: `apps/api/src/learning/learning.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/metrics/metrics.module.ts`
- Modify: `apps/api/src/metrics/metrics.service.ts`

**Interfaces:**

- Produces:
  - `context(userId, { topic?, domain?, now? }): Promise<LearningContext>`
  - `nextUp(userId, domain?, now?): Promise<NextUp | null>`
- REST: `GET /learning/context?topic=<id-or-title>`.

- [ ] **Step 1: Write failing service tests at the real selection seam**

Use a Prisma mock with `settings.findUnique`, `topic.findMany`,
`sessionExport.findFirst`, `user.findUnique`, `review.findMany`,
`sourceEvidence.findMany`, and `applicationEvent.findMany`. Pin:

1. No explicit topic rejects blocked imported Accounts, selects the first
   learnable Basics leaf, and records the rejection reason.
2. Explicit foreign/missing ID throws `NotFoundException`.
3. A 5/13 group blocker includes eight unfinished leaves.
4. Active prerequisites with evidence land in `mayRelyOn`; introduced active
   prerequisites land in `doNotAssume`.
5. A hierarchy cycle terminates with a blocker.

The core assertion for case 1 is:

```ts
expect(context.selection).toMatchObject({
  source: 'authored-order',
  importedFocus: {
    title: 'Accounts, transactions & gas',
    accepted: false,
    reason: expect.stringContaining('Blockchain basics'),
  },
});
expect(context.target?.title).toBe('Public-key cryptography & wallets');
```

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand learning-context.service.spec.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement graph loading and target resolution**

Use one ordered topology query selecting topic scalar context,
`prerequisiteId`, prompts, and parent IDs. Apply disabled domains only when no
explicit domain is requested. Resolve `topic` by owned ID first, then normalized
title. Throw `ConflictException` if legacy data yields more than one normalized
title match.

Keep one private result:

```ts
type Selection = {
  targetId: string | null;
  source: 'explicit' | 'imported-focus' | 'authored-order' | 'none';
  importedFocus: LearningContext['selection']['importedFocus'];
  graph: LoadedTopic[];
  policy: Map<string, RoadmapEligibility>;
};
```

`nextUp()` uses this lightweight selection and projects the existing `NextUp`
shape; it must not load detailed evidence.

For an explicit target, set:

```ts
kind: targetPolicy.kind,
sessionEligible:
  targetPolicy.kind === 'leaf' &&
  (targetPolicy.learnable || target.status === 'active' || target.status === 'mastered'),
```

The diagnostic endpoint may still return groups, blocked planned leaves, and
archived leaves with `sessionEligible: false`; only export generation rejects
them.

- [ ] **Step 4: Load only relevant evidence**

For `context()`, compute target + recursive prerequisite IDs. Query evidence
only for those IDs:

```ts
const [learner, reviewGroups, sourceEvidence, applicationEvents] = await Promise.all([
  prisma.user.findUnique({ where: { id: userId }, select: {
    headline: true, learningStyle: true, codeStyle: true, noteSystem: true,
  }}),
  Promise.all(
    relevantIds.map((topicId) =>
      prisma.review.findMany({
        where: { userId, topicId },
        orderBy: { reviewedAt: 'desc' },
        take: 3,
        select: { topicId: true, grade: true, reviewedAt: true, promptId: true },
      }),
    ),
  ),
  prisma.sourceEvidence.findMany({
    where: { userId, topicId: { in: relevantIds } },
    orderBy: { createdAt: 'desc' },
    select: { topicId: true, sourceTitle: true },
  }),
  prisma.applicationEvent.findMany({
    where: { userId, topicId: { in: relevantIds } },
    orderBy: { appliedAt: 'desc' },
    select: { topicId: true, description: true },
  }),
]);
const reviews = reviewGroups.flat();
```

Classify knowledge exactly as the design specifies. Return
`learningContextSchema.parse(result)` at the service boundary so REST, exports,
and later MCP cannot drift.

- [ ] **Step 5: Add the authenticated controller**

```ts
@Controller('learning')
export class LearningController {
  constructor(private readonly learning: LearningContextService) {}

  @Get('context')
  async context(
    @CurrentUser() userId: string,
    @Query('topic') topic: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.learning.context(userId, { topic });
  }
}
```

Trim the query; reject an empty supplied value or values over 300 characters
with `BadRequestException`.

- [ ] **Step 6: Register the module and delegate metrics Next Up**

`LearningModule` imports `PrismaModule`, provides/exports
`LearningContextService`, and owns the controller. Import it in `AppModule`,
`MetricsModule`, and later `SessionsModule`. `MetricsService.nextUp()` becomes:

```ts
return this.learning.nextUp(userId, domain, now);
```

Delete its duplicate imported-focus selection code.

- [ ] **Step 7: Run service/controller/metrics tests**

```bash
yarn workspace @terrain/api test --runInBand learning-context.service.spec.ts learning.controller.spec.ts metrics.service.spec.ts
```

Expected: all pass, including the original Next Up consumers.

- [ ] **Step 8: Run API build**

```bash
yarn workspace @terrain/api build
```

Expected: exit 0.

---

### Task 6: Persist focus/approach and render the two conduct scripts

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create:
  `apps/api/prisma/migrations/20260724000001_session_learning_approach/migration.sql`
- Modify: `apps/api/src/sessions/session-conduct.ts`
- Modify: `apps/api/src/sessions/session-conduct.spec.ts`
- Modify: `apps/api/src/sessions/export-generator.service.ts`
- Modify: `apps/api/src/sessions/export-generator.service.spec.ts`
- Modify: `apps/api/src/sessions/sessions.service.ts`
- Modify: `apps/api/src/sessions/sessions.service.spec.ts`
- Modify: `apps/api/src/sessions/sessions.controller.ts`
- Modify: `apps/api/src/sessions/sessions.module.ts`

**Interfaces:**

- `createExport(userId, { mode?, focusTopicId?, approach? })`.
- Learn exports persist resolved focus and
  `LearningApproach = guided|source_first`.

- [ ] **Step 1: Add failing persistence and conduct tests**

Pin that a default learn export:

```ts
learning.context.mockResolvedValue(contextWithTarget('t1', 'guided'));
await service.createExport('u1', { mode: 'learn' });
expect(prisma.sessionExport.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    userId: 'u1',
    mode: 'learn',
    focusTopicId: 't1',
    approach: 'guided',
  }),
});
```

Pin an explicit `source-first` override as `source_first`. In
`session-conduct.spec.ts`, assert Guided contains `Calibrate`, `Explain
incrementally`, `Do`, and “must not write my answer”; assert Source-first still
contains `SELECT`, `CONSUME`, `RECONSTRUCT`, and the source gate.

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/api test --runInBand sessions.service.spec.ts session-conduct.spec.ts export-generator.service.spec.ts
```

Expected: approach persistence and Guided conduct assertions fail.

- [ ] **Step 3: Add the Prisma enum/column**

Schema:

```prisma
enum LearningApproach {
  guided
  source_first
}

model SessionExport {
  // existing fields
  approach LearningApproach?
}
```

Migration SQL:

```sql
CREATE TYPE "LearningApproach" AS ENUM ('guided', 'source_first');
ALTER TABLE "SessionExport" ADD COLUMN "approach" "LearningApproach";
```

Run:

```bash
yarn workspace @terrain/api exec prisma generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 4: Split the conduct scripts**

Rename current `LEARN_CONDUCT` to `SOURCE_FIRST_CONDUCT`. Add
`GUIDED_CONDUCT` implementing the seven approved stages verbatim from design
§6.1. Both scripts retain the existing output-recording rules, including:

```text
Never write the learner's implementation or record the assistant's work as an
applicationEvent. Add the topic to studiedTopics only after teach-back and the
learner-authored DO challenge are complete.
```

- [ ] **Step 5: Resolve context before persisting an export**

For `mode === 'learn'`, call:

```ts
const context = await this.learning.context(userId, { topic: opts.focusTopicId });
if (!context.target?.sessionEligible) {
  throw new UnprocessableEntityException('No startable topic.');
}
const approach = opts.approach ?? context.target.approach.recommended;
```

Reject explicit blocked/group/archived targets with `422`; Deepen remains
allowed for active/mastered leaves. Pass the already-built context and approach
to `ExportGeneratorService.generateLearnContext(...)` so generation does not
query/reinterpret roadmap eligibility. Persist the resolved ID and enum.

- [ ] **Step 6: Render learn markdown from `LearningContext`**

Replace the old learn-only focus/chapter queries with sections rendered from:

- `context.learner`;
- target + prompts + source plan;
- prerequisite tree, `mayRelyOn`, and `doNotAssume`;
- blocker/selection explanation;
- the chosen conduct script;
- unchanged `OUTPUT_CONTRACT`.

Keep repeat/full/domain generation unchanged except that full/domain glyphs use
Task 1 policy rather than direct prerequisite statuses.

- [ ] **Step 7: Validate controller approach**

Accept only `guided|source-first`; arrays use the existing “first query value”
rule. Pass the normalized string to `SessionsService`.

- [ ] **Step 8: Run migration status, focused tests, and API build**

```bash
yarn workspace @terrain/api test --runInBand sessions.service.spec.ts session-conduct.spec.ts export-generator.service.spec.ts
yarn workspace @terrain/api build
yarn workspace @terrain/api exec prisma migrate status
```

Expected: tests/build pass; migration status reports the new migration pending
locally or applied, never a drift/reset instruction.

---

### Task 7: Add topic-directed learning and approach choice to the web app

**Files:**

- Create: `apps/web/src/screens/Session/sessionChoice.ts`
- Create: `apps/web/src/screens/Session/sessionChoice.test.ts`
- Modify: `apps/web/src/api/types.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/hooks.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/TopicDetailPanel.tsx`
- Modify: `apps/web/src/screens/Session/index.tsx`
- Modify: `apps/web/src/screens/Dashboard/TodayCard.tsx`

**Interfaces:**

- Route:
  `/session/learn?topic=<id>&approach=guided|source-first`.
- Client:
  `getLearningContext(topic?: string)` and
  `getExport({ mode, focusTopicId, approach })`.

- [ ] **Step 1: Write pure client tests first**

```ts
import { chooseInitialApproach, matchingPendingSession } from './sessionChoice';

it('uses a valid override before the recommendation', () => {
  expect(chooseInitialApproach('source-first', 'guided')).toBe('source-first');
});

it('falls back to the recommendation', () => {
  expect(chooseInitialApproach(undefined, 'guided')).toBe('guided');
});

it('resumes only the same mode and focus', () => {
  const pending = [{ id: 's1', mode: 'learn', focusTopicId: 't1', topicTitle: 'A', approach: 'guided', generatedAt: 'x' }] as const;
  expect(matchingPendingSession(pending, 'learn', 't1')?.id).toBe('s1');
  expect(matchingPendingSession(pending, 'learn', 't2')).toBeUndefined();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
yarn workspace @terrain/web test --run sessionChoice.test.ts
```

Expected: FAIL because `sessionChoice.ts` does not exist.

- [ ] **Step 3: Implement the two pure helpers**

```ts
export const chooseInitialApproach = (
  override: LearningApproach | undefined,
  recommended: LearningApproach,
) => override ?? recommended;

export const matchingPendingSession = (
  sessions: PendingSession[],
  mode: 'repeat' | 'learn',
  focusTopicId: string | null,
) =>
  sessions.find(
    (session) =>
      session.mode === mode &&
      (mode === 'repeat' || session.focusTopicId === focusTopicId),
  );
```

- [ ] **Step 4: Add typed API/search contracts**

Import `LearningContext` and `LearningApproach` from `@terrain/types`. Extend
`PendingSession` with:

```ts
focusTopicId: string | null;
topicTitle: string | null;
approach: LearningApproach | null;
```

Add `api.getLearningContext(topic?)`, pass `approach` in `getExport`, and add a
`useLearningContext(topic?)` query key. Add route `validateSearch` that returns
only valid `topic` and `approach` strings.

- [ ] **Step 5: Add drawer actions**

In `TopicDetailPanel`:

- Group/archived: no learning button.
- Planned + blocked: render the first blocker as
  `Blockchain basics · 5 of 13 learned`, plus the unfinished count.
- Planned + unblocked: link **Learn this** to explicit learn route.
- Active/mastered leaf: link **Deepen this** to the same route.

Use `Link` from TanStack Router; do not add mutation or a second modal.

- [ ] **Step 6: Add the approach choice before export generation**

For learn mode, load context for the explicit topic or default target. Show:

```text
Recommended: Guided deep dive
Because: contains a code prompt
[Start guided deep dive] [Use source first]
```

Do not auto-generate until the learner clicks. Repeat mode retains its current
automatic flow. The chosen button calls:

```ts
gen.mutate({
  mode: 'learn',
  focusTopicId: context.target!.id,
  approach,
});
```

Use focus-aware pending matching; never resume another topic merely because
its mode is `learn`.

- [ ] **Step 7: Point dashboard Next Up at its exact focus**

Pass `nextUp.topic.id` in the Learn link search. A pending badge applies only
when its `focusTopicId` equals the displayed Next Up topic.

- [ ] **Step 8: Run web tests and production build**

```bash
yarn workspace @terrain/web exec vitest run src/screens/Session/sessionChoice.test.ts
yarn workspace @terrain/web build
```

Expected: tests pass; `tsc --noEmit + vite build` exits 0.

---

### Task 8: End-to-end regression and repository verification

**Files:** Modify only a file above if verification exposes a defect in the
approved behavior.

**Interfaces:** Verifies slices A–C as one deployable feature.

- [ ] **Step 1: Run all unit tests**

```bash
yarn workspace @terrain/sr-engine test
yarn workspace @terrain/types test
yarn workspace @terrain/api test --runInBand
yarn workspace @terrain/web exec vitest run
```

Expected: zero failed tests.

- [ ] **Step 2: Run builds and static checks**

```bash
yarn build
yarn lint
yarn format:check
git diff --check
```

Expected: all exit 0.

- [ ] **Step 3: Apply the non-destructive migration locally**

```bash
docker compose up -d
yarn workspace @terrain/api exec prisma migrate deploy
```

Expected: the learning-approach migration applies; no reset or data deletion.

- [ ] **Step 4: Run authenticated HTTP smoke**

With the local API/web running and a saved login cookie:

```bash
curl -fsS -b /tmp/terrain-cookie.txt \
  'http://localhost:3000/learning/context?topic=Accounts%2C%20transactions%20%26%20gas'
```

Expected JSON contains:

```json
{
  "schemaVersion": 1,
  "target": {
    "title": "Accounts, transactions & gas"
  },
  "blockers": [
    {
      "title": "Blockchain basics",
      "learnedLeaves": 5,
      "totalLeaves": 13
    }
  ]
}
```

The response headers contain `Cache-Control: private, no-store`.

- [ ] **Step 5: Run the UI smoke**

Use the repository’s Brave/CDP smoke method:

1. Open Roadmap → Web3 → Blockchain Basics.
2. Confirm Accounts shows blocked progress rather than Next Up.
3. Open a learnable Basics leaf and confirm **Learn this**.
4. Confirm the wizard shows its recommendation/reason.
5. Override the approach, generate context, and confirm the exact topic and
   chosen conduct script appear.

- [ ] **Step 6: Final diff audit**

```bash
git status --short
git diff --stat
git diff --check
```

Expected: only files named by this plan and the approved spec/plan documents;
no committed changes.
