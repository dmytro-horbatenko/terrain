import { ConflictException, NotFoundException } from '@nestjs/common';
import { PromptsService } from './prompts.service';

function promptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    topicId: 't1',
    stability: 3.2,
    difficulty: 5.1,
    reps: 2,
    lapses: 0,
    state: 'review',
    lastReviewedAt: new Date('2026-06-25T00:00:00Z'),
    nextReviewAt: new Date('2026-07-01T00:00:00Z'),
    suspended: false,
    ...overrides,
  };
}

describe('PromptsService.next', () => {
  it('prefers an overdue card over a new card', async () => {
    const dueFindFirst = jest.fn().mockResolvedValue(promptRow({ id: 'p-due' }));
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findFirst: dueFindFirst },
    };
    const service = new PromptsService(prisma);
    const result = await service.next('userA', 't1');

    expect(result!.prompt.id).toBe('p-due');
    // only the due query should run; the new-card fallback must not fire
    expect(dueFindFirst).toHaveBeenCalledTimes(1);
    expect(dueFindFirst.mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({
        topicId: 't1',
        suspended: false,
        nextReviewAt: expect.objectContaining({ lte: expect.any(Date) }),
      }),
      orderBy: { nextReviewAt: 'asc' },
    });
  });

  it('falls back to the oldest new card when nothing is due', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // due query: nothing due
      .mockResolvedValueOnce(promptRow({ id: 'p-new', state: 'new', nextReviewAt: null }));
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findFirst },
    };
    const service = new PromptsService(prisma);
    const result = await service.next('userA', 't1');

    expect(result!.prompt.id).toBe('p-new');
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[1][0]).toMatchObject({
      where: { topicId: 't1', suspended: false, state: 'new' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('excludes suspended cards via suspended: false in both queries', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findFirst },
    };
    const service = new PromptsService(prisma);
    await service.next('userA', 't1');

    expect(findFirst.mock.calls[0][0].where).toMatchObject({ suspended: false });
    expect(findFirst.mock.calls[1][0].where).toMatchObject({ suspended: false });
  });

  it('has no graduation concept anywhere in the candidate queries', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findFirst },
    };
    const service = new PromptsService(prisma);
    await service.next('userA', 't1');

    for (const call of findFirst.mock.calls) {
      expect(call[0].where).not.toHaveProperty('graduated');
    }
  });

  it('returns previewIntervals computed from the candidate row', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findFirst: jest.fn().mockResolvedValue(promptRow({ id: 'p-due' })) },
    };
    const service = new PromptsService(prisma);
    const result = await service.next('userA', 't1');

    expect(result!.prompt.id).toBe('p-due');
    expect(typeof result!.previewIntervals.again).toBe('number');
    expect(typeof result!.previewIntervals.hard).toBe('number');
    expect(typeof result!.previewIntervals.good).toBe('number');
    expect(typeof result!.previewIntervals.easy).toBe('number');
    // easy should schedule at least as far out as again for a reviewed card
    expect(result!.previewIntervals.easy).toBeGreaterThanOrEqual(result!.previewIntervals.again);
  });

  it('returns null when there is no due card and no new card', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new PromptsService(prisma);
    expect(await service.next('userA', 't1')).toBeNull();
  });

  it('scopes ownership via userId on the topic lookup, 404s otherwise', async () => {
    const topicFindFirst = jest.fn().mockResolvedValue(null);
    const prisma: any = { topic: { findFirst: topicFindFirst } };
    const service = new PromptsService(prisma);

    await expect(service.next('userA', 'not-mine')).rejects.toBeInstanceOf(NotFoundException);
    expect(topicFindFirst).toHaveBeenCalledWith({
      where: { id: 'not-mine', userId: 'userA' },
    });
  });
});

describe('PromptsService.setSuspended', () => {
  function buildTx(prompt = promptRow()) {
    const promptFindFirst = jest.fn().mockResolvedValue(prompt);
    const promptUpdate = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ ...prompt, ...data }));
    const promptAggregate = jest.fn().mockResolvedValue({ _min: { nextReviewAt: null } });
    const topicUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      prompt: { update: promptUpdate, aggregate: promptAggregate },
      topic: { update: topicUpdate },
    };
    const prisma: any = {
      prompt: { findFirst: promptFindFirst },
      $transaction: (cb: any) => cb(tx),
    };
    return { prisma, promptFindFirst, promptUpdate, promptAggregate, topicUpdate };
  }

  it('suspend: sets suspended true + suspendedAt, and recomputes topic due', async () => {
    const { prisma, promptFindFirst, promptUpdate, topicUpdate } = buildTx();
    const service = new PromptsService(prisma);

    await service.setSuspended('userA', 'p1', true);

    expect(promptFindFirst).toHaveBeenCalledWith({
      where: { id: 'p1', topic: { userId: 'userA' } },
    });
    expect(promptUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { suspended: true, suspendedAt: expect.any(Date) },
    });
    expect(topicUpdate).toHaveBeenCalled(); // recomputeTopicDue ran inside the same tx
  });

  it('unsuspend: clears suspended false + suspendedAt null', async () => {
    const { prisma, promptUpdate } = buildTx(
      promptRow({ suspended: true, suspendedAt: new Date() }),
    );
    const service = new PromptsService(prisma);

    await service.setSuspended('userA', 'p1', false);

    expect(promptUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { suspended: false, suspendedAt: null },
    });
  });

  it('404s when the prompt does not belong to the user', async () => {
    const prisma: any = { prompt: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PromptsService(prisma);
    await expect(service.setSuspended('userA', 'not-mine', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PromptsService.remove', () => {
  it('409s a reviewed card and suggests suspension instead', async () => {
    const promptFindFirst = jest.fn().mockResolvedValue({ ...promptRow(), _count: { reviews: 2 } });
    const promptDelete = jest.fn();
    const prisma: any = {
      prompt: { findFirst: promptFindFirst, delete: promptDelete },
      $transaction: (cb: any) =>
        cb({ prompt: { delete: promptDelete }, topic: { update: jest.fn() } }),
    };
    const service = new PromptsService(prisma);

    await expect(service.remove('userA', 'p1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.remove('userA', 'p1')).rejects.toThrow(/suspend/i);
    expect(promptDelete).not.toHaveBeenCalled();
  });

  it('deletes an unreviewed card and recomputes topic due', async () => {
    const promptFindFirst = jest.fn().mockResolvedValue({ ...promptRow(), _count: { reviews: 0 } });
    const promptDelete = jest.fn().mockResolvedValue({});
    const promptAggregate = jest.fn().mockResolvedValue({ _min: { nextReviewAt: null } });
    const topicUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      prompt: { delete: promptDelete, aggregate: promptAggregate },
      topic: { update: topicUpdate },
    };
    const prisma: any = {
      prompt: { findFirst: promptFindFirst },
      $transaction: (cb: any) => cb(tx),
    };
    const service = new PromptsService(prisma);

    await service.remove('userA', 'p1');

    expect(promptDelete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(topicUpdate).toHaveBeenCalled(); // recomputeTopicDue ran inside the same tx
  });

  it('404s when the prompt does not belong to the user', async () => {
    const prisma: any = { prompt: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PromptsService(prisma);
    await expect(service.remove('userA', 'not-mine')).rejects.toBeInstanceOf(NotFoundException);
  });
});
