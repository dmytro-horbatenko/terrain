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
      sessionExport: { findFirst: jest.fn().mockResolvedValue(null) },
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
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

  it('dueTopics excludes disabled domains when no explicit domain is given', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    await service.dueTopics('userA', new Date('2026-01-08T00:00:00Z'));
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domain: { notIn: ['DSA'] } }),
      }),
    );
  });

  it('dueTopics ignores disabledDomains when an explicit domain is given', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    await service.dueTopics('userA', new Date('2026-01-08T00:00:00Z'), 'DSA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ domain: 'DSA' }),
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

  it('dueCards excludes disabled domains when no explicit domain is given', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['Web3'] });
    await service.dueCards('userA', new Date('2026-01-08T12:00:00Z'));
    expect(prisma.prompt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          topic: { userId: 'userA', status: { not: 'archived' }, domain: { notIn: ['Web3'] } },
        }),
      }),
    );
  });

  it('newCardsCount includes startable planned topics and excludes blocked ones', async () => {
    prisma.topic.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where?.status === 'planned'
          ? [
              {
                id: 'startable',
                prerequisites: [{ prerequisite: { status: 'active' } }],
                children: [],
              },
              { id: 'zero-prereq', prerequisites: [], children: [] },
              {
                id: 'blocked',
                prerequisites: [{ prerequisite: { status: 'planned' } }],
                children: [],
              },
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

  it('newCardsCount excludes disabled domains from both the startable-planned query and the count query', async () => {
    prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
    prisma.prompt.count.mockResolvedValue(2);
    const result = await service.newCardsCount('userA');
    expect(result).toBe(2);
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA', status: 'planned', domain: { notIn: ['DSA'] } },
      }),
    );
    expect(prisma.prompt.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ topic: { userId: 'userA', domain: { notIn: ['DSA'] } } }),
      }),
    );
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
                {
                  id: 't-blocked',
                  prerequisites: [{ prerequisite: { status: 'planned' } }],
                  children: [],
                },
                {
                  id: 't-startable',
                  prerequisites: [{ prerequisite: { status: 'active' } }],
                  children: [],
                },
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
        Promise.resolve(
          where?.status === 'planned' ? [{ id: 't1', prerequisites: [], children: [] }] : [],
        ),
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
            ? [
                {
                  id: 't1',
                  prerequisites: [{ prerequisite: { status: 'planned' } }],
                  children: [],
                },
              ]
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

    it('skips a category/chapter topic (has children) even when otherwise startable, preferring its leaf', async () => {
      prisma.topic.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where?.status === 'planned'
            ? [
                { id: 'chapter', prerequisites: [], children: [{ id: 'leaf' }] },
                { id: 'leaf', prerequisites: [], children: [] },
              ]
            : [],
        ),
      );
      prisma.topic.findFirst.mockResolvedValue({ id: 'leaf', title: 'Leaf', parentId: null });
      const result = await service.nextUp('userA');
      expect(result?.topic.id).toBe('leaf');
    });

    it('returns null when the only startable planned topics are category/chapter nodes', async () => {
      prisma.topic.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where?.status === 'planned'
            ? [{ id: 'chapter', prerequisites: [], children: [{ id: 'leaf' }] }]
            : [],
        ),
      );
      expect(await service.nextUp('userA')).toBeNull();
      expect(prisma.topic.findFirst).not.toHaveBeenCalled();
    });

    it('scopes the candidate query by domain', async () => {
      prisma.topic.findMany.mockResolvedValue([]);
      await service.nextUp('userA', 'DSA');
      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'userA', status: 'planned', domain: 'DSA' } }),
      );
    });

    it('excludes disabled domains from the candidate query', async () => {
      prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
      prisma.topic.findMany.mockResolvedValue([]);
      await service.nextUp('userA');
      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'userA', status: 'planned', domain: { notIn: ['DSA'] } },
        }),
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

  describe('sessionQueue', () => {
    function queuePrompt(overrides: Record<string, unknown> = {}) {
      return {
        id: 'p1',
        promptKind: 'concept',
        state: 'review',
        nextReviewAt: new Date('2026-07-01T00:00:00Z'),
        createdAt: new Date('2026-06-01T00:00:00Z'),
        topic: { id: 't1', title: 'Two Sum', domain: 'DSA', parent: { title: 'Arrays & Hashing' } },
        ...overrides,
      };
    }

    it('queries due cards and capped new cards with the right predicates', async () => {
      prisma.prompt.findMany
        .mockResolvedValueOnce([]) // due
        .mockResolvedValueOnce([]); // new
      const now = new Date('2026-07-03T10:00:00');

      const result = await service.sessionQueue('u1', now);
      expect(result).toEqual({ items: [], estimatedMinutes: 0 });
      expect(prisma.prompt.findMany).toHaveBeenCalledTimes(2);

      // due query: same predicate family as dueCards (suspended:false, lt endOfToday, non-archived topics)
      expect(prisma.prompt.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          suspended: false,
          nextReviewAt: { not: null, lt: expect.any(Date) },
          topic: { userId: 'u1', status: { not: 'archived' } },
        },
        orderBy: { nextReviewAt: 'asc' },
      });

      // new-cards query: active topics only, capped at 5, stable order
      expect(prisma.prompt.findMany.mock.calls[1][0]).toMatchObject({
        where: {
          suspended: false,
          state: 'new',
          topic: { userId: 'u1', status: 'active' },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 5,
      });
    });

    it('maps prompts to queue items with parent title as chapter, domain as fallback', async () => {
      prisma.prompt.findMany
        .mockResolvedValueOnce([
          queuePrompt(),
          queuePrompt({
            id: 'p2',
            nextReviewAt: new Date('2026-07-02T00:00:00Z'),
            topic: { id: 't2', title: 'Orphan topic', domain: 'Systems', parent: null },
          }),
        ])
        .mockResolvedValueOnce([queuePrompt({ id: 'p3', state: 'new', nextReviewAt: null })]);

      const { items } = await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'));
      const byId = new Map(items.map((i) => [i.promptId, i]));

      expect(byId.get('p1')).toMatchObject({
        topicId: 't1',
        topicTitle: 'Two Sum',
        chapterTitle: 'Arrays & Hashing',
        kind: 'concept',
        isNew: false,
      });
      expect(byId.get('p2')!.chapterTitle).toBe('Systems'); // domain fallback
      expect(byId.get('p3')).toMatchObject({ isNew: true, nextReviewAt: null });
      expect(items).toHaveLength(3);
    });

    it('passes the domain filter into both queries', async () => {
      prisma.prompt.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'), 'DSA');
      expect(prisma.prompt.findMany.mock.calls[0][0].where.topic).toMatchObject({ domain: 'DSA' });
      expect(prisma.prompt.findMany.mock.calls[1][0].where.topic).toMatchObject({ domain: 'DSA' });
    });

    it('excludes disabled domains from both the due and new-card queries', async () => {
      prisma.settings.findUnique.mockResolvedValue({ disabledDomains: ['DSA'] });
      prisma.prompt.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'));
      expect(prisma.prompt.findMany.mock.calls[0][0].where.topic).toMatchObject({
        domain: { notIn: ['DSA'] },
      });
      expect(prisma.prompt.findMany.mock.calls[1][0].where.topic).toMatchObject({
        domain: { notIn: ['DSA'] },
      });
    });

    it('returns estimatedMinutes from explicit values with kind fallbacks', async () => {
      prisma.prompt.findMany
        .mockResolvedValueOnce([
          {
            id: 'p1',
            promptKind: 'concept',
            estimatedMinutes: null,
            state: 'review',
            nextReviewAt: new Date('2026-07-03T09:00:00'),
            createdAt: new Date('2026-01-01'),
            topic: { id: 't1', title: 'T1', domain: 'DSA', parent: null },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'p2',
            promptKind: 'code',
            estimatedMinutes: 5,
            state: 'new',
            nextReviewAt: null,
            createdAt: new Date('2026-01-02'),
            topic: { id: 't2', title: 'T2', domain: 'DSA', parent: null },
          },
        ]);
      const result = await service.sessionQueue('u1', new Date('2026-07-03T10:00:00'));
      // concept fallback (2) + explicit estimate (5)
      expect(result.estimatedMinutes).toBe(7);
    });
  });

  it('dashboard includes sessionQueueCount', async () => {
    // beforeEach stubs every findMany to [] — dashboard resolves with an empty queue.
    const dash = await service.dashboard('u1', new Date('2026-07-03T10:00:00'));
    expect(dash.sessionQueueCount).toBe(0);
  });

  it('dashboard includes sessionQueueMinutes', async () => {
    // beforeEach stubs every findMany to [] — empty queue estimates 0 minutes.
    const dash = await service.dashboard('u1', new Date('2026-07-03T10:00:00'));
    expect(dash.sessionQueueMinutes).toBe(0);
  });

  describe('pendingSessions (via dashboard)', () => {
    const now = new Date('2026-07-03T10:00:00Z');

    it('reports the latest un-imported repeat/learn export within 48h', async () => {
      prisma.sessionExport.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.mode === 'learn'
            ? {
                id: 'se2',
                mode: 'learn',
                generatedAt: new Date('2026-07-03T08:00:00Z'),
                importedAt: null,
              }
            : {
                id: 'se1',
                mode: 'repeat',
                generatedAt: new Date('2026-07-02T09:00:00Z'),
                importedAt: new Date('2026-07-02T10:00:00Z'),
              },
        ),
      );
      const dash = await service.dashboard('u1', now);
      // repeat's latest was imported → excluded; learn is pending → included
      expect(dash.pendingSessions).toEqual([
        { id: 'se2', mode: 'learn', generatedAt: new Date('2026-07-03T08:00:00Z') },
      ]);
    });

    it('ignores un-imported exports older than 48h', async () => {
      prisma.sessionExport.findFirst.mockResolvedValue({
        id: 'old',
        mode: 'learn',
        generatedAt: new Date('2026-06-30T08:00:00Z'),
        importedAt: null,
      });
      const dash = await service.dashboard('u1', now);
      expect(dash.pendingSessions).toEqual([]);
    });
  });
});
