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
        findFirst: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      prompt: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const mod = await Test.createTestingModule({
      providers: [MetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(MetricsService);
  });

  it('computes mastery: all three conditions => eligible', () => {
    const s = service.masteryStatus({
      cards: [{ stability: 30, suspended: false }],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s).toEqual({ retention: true, application: true, teaching: true, eligible: true });
  });

  it('mastery not eligible when one condition fails', () => {
    const s = service.masteryStatus({
      cards: [{ stability: 29, suspended: false }],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s.retention).toBe(false);
    expect(s.eligible).toBe(false);
  });

  it('teaching true via summary when noteRef is null', () => {
    const s = service.masteryStatus({
      cards: [],
      appEventCount: 0,
      noteRef: null,
      summary: 'my notes',
    });
    expect(s.teaching).toBe(true);
  });

  it('mastery retention boundary: stability 29.9 is false, 30 is true', () => {
    const below = service.masteryStatus({
      cards: [{ stability: 29.9, suspended: false }],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(below.retention).toBe(false);

    const at = service.masteryStatus({
      cards: [{ stability: 30, suspended: false }],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(at.retention).toBe(true);
  });

  it('mastery retention is false when there are zero cards', () => {
    const s = service.masteryStatus({
      cards: [],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s.retention).toBe(false);
  });

  it('mastery retention treats a null-stability card as failing, not crashing', () => {
    const s = service.masteryStatus({
      cards: [{ stability: null, suspended: false }],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s.retention).toBe(false);
  });

  it('mastery retention excludes suspended cards from the min-stability computation', () => {
    const s = service.masteryStatus({
      cards: [
        { stability: 5, suspended: true },
        { stability: 40, suspended: false },
      ],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s.retention).toBe(true);
  });

  it('mastery retention is false when all cards are suspended', () => {
    const s = service.masteryStatus({
      cards: [{ stability: 100, suspended: true }],
      appEventCount: 1,
      noteRef: 'x',
      summary: null,
    });
    expect(s.retention).toBe(false);
  });

  it('struggleRatio7d returns 0 with no reviews', async () => {
    expect(await service.struggleRatio7d('userA', new Date('2026-01-08T00:00:00Z'))).toBe(0);
  });

  it('struggleRatio7d = poor/total over the window, counting only again', async () => {
    prisma.review.findMany.mockResolvedValue([
      { grade: 'again' },
      { grade: 'again' },
      { grade: 'good' },
      { grade: 'easy' },
    ]);
    expect(await service.struggleRatio7d('userA', new Date('2026-01-08T00:00:00Z'))).toBe(0.5);
  });

  it('struggleRatio7d does not count hard as struggle', async () => {
    prisma.review.findMany.mockResolvedValue([
      { grade: 'again' },
      { grade: 'hard' },
      { grade: 'good' },
      { grade: 'easy' },
    ]);
    expect(await service.struggleRatio7d('userA', new Date('2026-01-08T00:00:00Z'))).toBe(0.25);
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

  it('topicLabels: planned with an active prerequisite is NOT blocked (started gate)', () => {
    expect(
      service.topicLabels({ status: 'planned', cards: [], prerequisiteStatuses: ['active'] }),
    ).toEqual({ blocked: false, reviewing: false });
  });
  it('topicLabels: planned with a planned prerequisite is blocked', () => {
    expect(
      service.topicLabels({ status: 'planned', cards: [], prerequisiteStatuses: ['planned'] }),
    ).toEqual({ blocked: true, reviewing: false });
  });
  it('topicLabels: planned with an archived prerequisite is blocked', () => {
    expect(
      service.topicLabels({ status: 'planned', cards: [], prerequisiteStatuses: ['archived'] }),
    ).toEqual({ blocked: true, reviewing: false });
  });
  it('topicLabels: one unstarted prerequisite among started ones still blocks', () => {
    expect(
      service.topicLabels({
        status: 'planned',
        cards: [],
        prerequisiteStatuses: ['mastered', 'active', 'planned'],
      }),
    ).toEqual({ blocked: true, reviewing: false });
  });
  it('topicLabels: a non-planned topic is never blocked', () => {
    expect(
      service.topicLabels({ status: 'active', cards: [], prerequisiteStatuses: ['planned'] }),
    ).toEqual({ blocked: false, reviewing: false });
  });
  it('topicLabels: planned with all prereqs mastered is not blocked', () => {
    expect(
      service.topicLabels({
        status: 'planned',
        cards: [],
        prerequisiteStatuses: ['mastered', 'mastered'],
      }),
    ).toEqual({ blocked: false, reviewing: false });
  });
  it('topicLabels: reviewing when any card has reps > 0', () => {
    expect(
      service.topicLabels({
        status: 'active',
        cards: [{ reps: 0 }, { reps: 3 }],
        prerequisiteStatuses: [],
      }),
    ).toEqual({ blocked: false, reviewing: true });
  });
  it('topicLabels: not reviewing when all cards have reps === 0', () => {
    expect(
      service.topicLabels({
        status: 'active',
        cards: [{ reps: 0 }, { reps: 0 }],
        prerequisiteStatuses: [],
      }),
    ).toEqual({ blocked: false, reviewing: false });
  });
  it('topicLabels: not reviewing when cards array is empty', () => {
    expect(service.topicLabels({ status: 'active', cards: [], prerequisiteStatuses: [] })).toEqual({
      blocked: false,
      reviewing: false,
    });
  });

  it('dueCards scopes to non-suspended cards through non-archived topics (including mastered)', async () => {
    const now = new Date('2026-01-08T12:00:00Z');
    await service.dueCards('userA', now, 'DSA');
    expect(prisma.prompt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          suspended: false,
          topic: { userId: 'userA', status: { not: 'archived' }, domain: 'DSA' },
        }),
      }),
    );
  });

  it('newCardsCount includes startable planned topics and excludes blocked ones', async () => {
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.status === 'planned'
          ? [
              { id: 'startable', prerequisites: [{ prerequisite: { status: 'active' } }] },
              { id: 'zero-prereq', prerequisites: [] },
              { id: 'blocked', prerequisites: [{ prerequisite: { status: 'planned' } }] },
            ]
          : [],
      ),
    );
    prisma.prompt.count.mockResolvedValue(3);
    const result = await service.newCardsCount('userA', 'DSA');
    expect(result).toBe(3);
    expect(prisma.prompt.count).toHaveBeenCalledWith({
      where: {
        suspended: false,
        state: 'new',
        topic: { userId: 'userA', domain: 'DSA' },
        OR: [
          { topic: { status: { in: ['active', 'mastered'] } } },
          { topicId: { in: ['startable', 'zero-prereq'] } },
        ],
      },
    });
  });
  it('newCardsCount queries planned topics in creation order scoped to the user', async () => {
    await service.newCardsCount('userA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA', status: 'planned' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('newCardsCount returns a number via prisma.prompt.count, not findMany().length', async () => {
    prisma.prompt.count.mockResolvedValue(4);
    const result = await service.newCardsCount('userA');
    expect(result).toBe(4);
    expect(prisma.prompt.findMany).not.toHaveBeenCalled();
  });

  it('dashboard composes counts from groupBy and due lengths, and includes newCards', async () => {
    prisma.topic.groupBy.mockResolvedValue([
      { status: 'planned', _count: 2 },
      { status: 'active', _count: 3 },
      { status: 'mastered', _count: 1 },
    ]);
    const now = new Date('2026-01-08T12:00:00Z');
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.status === 'planned'
          ? []
          : [
              { nextReviewAt: new Date('2026-01-05T00:00:00Z') }, // overdue in every timezone
              { nextReviewAt: now }, // >= startOfToday in every timezone => dueToday
            ],
      ),
    );
    prisma.prompt.count.mockResolvedValue(7);
    const result = await service.dashboard('userA', now, 'DSA');
    expect(prisma.topic.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['status'], where: { userId: 'userA', domain: 'DSA' } }),
    );
    expect(result.generatedAt).toBe(now.toISOString());
    expect(result.struggleRatio7d).toBe(0);
    expect(result.newCards).toBe(7);
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

  describe('nextUp', () => {
    it('returns the first startable planned topic in creation order, skipping blocked ones', async () => {
      prisma.topic.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where?.status === 'planned'
            ? [
                { id: 't-blocked', prerequisites: [{ prerequisite: { status: 'planned' } }] },
                { id: 't-startable', prerequisites: [{ prerequisite: { status: 'active' } }] },
              ]
            : [],
        ),
      );
      prisma.topic.findFirst.mockResolvedValue({
        id: 't-startable',
        title: 'Stack',
        parentId: null,
      });
      const result = await service.nextUp('userA');
      expect(result).toEqual({
        topic: { id: 't-startable', title: 'Stack', parentId: null },
        chapterTitle: null,
        chapterProgress: null,
      });
      // ordering is delegated to SQL — assert it, and that aiProposed is NOT filtered
      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'userA', status: 'planned' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('attaches chapter title and started/total progress when the topic has a parent', async () => {
      prisma.topic.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where?.status === 'planned' ? [{ id: 't1', prerequisites: [] }] : []),
      );
      prisma.topic.findFirst
        .mockResolvedValueOnce({ id: 't1', title: 'Two Sum', parentId: 'chapter-1' })
        .mockResolvedValueOnce({
          title: 'Arrays & Hashing',
          children: [{ status: 'active' }, { status: 'mastered' }, { status: 'planned' }],
        });
      const result = await service.nextUp('userA');
      expect(result?.chapterTitle).toBe('Arrays & Hashing');
      expect(result?.chapterProgress).toEqual({ started: 2, total: 3 });
    });

    it('returns null when every planned topic is blocked', async () => {
      prisma.topic.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where?.status === 'planned'
            ? [{ id: 't1', prerequisites: [{ prerequisite: { status: 'planned' } }] }]
            : [],
        ),
      );
      expect(await service.nextUp('userA')).toBeNull();
      expect(prisma.topic.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when no planned topics exist', async () => {
      prisma.topic.findMany.mockResolvedValue([]);
      expect(await service.nextUp('userA')).toBeNull();
    });

    it('scopes the candidate query by domain', async () => {
      prisma.topic.findMany.mockResolvedValue([]);
      await service.nextUp('userA', 'DSA');
      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'userA', status: 'planned', domain: 'DSA' } }),
      );
    });
  });

  it('dashboard includes nextUp (null when nothing is startable)', async () => {
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(where?.status === 'planned' ? [] : []),
    );
    const result = await service.dashboard('userA', new Date('2026-01-08T12:00:00Z'));
    expect(result.nextUp).toBeNull();
  });
});
