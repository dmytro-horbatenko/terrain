import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { TopicsService } from './topics.service';

const metricsMock: any = {
  topicLabels: () => ({ blocked: false, reviewing: false }),
  masteryStatus: () => ({}),
};

describe('TopicsService', () => {
  let service: TopicsService;
  let prisma: {
    topic: any;
    topicType: any;
    review: any;
    prerequisite: any;
    prompt: any;
    $transaction: any;
  };

  beforeEach(async () => {
    prisma = {
      topic: {
        create: jest.fn().mockResolvedValue({ id: 't1', title: 'X' }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      topicType: { upsert: jest.fn().mockResolvedValue({}) },
      review: { findMany: jest.fn().mockResolvedValue([]) },
      prerequisite: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      prompt: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((ops: any) => Promise.all(ops)),
    };
    const mod = await Test.createTestingModule({
      providers: [TopicsService, MetricsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = mod.get(TopicsService);
  });

  it('creates a topic and registers its type in the soft vocabulary', async () => {
    await service.create('userA', {
      title: 'Monotonic stack',
      domain: 'DSA',
      topicType: ' Pattern ',
    });
    expect(prisma.topicType.upsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'userA', key: 'pattern' } },
      update: {},
      create: { userId: 'userA', key: 'pattern', label: 'Pattern' },
    });
    expect(prisma.topic.create).toHaveBeenCalled();
  });

  it('findAll derives prerequisiteIds and labels (blocked planned + reviewing active)', async () => {
    prisma.topic.findMany.mockResolvedValue([
      { id: 'p', title: 'Prereq', status: 'active', repetitions: 0, prerequisites: [] },
      {
        id: 't1',
        title: 'Blocked',
        status: 'planned',
        repetitions: 0,
        prerequisites: [{ prerequisiteId: 'p' }],
      },
      { id: 't2', title: 'Reviewing', status: 'active', repetitions: 3, prerequisites: [] },
    ]);
    const result = await service.findAll('userA');
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'userA' },
        orderBy: { createdAt: 'asc' },
        include: { prerequisites: { select: { prerequisiteId: true } } },
      }),
    );
    const blocked = result.find((t) => t.id === 't1')!;
    expect(blocked.prerequisiteIds).toEqual(['p']);
    expect(blocked.labels).toEqual({ blocked: true, reviewing: false });
    expect((blocked as any).prerequisites).toBeUndefined();
    const reviewing = result.find((t) => t.id === 't2')!;
    expect(reviewing.prerequisiteIds).toEqual([]);
    expect(reviewing.labels).toEqual({ blocked: false, reviewing: true });
  });

  it('getDetail maps prerequisites/dependents/parent/children/mastery', async () => {
    prisma.topic.findFirst.mockResolvedValue({
      id: 't1',
      title: 'T1',
      status: 'active',
      repetitions: 2,
      interval: 30,
      noteRef: 'ref',
      summary: null,
      parent: { id: 'pa', title: 'Parent', status: 'active' },
      children: [{ id: 'c1', title: 'Child', status: 'planned' }],
      prerequisites: [{ prerequisite: { id: 'pr', title: 'Prereq', status: 'mastered' } }],
      dependents: [{ topic: { id: 'dp', title: 'Dependent', status: 'planned' } }],
      reviews: [{ id: 'r1' }],
      appEvents: [
        { id: 'ae1', kind: 'problem_solved', description: 'd1' },
        { id: 'ae2', kind: 'project_usage', description: 'd2' },
      ],
    });
    const result = await service.getDetail('userA', 't1');
    expect(result.prerequisiteIds).toEqual(['pr']);
    expect(result.prerequisites).toEqual([{ id: 'pr', title: 'Prereq', status: 'mastered' }]);
    expect(result.dependents).toEqual([{ id: 'dp', title: 'Dependent', status: 'planned' }]);
    expect(result.parent).toEqual({ id: 'pa', title: 'Parent', status: 'active' });
    expect(result.children).toEqual([{ id: 'c1', title: 'Child', status: 'planned' }]);
    expect(result.reviews).toEqual([{ id: 'r1' }]);
    expect(result.appEventCount).toBe(2);
    expect(result.appEvents).toHaveLength(2);
    expect(result.appEvents[0]).toMatchObject({ id: 'ae1', kind: 'problem_solved' });
    expect(result.labels).toEqual({ blocked: false, reviewing: true });
    expect(result.mastery).toEqual({
      retention: true,
      application: true,
      teaching: true,
      eligible: true,
    });
    expect((result as any).prerequisites[0].prerequisite).toBeUndefined();
  });

  it("getDetail includes the topic's prompts", async () => {
    prisma.topic.findFirst.mockResolvedValue({
      id: 't1',
      title: 'T1',
      status: 'active',
      repetitions: 2,
      interval: 30,
      noteRef: 'ref',
      summary: null,
      parent: null,
      children: [],
      prerequisites: [],
      dependents: [],
      reviews: [],
      appEvents: [],
      prompts: [
        { id: 'pr1', promptText: 'Q1', graduated: false, consecutiveGood: 1 },
        { id: 'pr2', promptText: 'Q2', graduated: true, consecutiveGood: 0 },
      ],
    });
    const result = await service.getDetail('userA', 't1');
    expect(result.prompts).toHaveLength(2);
    expect(result.prompts[1]).toMatchObject({ id: 'pr2', graduated: true });
  });

  it('getDetail throws 404 when the topic is missing', async () => {
    prisma.topic.findFirst.mockResolvedValue(null);
    await expect(service.getDetail('userA', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update forwards aiProposed (keep) through to prisma.topic.update', async () => {
    prisma.topic.findFirst.mockResolvedValue({ id: 't1', parentId: null });
    prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1', aiProposed: false });
    await service.update('userA', 't1', { aiProposed: false });
    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { aiProposed: false },
    });
  });

  it('update forwards status archived (set aside / park) through to prisma.topic.update', async () => {
    prisma.topic.findFirst.mockResolvedValue({ id: 't1', parentId: null });
    prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1', status: 'archived' });
    await service.update('userA', 't1', { status: 'archived' });
    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'archived' },
    });
  });

  it('update forwards status planned (restore) through to prisma.topic.update', async () => {
    prisma.topic.findFirst.mockResolvedValue({ id: 't1', parentId: null });
    prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1', status: 'planned' });
    await service.update('userA', 't1', { status: 'planned' });
    expect(prisma.topic.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'planned' },
    });
  });

  describe('reparent cycle guard', () => {
    beforeEach(() => {
      // graph: t1 (root) -> c1 (child of t1); p is an unrelated root
      prisma.topic.findFirst.mockImplementation(({ where }: any) => {
        const rows: Record<string, { id: string; parentId: string | null }> = {
          t1: { id: 't1', parentId: null },
          c1: { id: 'c1', parentId: 't1' },
          p: { id: 'p', parentId: null },
        };
        return Promise.resolve(rows[where.id] ?? null);
      });
      prisma.topic.update = jest.fn().mockResolvedValue({ id: 't1' });
    });

    it('rejects self-parent with 422', async () => {
      await expect(service.update('userA', 't1', { parentId: 't1' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('rejects reparenting under a descendant with 422', async () => {
      await expect(service.update('userA', 't1', { parentId: 'c1' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });

    it('allows a valid move and forwards parentId', async () => {
      await service.update('userA', 't1', { parentId: 'p' });
      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { parentId: 'p' },
      });
    });

    it('allows un-parenting (parentId null) without a cycle check', async () => {
      await service.update('userA', 'c1', { parentId: null } as any);
      expect(prisma.topic.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { parentId: null },
      });
    });

    it('rejects a non-existent parent with 404', async () => {
      await expect(service.update('userA', 't1', { parentId: 'ghost' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.topic.update).not.toHaveBeenCalled();
    });
  });

  describe('prerequisite editing', () => {
    beforeEach(() => {
      prisma.topic.findFirst.mockImplementation(({ where }: any) => {
        const known = new Set(['t1', 'p', 'q']);
        return Promise.resolve(known.has(where.id) ? { id: where.id } : null);
      });
      prisma.prerequisite = {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({ topicId: 't1', prerequisiteId: 'p' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      };
    });

    it('rejects a self-prerequisite with 422', async () => {
      await expect(service.addPrerequisite('userA', 't1', 't1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('404s when a topic is missing', async () => {
      await expect(service.addPrerequisite('userA', 'ghost', 'p')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a direct cycle with 422 (p already requires t1)', async () => {
      prisma.prerequisite.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.topicId === 'p' ? [{ prerequisiteId: 't1' }] : []),
      );
      await expect(service.addPrerequisite('userA', 't1', 'p')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rejects a transitive cycle with 422 (p requires q requires t1)', async () => {
      prisma.prerequisite.findMany.mockImplementation(({ where }: any) => {
        if (where.topicId === 'p') return Promise.resolve([{ prerequisiteId: 'q' }]);
        if (where.topicId === 'q') return Promise.resolve([{ prerequisiteId: 't1' }]);
        return Promise.resolve([]);
      });
      await expect(service.addPrerequisite('userA', 't1', 'p')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('adds a valid edge via upsert (idempotent on duplicate)', async () => {
      await service.addPrerequisite('userA', 't1', 'p');
      expect(prisma.prerequisite.upsert).toHaveBeenCalledWith({
        where: { topicId_prerequisiteId: { topicId: 't1', prerequisiteId: 'p' } },
        create: { topicId: 't1', prerequisiteId: 'p' },
        update: {},
      });
      // a repeat call is still a no-op upsert, never a throw
      await expect(service.addPrerequisite('userA', 't1', 'p')).resolves.toBeDefined();
    });

    it('removes an edge idempotently via deleteMany', async () => {
      await service.removePrerequisite('userA', 't1', 'p');
      expect(prisma.prerequisite.deleteMany).toHaveBeenCalledWith({
        where: { topicId: 't1', prerequisiteId: 'p' },
      });
    });
  });

  describe('delete rule', () => {
    it('404s when the topic is missing', async () => {
      prisma.topic.findFirst.mockResolvedValue(null);
      await expect(service.remove('userA', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409s when the topic has review history', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 't1',
        _count: { reviews: 1, appEvents: 0 },
      });
      await expect(service.remove('userA', 't1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s when the topic has application-event history', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 't1',
        _count: { reviews: 0, appEvents: 2 },
      });
      await expect(service.remove('userA', 't1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes a history-free topic, cascading edges and nulling children', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 't1',
        _count: { reviews: 0, appEvents: 0 },
      });
      prisma.prerequisite = { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) };
      prisma.topic.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.topic.delete = jest.fn().mockResolvedValue({ id: 't1' });
      prisma.prompt.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma.$transaction = jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));

      await service.remove('userA', 't1');

      expect(prisma.prerequisite.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ topicId: 't1' }, { prerequisiteId: 't1' }] },
      });
      expect(prisma.topic.updateMany).toHaveBeenCalledWith({
        where: { parentId: 't1', userId: 'userA' },
        data: { parentId: null },
      });
      expect(prisma.prompt.deleteMany).toHaveBeenCalledWith({ where: { topicId: 't1' } });
      expect(prisma.topic.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('deletes a topic that has prompts but no review history, removing the prompts first', async () => {
      prisma.topic.findFirst.mockResolvedValue({
        id: 't1',
        _count: { reviews: 0, appEvents: 0 },
      });
      prisma.prerequisite = { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
      prisma.topic.updateMany = jest.fn().mockResolvedValue({ count: 0 });
      prisma.topic.delete = jest.fn().mockResolvedValue({ id: 't1' });
      prisma.prompt.deleteMany = jest.fn().mockResolvedValue({ count: 3 });
      prisma.$transaction = jest.fn().mockImplementation((ops: unknown[]) => Promise.all(ops));

      await service.remove('userA', 't1');

      expect(prisma.prompt.deleteMany).toHaveBeenCalledWith({ where: { topicId: 't1' } });
      expect(prisma.topic.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('cross-user isolation', () => {
    it("getDetail scopes by userId so another user's topic 404s", async () => {
      const prisma: any = { topic: { findFirst: jest.fn().mockResolvedValue(null) } };
      const svc = new TopicsService(prisma, metricsMock);
      await expect(svc.getDetail('userA', 'topic-owned-by-B')).rejects.toThrow(/not found/i);
    });

    it('create stamps the userId onto the new topic', async () => {
      const created = jest.fn().mockResolvedValue({ id: 't1' });
      const prisma: any = { topic: { create: created }, topicType: { upsert: jest.fn() } };
      const svc = new TopicsService(prisma, metricsMock);
      await svc.create('userA', { title: 'X', domain: 'D', topicType: 'pattern' } as any);
      expect(created).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'userA' }) });
    });

    it('create 404s when parentId belongs to another user, instead of grafting onto their tree', async () => {
      const created = jest.fn();
      const prisma: any = {
        topic: { create: created, findFirst: jest.fn().mockResolvedValue(null) },
        topicType: { upsert: jest.fn() },
      };
      const svc = new TopicsService(prisma, metricsMock);
      await expect(
        svc.create('userA', {
          title: 'X',
          domain: 'D',
          topicType: 'pattern',
          parentId: 'topic-owned-by-B',
        } as any),
      ).rejects.toThrow(/not found/i);
      expect(prisma.topic.findFirst).toHaveBeenCalledWith({
        where: { id: 'topic-owned-by-B', userId: 'userA' },
      });
      expect(created).not.toHaveBeenCalled();
    });
  });
});
