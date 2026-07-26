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

describe('LearningContextService', () => {
  let prisma: any;
  let service: LearningContextService;

  beforeEach(() => {
    prisma = {
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      sessionExport: { findFirst: jest.fn().mockResolvedValue(null) },
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
    };
    service = new LearningContextService(prisma as PrismaService);
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
    expect(prisma.review.findMany).toHaveBeenCalledTimes(3);
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
