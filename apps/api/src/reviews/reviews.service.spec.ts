import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from './reviews.service';

describe('ReviewsService.logReview', () => {
  let service: ReviewsService;
  let topicUpdate: jest.Mock;
  let reviewCreate: jest.Mock;

  beforeEach(async () => {
    topicUpdate = jest.fn().mockResolvedValue({});
    reviewCreate = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data }));
    const prisma = {
      topic: {
        findFirst: jest.fn().mockResolvedValue({
          id: 't1',
          userId: 'userA',
          interval: 6,
          repetitions: 1,
          easeFactor: 2.5,
          learnedAt: null,
          status: 'planned',
        }),
        update: topicUpdate,
      },
      review: { create: reviewCreate },
      $transaction: (fns: any[]) => Promise.all(fns),
    };
    const mod = await Test.createTestingModule({
      providers: [ReviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(ReviewsService);
  });

  it('runs SM-2 and persists before/after intervals', async () => {
    await service.logReview('userA', { topicId: 't1', quality: 4, mode: 'app_log' });
    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.intervalBefore).toBe(6);
    expect(created.intervalAfter).toBe(6); // rep was 1 → second success → interval 6
    expect(created.userId).toBe('userA');
    const updated = topicUpdate.mock.calls[0][0].data;
    expect(updated.repetitions).toBe(2);
    expect(updated.status).toBe('active'); // planned → active on first review
    expect(updated.learnedAt).toBeInstanceOf(Date); // set on first review
  });

  it('resets interval to 1 on a failed review (quality < 3)', async () => {
    await service.logReview('userA', { topicId: 't1', quality: 1, mode: 'telegram_quick' });
    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.intervalAfter).toBe(1);
  });
});

describe('ReviewsService cross-user isolation', () => {
  it('logReview 404s when the topic belongs to another user', async () => {
    const prisma: any = { topic: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new ReviewsService(prisma);
    await expect(
      service.logReview('userA', { topicId: 'topic-owned-by-B', quality: 4, mode: 'app_log' }),
    ).rejects.toThrow(/not found/i);
    expect(prisma.topic.findFirst).toHaveBeenCalledWith(
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
});

describe('ReviewsService.logReview with promptId', () => {
  function build() {
    const topicUpdate = jest.fn().mockResolvedValue({});
    const promptUpdate = jest.fn().mockResolvedValue({});
    const reviewCreate = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data }));
    const prisma: any = {
      topic: {
        findFirst: jest.fn().mockResolvedValue({
          id: 't1',
          userId: 'userA',
          interval: 6,
          repetitions: 1,
          easeFactor: 2.5,
          nextReviewAt: null,
          learnedAt: null,
          status: 'planned',
        }),
        update: topicUpdate,
      },
      prompt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          topicId: 't1',
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
          nextReviewAt: null,
        }),
        update: promptUpdate,
      },
      review: { create: reviewCreate },
      $transaction: (fns: any[]) => Promise.all(fns),
    };
    return { prisma, topicUpdate, promptUpdate, reviewCreate };
  }

  it('updates both the topic and the prompt SR state, and stamps review.promptId', async () => {
    const { prisma, topicUpdate, promptUpdate, reviewCreate } = build();
    const service = new ReviewsService(prisma);
    await service.logReview('userA', {
      topicId: 't1',
      promptId: 'p1',
      quality: 5,
      mode: 'app_log',
    });
    expect(prisma.prompt.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', topicId: 't1', topic: { userId: 'userA' } },
    });
    expect(promptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ repetitions: 1 }),
      }),
    );
    const created = reviewCreate.mock.calls[0][0].data;
    expect(created.promptId).toBe('p1');
    expect(topicUpdate).toHaveBeenCalled();
  });

  it('404s when promptId does not belong to the given topic/user', async () => {
    const { prisma } = build();
    prisma.prompt.findFirst = jest.fn().mockResolvedValue(null);
    const service = new ReviewsService(prisma);
    await expect(
      service.logReview('userA', { topicId: 't1', promptId: 'ghost', quality: 5, mode: 'app_log' }),
    ).rejects.toThrow(/not found/i);
  });
});
