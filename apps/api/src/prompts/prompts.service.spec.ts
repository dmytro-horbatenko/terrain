import { NotFoundException } from '@nestjs/common';
import { PromptsService } from './prompts.service';

describe('PromptsService.next', () => {
  it('picks the prompt with the earliest nextReviewAt', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p-later', nextReviewAt: new Date('2026-02-01') },
          { id: 'p-sooner', nextReviewAt: new Date('2026-01-01') },
        ]),
      },
    };
    const service = new PromptsService(prisma);
    const result = await service.next('userA', 't1');
    expect(result!.id).toBe('p-sooner');
  });

  it('treats a null nextReviewAt as most-overdue', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p-scheduled', nextReviewAt: new Date('2026-01-01') },
          { id: 'p-never-reviewed', nextReviewAt: null },
        ]),
      },
    };
    const service = new PromptsService(prisma);
    const result = await service.next('userA', 't1');
    expect(result!.id).toBe('p-never-reviewed');
  });

  it('returns null when the topic has no prompts', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PromptsService(prisma);
    expect(await service.next('userA', 't1')).toBeNull();
  });

  it('404s when the topic does not belong to the user', async () => {
    const prisma: any = { topic: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PromptsService(prisma);
    await expect(service.next('userA', 'not-mine')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('excludes graduated prompts from candidate selection', async () => {
    const prisma: any = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 't1', userId: 'userA' }) },
      prompt: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PromptsService(prisma);
    await service.next('userA', 't1');
    expect(prisma.prompt.findMany).toHaveBeenCalledWith({
      where: { topicId: 't1', graduated: false },
    });
  });
});

describe('PromptsService.setGraduated', () => {
  it('sets graduated and resets consecutiveGood to 0', async () => {
    const prisma: any = {
      prompt: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'p1', topicId: 't1', topic: { userId: 'userA' } }),
        update: jest.fn().mockResolvedValue({ id: 'p1', graduated: false, consecutiveGood: 0 }),
      },
    };
    const service = new PromptsService(prisma);
    await service.setGraduated('userA', 'p1', false);
    expect(prisma.prompt.findFirst).toHaveBeenCalledWith({
      where: { id: 'p1', topic: { userId: 'userA' } },
    });
    expect(prisma.prompt.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { graduated: false, consecutiveGood: 0 },
    });
  });

  it('404s when the prompt does not belong to the user', async () => {
    const prisma: any = { prompt: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = new PromptsService(prisma);
    await expect(service.setGraduated('userA', 'not-mine', true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
