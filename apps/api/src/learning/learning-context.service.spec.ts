import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LearningContextService } from './learning-context.service';

const ids = {
  basics: '00000000-0000-4000-8000-000000000001',
  accounts: '00000000-0000-4000-8000-000000000002',
  target: '00000000-0000-4000-8000-000000000003',
  practicing: '00000000-0000-4000-8000-000000000004',
  introduced: '00000000-0000-4000-8000-000000000005',
  cycleA: '00000000-0000-4000-8000-000000000006',
  cycleB: '00000000-0000-4000-8000-000000000007',
  prompt: '00000000-0000-4000-8000-000000000008',
};

const leafIds = Array.from(
  { length: 13 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`,
);

const topic = (overrides: Record<string, unknown> = {}) => ({
  id: ids.target,
  title: 'Target',
  domain: 'Web3',
  topicType: 'concept',
  status: 'planned',
  description: null,
  summary: null,
  sourcePlan: null,
  parentId: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  prerequisites: [],
  prompts: [],
  ...overrides,
});

const studySession = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000009',
  focusTopicId: ids.target,
  nextFocusTitle: 'Target',
  nextColdChallenge: 'Encode a nested list and explain its length prefix.',
  importedAt: new Date('2026-09-01T12:00:00Z'),
  ...overrides,
});

describe('LearningContextService', () => {
  let prisma: any;
  let service: LearningContextService;

  beforeEach(() => {
    prisma = {
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          headline: 'Staff engineer',
          learningStyle: 'Socratic',
          codeStyle: 'Small functions',
          noteSystem: 'Obsidian',
        }),
      },
      review: { findMany: jest.fn().mockResolvedValue([]) },
      sourceEvidence: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { findMany: jest.fn().mockResolvedValue([]) },
      skillCheck: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new LearningContextService(prisma as PrismaService);
  });

  it('includes recent assessed skill gaps in owned topic context without replacing continuation', async () => {
    prisma.topic.findMany.mockResolvedValue([topic({ status: 'active' })]);
    prisma.sessionExport.findMany.mockResolvedValue([studySession()]);
    prisma.skillCheck.findMany.mockResolvedValue([
      {
        plan: {
          id: ids.target,
          target: { kind: 'topic', topicId: ids.target },
          kind: 'diagnosis',
          learnedOn: '2026-09-01',
          dueOn: '2026-09-02',
          task: 'Diagnose an incorrect nested RLP list-length prefix.',
          successCriteria: 'Explain the length mismatch and verify the corrected encoding.',
          allowedTools: 'documentation',
        },
        attempt: {
          firstAttempt: 'I miscounted the nested payload length and did not locate the boundary.',
          evidence: 'The fixture still fails at the nested list boundary.',
          assistance: 'hints',
          helpDetails: 'The tutor pointed to the length calculation.',
        },
        result: {
          outcome: 'needs_practice',
          feedback: 'The payload length still includes the wrong prefix bytes.',
          nextAction: 'Trace the inner and outer lengths separately.',
          reviewer: 'ai',
        },
        attemptedAt: new Date('2026-09-02T12:00:00Z'),
      },
    ]);
    const context = await service.context('user-a', { topic: ids.target });
    expect(prisma.skillCheck.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        topicId: ids.target,
        assessedAt: { not: null },
        cancelledAt: null,
      },
      orderBy: [{ assessedAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: { plan: true, attempt: true, result: true, attemptedAt: true },
    });
    expect(context.target?.skillChecks).toEqual([
      expect.objectContaining({
        outcome: 'needs_practice',
        assistance: 'hints',
        nextAction: 'Trace the inner and outer lengths separately.',
      }),
    ]);
    expect(context.target?.continuation?.coldChallenge).toBe(
      'Encode a nested list and explain its length prefix.',
    );
  });

  it('resumes an explicitly selected active topic with its recorded work and challenge', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({
        status: 'active',
        summary: 'Encoded short strings; lists remain unfinished.',
        aiContext: 'Build an RLP encoder and verify boundary lengths.',
        noteRef: 'Obsidian: Web3/RLP',
      }),
    ]);
    prisma.sessionExport.findMany.mockResolvedValue([studySession()]);

    const context = await service.context('user-a', { topic: ids.target });

    expect(context.target).toMatchObject({
      id: ids.target,
      sessionEligible: true,
      summary: 'Encoded short strings; lists remain unfinished.',
      studyContext: 'Build an RLP encoder and verify boundary lengths.',
      noteRef: 'Obsidian: Web3/RLP',
      continuation: {
        sessionId: '00000000-0000-4000-8000-000000000009',
        importedAt: '2026-09-01T12:00:00.000Z',
        coldChallenge: 'Encode a nested list and explain its length prefix.',
        resuming: true,
      },
    });
    expect(prisma.sessionExport.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        mode: 'learn',
        importedAt: { not: null },
        OR: [
          { focusTopicId: ids.target },
          { nextFocusTitle: { contains: 'Target', mode: 'insensitive' } },
        ],
      },
      orderBy: [{ importedAt: 'desc' }, { generatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        focusTopicId: true,
        nextFocusTitle: true,
        nextColdChallenge: true,
        importedAt: true,
      },
    });
  });

  it('recovers an older matching study after switching topics without accepting a substring match', async () => {
    prisma.topic.findMany.mockResolvedValue([topic()]);
    prisma.sessionExport.findMany.mockResolvedValue([
      studySession({
        focusTopicId: ids.accounts,
        nextFocusTitle: 'Target extension',
        nextColdChallenge: 'Unrelated exercise',
      }),
      studySession({
        nextFocusTitle: '  tArGeT  ',
        nextColdChallenge: '  Resume the list encoder.  ',
      }),
    ]);

    const context = await service.context('user-a', { topic: ids.target });

    expect(context.target).toMatchObject({
      status: 'planned',
      continuation: { coldChallenge: 'Resume the list encoder.' },
    });
  });

  it("carries target reconstructions, application references, and each card's latest grade", async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({
        sourcePlan: {
          policy: 'required',
          requirements: [
            {
              id: 'encoding',
              purpose: 'Trace bytes',
              requiredWhen: 'always',
              options: [
                {
                  id: 'spec',
                  title: 'Spec',
                  url: 'https://example.com/spec',
                  format: 'article',
                  scope: 'Encoding',
                  estimatedMinutes: 10,
                  why: 'Definition',
                },
              ],
            },
          ],
        },
        prompts: [
          {
            id: ids.prompt,
            promptKind: 'concept',
            promptText: 'Encode a list',
            state: 'review',
            difficulty: 4,
            stability: 5,
            suspended: false,
          },
        ],
      }),
    ]);
    // This card's latest attempt precedes the three recent topic-level reviews.
    prisma.review.findMany.mockImplementation(({ distinct }: any) =>
      Promise.resolve(
        distinct
          ? [
              {
                topicId: ids.target,
                promptId: ids.prompt,
                grade: 'hard',
                reviewedAt: new Date('2026-08-01'),
                note: 'First attempt confused payload length with item count; corrected after a hint.',
              },
            ]
          : [],
      ),
    );
    prisma.sourceEvidence.findMany.mockResolvedValue([
      {
        topicId: ids.target,
        requirementId: 'encoding',
        sourceId: 'spec',
        sourceTitle: 'Spec',
        sourceUrl: 'https://example.com/spec',
        mainClaim: 'Lists have length prefixes.',
        supportingMechanism: 'The prefix delimits the payload.',
        openQuestion: null,
        substitutionReason: null,
        verifiedLiveAt: null,
        verificationNote: null,
        createdAt: new Date('2026-09-01'),
      },
    ]);
    prisma.applicationEvent.findMany.mockResolvedValue([
      {
        topicId: ids.target,
        description: 'Traced a nested list; no implementation yet.',
        url: 'notes/rlp-trace.md',
        appliedAt: new Date('2026-09-01'),
      },
    ]);

    const context = await service.context('user-a', { topic: ids.target });
    expect(context.target).toMatchObject({
      prompts: [
        {
          id: ids.prompt,
          lastGrade: 'hard',
          lastReviewedAt: '2026-08-01T00:00:00.000Z',
          lastReviewNote:
            'First attempt confused payload length with item count; corrected after a hint.',
        },
      ],
      approach: { recommended: 'guided' },
      sourceProgress: [
        {
          requirementId: 'encoding',
          mainClaim: 'Lists have length prefixes.',
          reusable: true,
          recordedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      applications: [
        {
          description: 'Traced a nested list; no implementation yet.',
          url: 'notes/rlp-trace.md',
        },
      ],
    });
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', topicId: ids.target, promptId: { in: [ids.prompt] } },
        distinct: ['promptId'],
        select: expect.objectContaining({ note: true, reviewedAt: true }),
      }),
    );
  });

  it.each([
    { nextFocusTitle: 'Another topic' },
    { nextFocusTitle: null },
    { nextColdChallenge: null },
    { nextColdChallenge: '  ' },
  ])(
    'does not resurrect a continuation superseded by a newer same-topic session: %p',
    async (latest) => {
      prisma.topic.findMany.mockResolvedValue([topic({ status: 'active' })]);
      prisma.sessionExport.findMany.mockResolvedValue([studySession(latest), studySession()]);

      expect((await service.context('user-a', { topic: ids.target })).target).toMatchObject({
        continuation: null,
      });
    },
  );

  it('returns no continuation when the selected topic has no recorded study', async () => {
    prisma.topic.findMany.mockResolvedValue([topic()]);

    expect((await service.context('user-a', { topic: ids.target })).target).toMatchObject({
      summary: null,
      studyContext: null,
      noteRef: null,
      continuation: null,
    });
  });

  it('carries an incoming challenge without claiming the new target was studied', async () => {
    prisma.topic.findMany.mockResolvedValue([topic()]);
    prisma.sessionExport.findMany.mockResolvedValue([studySession({ focusTopicId: ids.accounts })]);

    expect((await service.context('user-a', { topic: ids.target })).target).toMatchObject({
      status: 'planned',
      continuation: {
        coldChallenge: 'Encode a nested list and explain its length prefix.',
        resuming: false,
      },
    });
  });

  it('does not attach an ambiguous title-based continuation to an explicitly selected topic', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic(),
      topic({ id: ids.accounts, title: ' target ' }),
    ]);
    prisma.sessionExport.findMany.mockResolvedValue([
      studySession({ focusTopicId: ids.accounts, nextFocusTitle: ' target ' }),
    ]);

    expect((await service.context('user-a', { topic: ids.target })).target).toMatchObject({
      id: ids.target,
      continuation: null,
    });
  });

  it('resumes an active leaf from the latest study recommendation instead of starting another topic', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({ status: 'active' }),
      topic({ id: ids.accounts, title: 'Another topic' }),
    ]);
    prisma.sessionExport.findFirst.mockResolvedValue(studySession());

    expect((await service.nextUp('user-a'))?.topic.id).toBe(ids.target);
    expect(prisma.sessionExport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a', mode: 'learn', importedAt: { not: null } },
      }),
    );
  });

  it('keeps an active leaf with unavailable parent data out of study selection', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({ status: 'active', parentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
      topic({ id: ids.accounts, title: 'Another topic' }),
    ]);
    prisma.sessionExport.findFirst.mockResolvedValue(studySession());

    expect((await service.nextUp('user-a'))?.topic.id).toBe(ids.accounts);
    expect((await service.context('user-a', { topic: ids.target })).target?.sessionEligible).toBe(
      false,
    );
  });

  it.each([false, true])(
    'allows resuming across unfinished prerequisites only when their roadmap data is valid (malformed: %s)',
    async (malformed) => {
      prisma.topic.findMany.mockResolvedValue([
        topic({ status: 'active', prerequisites: [{ prerequisiteId: ids.basics }] }),
        topic({ id: ids.accounts, title: 'Another topic' }),
        topic({
          id: ids.basics,
          title: 'Prerequisite',
          parentId: malformed ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : null,
        }),
      ]);
      prisma.sessionExport.findFirst.mockResolvedValue(studySession());

      expect((await service.nextUp('user-a'))?.topic.id).toBe(
        malformed ? ids.accounts : ids.target,
      );
      expect((await service.context('user-a', { topic: ids.target })).target?.sessionEligible).toBe(
        !malformed,
      );
    },
  );

  it('keeps planned topics with malformed transitive prerequisites out of recommendations', async () => {
    const graph = [
      topic({ prerequisites: [{ prerequisiteId: ids.basics }] }),
      topic({ id: ids.accounts, title: 'Another topic' }),
      topic({
        id: ids.basics,
        title: 'Prerequisite',
        status: 'active',
        prerequisites: [{ prerequisiteId: ids.practicing }],
      }),
      topic({
        id: ids.practicing,
        title: 'Malformed dependency',
        status: 'active',
        parentId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ];
    prisma.topic.findMany.mockResolvedValue(graph);

    expect((await service.nextUp('user-a'))?.topic.id).toBe(ids.accounts);
    const context = await service.context('user-a');
    expect(context.selection.learnableAlternatives).toEqual([]);
    const explicit = await service.context('user-a', { topic: ids.target });
    expect(explicit.target?.sessionEligible).toBe(false);
    expect(explicit.blockers).toContainEqual(
      expect.objectContaining({
        topicId: ids.practicing,
        reason: 'Prerequisite parent data is unavailable.',
      }),
    );

    prisma.topic.findMany.mockResolvedValue(graph.filter(({ id }) => id !== ids.accounts));
    const unavailable = await service.context('user-a');
    expect(unavailable.target).toBeNull();
    expect(unavailable.blockers).toContainEqual(
      expect.objectContaining({ topicId: ids.practicing }),
    );
  });

  it('rejects a blocked imported focus and selects the first learnable authored leaf', async () => {
    prisma.sessionExport.findFirst.mockResolvedValue({
      nextFocusTitle: ' Transaction anatomy ',
    });
    prisma.topic.findMany.mockResolvedValue([
      topic({
        id: ids.basics,
        title: 'Blockchain basics',
        status: 'active',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      ...leafIds.map((id, index) =>
        topic({
          id,
          title: index === 5 ? 'Public-key cryptography & wallets' : `Basic ${index + 1}`,
          parentId: ids.basics,
          status: index < 5 ? 'active' : 'planned',
          createdAt: new Date(`2026-01-${String(index + 2).padStart(2, '0')}T00:00:00Z`),
        }),
      ),
      topic({
        id: ids.accounts,
        title: 'Accounts, transactions & gas',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        prerequisites: [{ prerequisiteId: ids.basics }],
      }),
      topic({
        id: ids.target,
        title: 'Transaction anatomy',
        parentId: ids.accounts,
        createdAt: new Date('2026-02-02T00:00:00Z'),
      }),
    ]);

    const context = await service.context('user-a', {
      now: new Date('2026-07-24T12:00:00Z'),
    });

    expect(context.selection).toMatchObject({
      source: 'authored-order',
      importedFocus: {
        title: 'Transaction anatomy',
        accepted: false,
        reason: expect.stringContaining('Blockchain basics'),
      },
    });
    expect(context.target?.title).toBe('Public-key cryptography & wallets');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a' } }),
    );
  });

  it('treats an explicit foreign or missing id as not found', async () => {
    prisma.topic.findMany.mockResolvedValue([topic()]);

    await expect(
      service.context('user-a', { topic: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports all eight unfinished leaves for a 5/13 prerequisite group', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({ id: ids.basics, title: 'Blockchain basics', status: 'active' }),
      ...leafIds.map((id, index) =>
        topic({
          id,
          title: `Basic ${index + 1}`,
          parentId: ids.basics,
          status: index < 5 ? 'active' : 'planned',
        }),
      ),
      topic({
        id: ids.accounts,
        title: 'Accounts, transactions & gas',
        prerequisites: [{ prerequisiteId: ids.basics }],
      }),
      topic({
        id: ids.target,
        title: 'Transaction anatomy',
        parentId: ids.accounts,
      }),
    ]);

    const context = await service.context('user-a', { topic: ids.target });

    expect(context.target).toMatchObject({
      id: ids.target,
      kind: 'leaf',
      sessionEligible: false,
    });
    expect(context.blockers).toEqual([
      expect.objectContaining({
        topicId: ids.basics,
        title: 'Blockchain basics',
        learnedLeaves: 5,
        totalLeaves: 13,
        unfinishedLeaves: expect.arrayContaining([
          expect.objectContaining({ id: leafIds[5], status: 'planned' }),
          expect.objectContaining({ id: leafIds[12], status: 'planned' }),
        ]),
      }),
    ]);
    expect(context.blockers[0].unfinishedLeaves).toHaveLength(8);
  });

  it('includes an inherited satisfied group prerequisite in evidence and approach inputs', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({ id: ids.basics, title: 'Blockchain basics', status: 'active' }),
      ...leafIds.map((id, index) =>
        topic({
          id,
          title: `Basic ${index + 1}`,
          parentId: ids.basics,
          status: index % 2 ? 'active' : 'mastered',
        }),
      ),
      topic({
        id: ids.accounts,
        title: 'Accounts, transactions & gas',
        prerequisites: [{ prerequisiteId: ids.basics }],
      }),
      topic({
        id: ids.target,
        title: 'Transaction anatomy',
        parentId: ids.accounts,
      }),
    ]);
    prisma.review.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.topicId === ids.basics
          ? [
              {
                topicId: ids.basics,
                grade: 'hard',
                reviewedAt: new Date('2026-07-23T12:00:00Z'),
                promptId: null,
              },
            ]
          : [],
      ),
    );
    prisma.sourceEvidence.findMany.mockResolvedValue([
      { topicId: ids.basics, sourceTitle: 'Ethereum accounts guide' },
    ]);

    const context = await service.context('user-a', { topic: ids.target });

    expect(context.target).toMatchObject({
      id: ids.target,
      sessionEligible: true,
      approach: {
        recommended: 'guided',
        reasons: ['A recent again or hard grade calls for guided support.'],
      },
    });
    expect(context.prerequisites).toEqual([
      expect.objectContaining({
        id: ids.basics,
        satisfied: true,
        learnedLeaves: 13,
        totalLeaves: 13,
        evidence: expect.objectContaining({
          recentGrades: ['hard'],
          sourceTitles: ['Ethereum accounts guide'],
        }),
      }),
    ]);
    expect(context.mayRelyOn).toEqual([
      expect.objectContaining({
        id: ids.basics,
        level: 'practicing',
        evidence: expect.objectContaining({ recentGrades: ['hard'] }),
      }),
    ]);
    expect(context.doNotAssume).toEqual([]);
    expect(context.blockers).toEqual([]);
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a', topicId: ids.basics } }),
    );
  });

  it('classifies evidenced and merely introduced active prerequisites separately', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({
        id: ids.practicing,
        title: 'Practicing prerequisite',
        status: 'active',
        summary: 'A compact summary',
      }),
      topic({
        id: ids.introduced,
        title: 'Introduced prerequisite',
        status: 'active',
      }),
      topic({
        prerequisites: [{ prerequisiteId: ids.practicing }, { prerequisiteId: ids.introduced }],
        prompts: [
          {
            id: ids.prompt,
            promptKind: 'code',
            promptText: 'Implement it',
            state: 'new',
            difficulty: null,
            stability: null,
            suspended: false,
          },
        ],
      }),
    ]);
    prisma.review.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.topicId === ids.practicing
          ? [
              {
                topicId: ids.practicing,
                grade: 'good',
                reviewedAt: new Date('2026-07-20T10:00:00Z'),
                promptId: null,
              },
            ]
          : [],
      ),
    );

    const context = await service.context('user-a', { topic: ids.target });

    expect(context.mayRelyOn).toEqual([
      expect.objectContaining({
        id: ids.practicing,
        level: 'practicing',
        evidence: expect.objectContaining({ recentGrades: ['good'] }),
      }),
    ]);
    expect(context.doNotAssume).toEqual([
      expect.objectContaining({ id: ids.introduced, level: 'introduced' }),
    ]);
    expect(prisma.review.findMany).toHaveBeenCalledTimes(4);
    expect(prisma.sourceEvidence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          topicId: { in: [ids.target, ids.practicing, ids.introduced] },
        },
      }),
    );
    expect(prisma.applicationEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-a',
          topicId: { in: [ids.target, ids.practicing, ids.introduced] },
        },
      }),
    );
  });

  it('terminates a malformed hierarchy cycle and reports it as a blocker', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({ id: ids.cycleA, title: 'Cycle A', parentId: ids.cycleB }),
      topic({ id: ids.cycleB, title: 'Cycle B', parentId: ids.cycleA }),
    ]);

    const context = await service.context('user-a', { topic: ids.cycleA });

    expect(context.target).toMatchObject({
      id: ids.cycleA,
      kind: 'group',
      sessionEligible: false,
    });
    expect(context.blockers).toEqual([
      expect.objectContaining({
        topicId: ids.cycleA,
        reason: expect.stringMatching(/cycle/i),
      }),
    ]);
  });

  it('rejects an ambiguous normalized title from legacy data', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({ id: ids.practicing, title: 'Hashing' }),
      topic({ id: ids.introduced, title: ' hashing ' }),
    ]);

    await expect(service.context('user-a', { topic: 'HASHING' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('nextUp uses selection data without loading learner or evidence queries', async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({
        id: ids.target,
        title: 'Hashing',
        sourcePlan: { policy: 'none', rationale: 'Practice first' },
      }),
    ]);

    const result = await service.nextUp('user-a', undefined, new Date('2026-07-24T12:00:00Z'));

    expect(result).toMatchObject({
      topic: { id: ids.target, title: 'Hashing' },
      chapterTitle: null,
      chapterProgress: null,
      sourcePlanStats: { requiredCount: 0, estimatedMinutes: 0, hasExpired: false },
    });
    expect((result!.topic as any).prerequisites).toBeUndefined();
    expect((result!.topic as any).prompts).toBeUndefined();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.review.findMany).not.toHaveBeenCalled();
    expect(prisma.sourceEvidence.findMany).not.toHaveBeenCalled();
    expect(prisma.applicationEvent.findMany).not.toHaveBeenCalled();
  });

  it('keeps disabled-domain topics out of default targets and alternatives', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['Web3'] });
    prisma.topic.findMany.mockResolvedValue([
      topic({ id: ids.accounts, title: 'Disabled first', domain: 'Web3' }),
      topic({ id: ids.target, title: 'Enabled second', domain: 'DSA' }),
    ]);

    const context = await service.context('user-a');

    expect(context.target?.title).toBe('Enabled second');
    expect(context.selection.learnableAlternatives).toEqual([]);
  });

  it('skips malformed foreign edges by default and diagnoses them without projecting markers', async () => {
    const foreignParent = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const foreignPrerequisite = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
    prisma.topic.findMany.mockResolvedValue([
      topic({
        id: ids.accounts,
        title: 'Malformed parent',
        parentId: foreignParent,
      }),
      topic({
        id: ids.practicing,
        title: 'Malformed prerequisite',
        prerequisites: [{ prerequisiteId: foreignPrerequisite }],
      }),
      topic({
        id: ids.target,
        title: 'Valid target',
      }),
    ]);

    expect((await service.nextUp('user-a'))?.topic.id).toBe(ids.target);
    const defaultContext = await service.context('user-a');
    expect(defaultContext.target?.id).toBe(ids.target);
    expect(JSON.stringify(defaultContext)).not.toContain('ffffffff-ffff');

    const parentContext = await service.context('user-a', { topic: ids.accounts });
    expect(parentContext.target).toMatchObject({
      id: ids.accounts,
      sessionEligible: false,
    });
    expect(parentContext.blockers).toEqual([
      expect.objectContaining({
        topicId: ids.accounts,
        title: 'Unavailable parent',
      }),
    ]);
    expect(JSON.stringify(parentContext)).not.toContain(foreignParent);

    const prerequisiteContext = await service.context('user-a', {
      topic: ids.practicing,
    });
    expect(prerequisiteContext.target).toMatchObject({
      id: ids.practicing,
      sessionEligible: false,
    });
    expect(prerequisiteContext.prerequisites).toEqual([]);
    expect(prerequisiteContext.blockers).toEqual([
      expect.objectContaining({
        topicId: ids.practicing,
        title: 'Unavailable prerequisite',
      }),
    ]);
    expect(JSON.stringify(prerequisiteContext)).not.toContain(foreignPrerequisite);
  });

  it("keeps each direct prerequisite's capped review evidence in the approach decision", async () => {
    prisma.topic.findMany.mockResolvedValue([
      topic({
        id: ids.practicing,
        title: 'Direct prerequisite',
        status: 'active',
      }),
      topic({
        id: ids.target,
        title: 'Target with reviews',
        prerequisites: [{ prerequisiteId: ids.practicing }],
      }),
    ]);
    prisma.review.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.topicId === ids.target
          ? [
              {
                topicId: ids.target,
                grade: 'good',
                reviewedAt: new Date('2026-07-24T12:00:00Z'),
                promptId: null,
              },
              {
                topicId: ids.target,
                grade: 'good',
                reviewedAt: new Date('2026-07-23T12:00:00Z'),
                promptId: null,
              },
              {
                topicId: ids.target,
                grade: 'good',
                reviewedAt: new Date('2026-07-22T12:00:00Z'),
                promptId: null,
              },
            ]
          : [
              {
                topicId: ids.practicing,
                grade: 'hard',
                reviewedAt: new Date('2026-07-01T12:00:00Z'),
                promptId: null,
              },
            ],
      ),
    );

    const context = await service.context('user-a', { topic: ids.target });

    expect(context.target?.approach).toEqual({
      recommended: 'guided',
      reasons: ['A recent again or hard grade calls for guided support.'],
    });
  });

  it('diagnoses an owned blocker with a nested unavailable prerequisite without false progress', async () => {
    const foreignPrerequisite = 'ffffffff-ffff-4fff-8fff-fffffffffff3';
    prisma.topic.findMany.mockResolvedValue([
      topic({
        id: ids.practicing,
        title: 'Owned active prerequisite',
        status: 'active',
        prerequisites: [{ prerequisiteId: foreignPrerequisite }],
      }),
      topic({
        id: ids.target,
        title: 'Blocked target',
        prerequisites: [{ prerequisiteId: ids.practicing }],
      }),
    ]);

    const context = await service.context('user-a', { topic: ids.target });
    const serialized = JSON.stringify(context);

    expect(context.blockers).toEqual([
      expect.objectContaining({
        topicId: ids.practicing,
        title: 'Owned active prerequisite',
        reason: expect.stringMatching(/unavailable/i),
      }),
    ]);
    expect(context.prerequisites[0].reason).toMatch(/unavailable/i);
    expect(serialized).not.toContain('0 prerequisite leaves remain unfinished');
    expect(serialized).not.toContain(foreignPrerequisite);
  });
});
