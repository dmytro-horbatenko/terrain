import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      review: { findMany: jest.fn().mockResolvedValue([]) },
      topic: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [MetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(MetricsService);
  });

  it('computes mastery: all three conditions => eligible', () => {
    const s = service.masteryStatus({
      interval: 30,
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s).toEqual({ retention: true, application: true, teaching: true, eligible: true });
  });

  it('mastery not eligible when one condition fails', () => {
    const s = service.masteryStatus({
      interval: 29,
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s.retention).toBe(false);
    expect(s.eligible).toBe(false);
  });

  it('teaching true via summary when noteRef is null', () => {
    const s = service.masteryStatus({
      interval: 0,
      appEventCount: 0,
      noteRef: null,
      summary: 'my notes',
    });
    expect(s.teaching).toBe(true);
  });

  it('struggleRatio7d returns 0 with no reviews', async () => {
    expect(await service.struggleRatio7d('userA', new Date('2026-01-08T00:00:00Z'))).toBe(0);
  });

  it('struggleRatio7d = poor/total over the window', async () => {
    prisma.review.findMany.mockResolvedValue([
      { quality: 1 },
      { quality: 2 },
      { quality: 4 },
      { quality: 5 },
    ]);
    expect(await service.struggleRatio7d('userA', new Date('2026-01-08T00:00:00Z'))).toBe(0.5);
  });

  it('struggleRatio7d scopes reviews to the user', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma: any = { review: { findMany } };
    const svc = new MetricsService(prisma);
    await svc.struggleRatio7d('userA', new Date('2026-07-01T00:00:00Z'));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'userA' }) }),
    );
  });

  it('heatmap emits a dense oldest-first series counting reviews per local day', async () => {
    const now = new Date('2026-01-08T12:00:00');
    // two reviews today, one the day before — rest of the window is empty
    prisma.review.findMany.mockResolvedValue([
      { reviewedAt: new Date('2026-01-08T09:00:00') },
      { reviewedAt: new Date('2026-01-08T20:00:00') },
      { reviewedAt: new Date('2026-01-07T10:00:00') },
    ]);
    const series = await service.heatmap('userA', now, 7);
    expect(series).toHaveLength(7);
    expect(series[0].date < series[6].date).toBe(true); // oldest first
    const last = series[6];
    const prev = series[5];
    expect(last.date).toBe('2026-01-08');
    expect(last.count).toBe(2);
    expect(prev.date).toBe('2026-01-07');
    expect(prev.count).toBe(1);
    expect(series.slice(0, 5).every((c) => c.count === 0)).toBe(true);
    // only fetches reviews within the window, scoped to the user
    expect(prisma.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA', reviewedAt: { gte: expect.any(Date) } },
      }),
    );
  });

  it('dueTopics scopes the query by user and domain when provided', async () => {
    await service.dueTopics('userA', new Date('2026-01-08T00:00:00Z'), 'DSA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'userA', status: 'active', domain: 'DSA' }),
      }),
    );
  });

  it('topicLabels: blocked when planned with an unmastered prerequisite', () => {
    expect(
      service.topicLabels({ status: 'planned', repetitions: 0, prerequisiteStatuses: ['active'] }),
    ).toEqual({ blocked: true, reviewing: false });
  });
  it('topicLabels: planned with all prereqs mastered is not blocked', () => {
    expect(
      service.topicLabels({
        status: 'planned',
        repetitions: 0,
        prerequisiteStatuses: ['mastered', 'mastered'],
      }),
    ).toEqual({ blocked: false, reviewing: false });
  });
  it('topicLabels: reviewing when active with repetitions > 0', () => {
    expect(
      service.topicLabels({ status: 'active', repetitions: 3, prerequisiteStatuses: [] }),
    ).toEqual({ blocked: false, reviewing: true });
  });

  it('dashboard composes counts from groupBy and due lengths', async () => {
    prisma.topic.groupBy.mockResolvedValue([
      { status: 'planned', _count: 2 },
      { status: 'active', _count: 3 },
      { status: 'mastered', _count: 1 },
    ]);
    const now = new Date('2026-01-08T12:00:00Z');
    prisma.topic.findMany.mockResolvedValue([
      { nextReviewAt: new Date('2026-01-05T00:00:00Z') }, // overdue in every timezone
      { nextReviewAt: now }, // >= startOfToday in every timezone => dueToday
    ]);
    const result = await service.dashboard('userA', now, 'DSA');
    expect(prisma.topic.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['status'], where: { userId: 'userA', domain: 'DSA' } }),
    );
    expect(result.generatedAt).toBe(now.toISOString());
    expect(result.struggleRatio7d).toBe(0);
    expect(result.counts).toEqual({
      total: 6,
      planned: 2,
      active: 3,
      mastered: 1,
      archived: 0,
      dueToday: 1,
      overdue: 1,
    });
  });
});
