import { ReviewsService } from './reviews.service';

function reviewedPrompt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    topicId: 't1',
    stability: 3.2,
    difficulty: 5.1,
    reps: 2,
    lapses: 0,
    state: 'review',
    lastReviewedAt: new Date('2026-06-25T00:00:00Z'),
    nextReviewAt: new Date('2026-07-02T00:00:00Z'),
    ...overrides,
  };
}

function buildTx({
  topic = { id: 't1', userId: 'userA' },
  prompt = reviewedPrompt(),
}: { topic?: any; prompt?: any } = {}) {
  const topicFindFirst = jest.fn().mockResolvedValue(topic);
  const topicUpdate = jest.fn().mockResolvedValue({});
  const promptFindFirst = jest.fn().mockResolvedValue(prompt);
  const promptUpdate = jest.fn().mockResolvedValue({});
  const promptAggregate = jest.fn().mockResolvedValue({ _min: { nextReviewAt: null } });
  const reviewCreate = jest
    .fn()
    .mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data }));

  const tx = {
    topic: { findFirst: topicFindFirst, update: topicUpdate },
    prompt: { findFirst: promptFindFirst, update: promptUpdate, aggregate: promptAggregate },
    review: { create: reviewCreate },
  };
  return { tx, topicFindFirst, topicUpdate, promptFindFirst, promptUpdate, reviewCreate };
}

describe('ReviewsService.logReview (card review, via promptId)', () => {
  it('runs FSRS and persists before/after intervals in days', async () => {
    const { tx, promptUpdate, reviewCreate } = buildTx();
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const service = new ReviewsService(prisma);

    await service.logReview('userA', {
      topicId: 't1',
      promptId: 'p1',
      grade: 'good',
      mode: 'app_log',
    });

    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.userId).toBe('userA');
    expect(created.grade).toBe('good');
    expect(created.intervalBefore).toBe(7); // 2026-06-25 -> 2026-07-02
    expect(typeof created.intervalAfter).toBe('number');
    expect(promptUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1' } }));
    expect(promptUpdate.mock.calls[0][0].data.reps).toBe(3);
  });

  it('recomputes topic.nextReviewAt after a card review', async () => {
    const { tx, topicUpdate } = buildTx();
    tx.prompt.aggregate = jest
      .fn()
      .mockResolvedValue({ _min: { nextReviewAt: new Date('2026-07-10T00:00:00Z') } });
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const service = new ReviewsService(prisma);

    await service.logReview('userA', {
      topicId: 't1',
      promptId: 'p1',
      grade: 'good',
      mode: 'app_log',
    });

    expect(topicUpdate).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { nextReviewAt: new Date('2026-07-10T00:00:00Z') },
    });
  });
});

describe('ReviewsService.logReview (evidence review, no promptId)', () => {
  it('creates a review with promptId null and does not touch prompt/topic SR state', async () => {
    const { tx, promptUpdate, topicUpdate, reviewCreate } = buildTx();
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const service = new ReviewsService(prisma);

    const result = await service.logReview('userA', {
      topicId: 't1',
      grade: 'good',
      mode: 'claude_session',
    });

    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.promptId).toBeNull();
    expect(created.intervalBefore).toBeNull();
    expect(created.intervalAfter).toBeNull();
    expect(promptUpdate).not.toHaveBeenCalled();
    expect(topicUpdate).not.toHaveBeenCalled();
    expect(result.previewNextReviewAt).toBeNull();
  });
});

describe('ReviewsService cross-user isolation', () => {
  it('logReview 404s when the topic belongs to another user', async () => {
    const { tx, topicFindFirst } = buildTx({ topic: null });
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const service = new ReviewsService(prisma);

    await expect(
      service.logReview('userA', {
        topicId: 'topic-owned-by-B',
        grade: 'good',
        mode: 'app_log',
      }),
    ).rejects.toThrow(/not found/i);
    expect(topicFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'topic-owned-by-B', userId: 'userA' }),
      }),
    );
  });

  it('findByTopic scopes review lookup by userId', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = { review: { findMany } };
    const service = new ReviewsService(prisma);
    await service.findByTopic('userA', 't1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ topicId: 't1', userId: 'userA' }),
      }),
    );
  });

  it('resolves promptId scoped by topicId and the topic owner userId', async () => {
    const { tx, promptFindFirst } = buildTx();
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const service = new ReviewsService(prisma);

    await service.logReview('userA', {
      topicId: 't1',
      promptId: 'p1',
      grade: 'good',
      mode: 'app_log',
    });

    expect(promptFindFirst).toHaveBeenCalledWith({
      where: { id: 'p1', topicId: 't1', topic: { userId: 'userA' } },
    });
  });

  it('404s when promptId does not belong to the given topic/user', async () => {
    const { tx } = buildTx({ prompt: null });
    const prisma: any = { $transaction: (cb: any) => cb(tx) };
    const service = new ReviewsService(prisma);

    await expect(
      service.logReview('userA', {
        topicId: 't1',
        promptId: 'ghost',
        grade: 'good',
        mode: 'app_log',
      }),
    ).rejects.toThrow(/not found/i);
  });
});
