import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ImportService } from './import.service';

const fence = (obj: any) => 'prose\n```learning-os\n' + JSON.stringify(obj) + '\n```\nmore';

const TOPIC = (over: any = {}) => ({
  id: 't1',
  userId: 'userA',
  title: 'Stacks',
  domain: 'DSA',
  topicType: 'pattern',
  status: 'active',
  description: null,
  summary: null,
  noteRef: null,
  parentId: null,
  easeFactor: 2.5,
  interval: 6,
  repetitions: 2,
  nextReviewAt: new Date('2026-01-01'),
  learnedAt: new Date('2025-12-01'),
  aiProposed: false,
  aiContext: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function build(prismaOver: any = {}) {
  const prisma: any = {
    sessionExport: { findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }) },
    topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
    ...prismaOver,
  };
  return { prisma };
}

async function svc(prisma: any): Promise<ImportService> {
  const mod = await Test.createTestingModule({
    providers: [ImportService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return mod.get(ImportService);
}

describe('ImportService.preview', () => {
  it('resolves a review by title and computes an SM-2 preview; plan is applicable', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'Stacks', topicId: null, quality: 4 }],
      proposedTopics: [],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.reviews[0].resolvedTopicId).toBe('t1');
    expect(plan.reviews[0].srPreview!.intervalBefore).toBe(6);
    expect(plan.reviews[0].srPreview!.intervalAfter).toBeGreaterThan(6);
    expect(plan.unresolved).toHaveLength(0);
    expect(plan.applicable).toBe(true);
  });

  it('flags an unknown review title as missing -> not applicable', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'Nope', quality: 3 }],
      proposedTopics: [],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.unresolved).toEqual([
      expect.objectContaining({ kind: 'review', title: 'Nope', reason: 'missing' }),
    ]);
    expect(plan.applicable).toBe(false);
  });

  it('flags an ambiguous title (two existing matches) as ambiguous', async () => {
    const { prisma } = build({
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC({ id: 'a' }), TOPIC({ id: 'b' })]) },
    });
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'stacks', quality: 3 }],
      proposedTopics: [],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.unresolved[0]).toEqual(
      expect.objectContaining({ kind: 'review', reason: 'ambiguous' }),
    );
  });

  it('resolves a proposed topic and a note summary targeting it (batch), and compounds two reviews on one topic', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [
        { topicTitle: 'Stacks', quality: 5 },
        { topicTitle: 'Stacks', quality: 5 },
      ],
      proposedTopics: [
        {
          title: 'Monotonic stack',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: ['Stacks'],
          parentTitle: 'Stacks',
        },
      ],
      noteSummaries: [{ topicTitle: 'Monotonic stack', keyInsight: 'k' }],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.newTopics[0].alreadyExists).toBe(false);
    expect(plan.noteSummaries[0].composedSummary).toContain('Key insight');
    expect(plan.unresolved).toHaveLength(0);
    expect(plan.reviews[1].srPreview!.intervalBefore).toBe(
      plan.reviews[0].srPreview!.intervalAfter,
    );
  });

  it('flags a self-referential parent as self-reference', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [
        {
          title: 'Loop',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: [],
          parentTitle: 'Loop',
        },
      ],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.unresolved[0]).toEqual(
      expect.objectContaining({ kind: 'parent', reason: 'self-reference' }),
    );
  });

  it('marks alreadyImported when the SessionExport has importedAt', async () => {
    const { prisma } = build({
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: new Date() }),
      },
    });
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.alreadyImported).toBe(true);
    expect(plan.applicable).toBe(false);
  });

  it('uses default SR state for a review targeting a batch-created topic', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'Monotonic stack', quality: 5 }],
      proposedTopics: [
        {
          title: 'Monotonic stack',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: [],
          parentTitle: null,
        },
      ],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.reviews[0].resolvedTopicId).toBeNull();
    expect(plan.reviews[0].srPreview!.intervalBefore).toBe(0);
    expect(plan.reviews[0].srPreview!.intervalAfter).toBeGreaterThan(0);
    expect(plan.unresolved).toHaveLength(0);
    expect(plan.applicable).toBe(true);
  });

  it('resolves a review by exact topicId, bypassing title matching', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'Wrong title', topicId: 't1', quality: 4 }],
      proposedTopics: [],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.reviews[0].resolvedTopicId).toBe('t1');
    expect(plan.reviews[0].srPreview!.intervalBefore).toBe(6);
    expect(plan.unresolved).toHaveLength(0);
  });

  it('resolves a proposedPrompt against an existing topic', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [
        { topicTitle: 'Stacks', promptText: 'What invariant does a monotonic stack maintain?' },
      ],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.newPrompts).toEqual([
      expect.objectContaining({ topicTitle: 'Stacks', promptText: expect.any(String) }),
    ]);
    expect(plan.unresolved).toHaveLength(0);
  });

  it('flags a proposedPrompt with an unknown topicTitle as missing', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [{ topicTitle: 'Ghost topic', promptText: 'irrelevant' }],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.unresolved[0]).toEqual(
      expect.objectContaining({ kind: 'prompt', title: 'Ghost topic', reason: 'missing' }),
    );
    expect(plan.applicable).toBe(false);
  });

  it('dedupes duplicate-titled proposed topics in one block', async () => {
    const { prisma } = build();
    const service = await svc(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [
        {
          title: 'Monads',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: [],
          parentTitle: null,
        },
        {
          title: 'monads',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: [],
          parentTitle: null,
        },
      ],
      noteSummaries: [],
    });
    const plan = await service.preview('userA', raw);
    expect(plan.newTopics).toHaveLength(1);
  });
});

import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

describe('ImportService.apply (transaction)', () => {
  function txMock(): any {
    return {
      sessionExport: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      topicType: { upsert: jest.fn().mockResolvedValue({}) },
      topic: {
        create: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(TOPIC()),
      },
      prerequisite: { create: jest.fn().mockResolvedValue({}) },
      review: { create: jest.fn().mockResolvedValue({}) },
    };
  }
  async function svcWithTx(prisma: any): Promise<ImportService> {
    const mod = await Test.createTestingModule({
      providers: [ImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return mod.get(ImportService);
  }

  it('claims atomically, dedupes prereqs, normalizes blank focus to null', async () => {
    const tx = txMock();
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = await svcWithTx(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'Stacks', quality: 4 }],
      proposedTopics: [
        {
          title: 'New',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: ['Stacks', 'stacks'],
          parentTitle: null,
        },
      ],
      noteSummaries: [{ topicTitle: 'New', keyInsight: 'k' }],
      nextSession: { focusTitle: '  ', coldChallenge: 'C' },
    });
    const res = await service.apply('userA', raw);
    expect(tx.sessionExport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-1', userId: 'userA', importedAt: null } }),
    );
    expect(res.reviewsApplied).toBe(1);
    expect(res.topicsCreated).toEqual(['new-1']);
    expect(tx.prerequisite.create).toHaveBeenCalledTimes(1); // ["Stacks","stacks"] -> one edge
    expect(res.nextSessionStored).toBe(false); // blank focus
    expect(tx.sessionExport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nextFocusTitle: null }) }),
    );
  });

  it('apply stamps created topics + reviews with the caller userId', async () => {
    const tx = txMock();
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = await svcWithTx(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [{ topicTitle: 'Stacks', quality: 4 }],
      proposedTopics: [
        {
          title: 'New',
          type: 'pattern',
          domain: 'DSA',
          prerequisiteTitles: [],
          parentTitle: null,
        },
      ],
      noteSummaries: [],
    });
    await service.apply('userA', raw);
    expect(tx.topicType.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_key: { userId: 'userA', key: 'pattern' } },
        create: expect.objectContaining({ userId: 'userA', key: 'pattern' }),
      }),
    );
    expect(tx.topic.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'userA' }),
    });
    expect(tx.review.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'userA' }),
    });
  });

  it('creates Prompt rows with default SR state for resolved proposedPrompts', async () => {
    const tx = txMock();
    tx.prompt = { create: jest.fn().mockResolvedValue({ id: 'prompt-1' }) };
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = await svcWithTx(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [{ topicTitle: 'Stacks', promptText: 'Q?', answerHint: 'A' }],
      noteSummaries: [],
    });
    await service.apply('userA', raw);
    expect(tx.prompt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topicId: 't1',
        promptText: 'Q?',
        answerHint: 'A',
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReviewAt: null,
      }),
    });
  });

  it('persists promptKind on created Prompt rows, defaulting to concept', async () => {
    const tx = txMock();
    tx.prompt = { create: jest.fn().mockResolvedValue({ id: 'prompt-1' }) };
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([TOPIC()]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = await svcWithTx(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [],
      proposedPrompts: [
        { topicTitle: 'Stacks', promptText: 'Write it.', promptKind: 'code' },
        { topicTitle: 'Stacks', promptText: 'Define it.', promptKind: 'concept' },
      ],
      noteSummaries: [],
    });
    await service.apply('userA', raw);
    expect(tx.prompt.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ promptText: 'Write it.', promptKind: 'code' }),
    });
    expect(tx.prompt.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ promptText: 'Define it.', promptKind: 'concept' }),
    });
  });

  it('throws 409 when the atomic claim is lost (concurrent import)', async () => {
    const tx = txMock();
    tx.sessionExport.updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const service = await svcWithTx(prisma);
    const raw = fence({
      version: 1,
      sessionId: 'sess-1',
      reviews: [],
      proposedTopics: [],
      noteSummaries: [],
    });
    await expect(service.apply('userA', raw)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ImportService.apply guards (no writes on reject)', () => {
  it('throws 409 and does not open a transaction when already imported', async () => {
    const tx = jest.fn();
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: new Date() }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: tx,
    };
    const mod = await Test.createTestingModule({
      providers: [ImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = mod.get(ImportService);
    const raw =
      '```learning-os\n' +
      JSON.stringify({
        version: 1,
        sessionId: 'sess-1',
        reviews: [],
        proposedTopics: [],
        noteSummaries: [],
      }) +
      '\n```';
    await expect(service.apply('userA', raw)).rejects.toBeInstanceOf(ConflictException);
    expect(tx).not.toHaveBeenCalled();
  });

  it('throws 422 and does not open a transaction when a reference is unresolved', async () => {
    const tx = jest.fn();
    const prisma: any = {
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sess-1', importedAt: null }),
      },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: tx,
    };
    const mod = await Test.createTestingModule({
      providers: [ImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = mod.get(ImportService);
    const raw =
      '```learning-os\n' +
      JSON.stringify({
        version: 1,
        sessionId: 'sess-1',
        reviews: [{ topicTitle: 'Ghost', quality: 3 }],
        proposedTopics: [],
        noteSummaries: [],
      }) +
      '\n```';
    await expect(service.apply('userA', raw)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx).not.toHaveBeenCalled();
  });
});

describe('ImportService cross-user isolation', () => {
  it("404s previewing a SessionExport owned by another user (userA can't see userB's export)", async () => {
    const findFirst = jest.fn().mockResolvedValue(null); // scoped query finds nothing for userA
    const prisma: any = {
      sessionExport: { findFirst },
      topic: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const mod = await Test.createTestingModule({
      providers: [ImportService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = mod.get(ImportService);
    const raw = fence({
      version: 1,
      sessionId: 'sess-owned-by-userB',
      reviews: [],
      proposedTopics: [],
      noteSummaries: [],
    });
    await expect(service.preview('userA', raw)).rejects.toThrow(/not found/i);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'sess-owned-by-userB', userId: 'userA' },
    });
  });
});
