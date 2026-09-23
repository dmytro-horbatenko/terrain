import { Test } from '@nestjs/testing';
import type { LearningContext } from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { ExportGeneratorService } from './export-generator.service';
import { OUTPUT_CONTRACT } from './output-contract';

function makeUserMock() {
  return {
    findUnique: jest.fn().mockResolvedValue({
      id: 'userA',
      name: 'Dima',
      headline: 'Mid-senior full-stack dev, TypeScript + Solidity + DeFi',
      learningStyle: 'Socratic, depth-first, tabulation over memoization',
      codeStyle: 'readable > optimized, TypeScript',
      noteSystem: 'OneNote (iPad drawings) + Obsidian (markdown)',
    }),
  };
}

function makeMetrics(prisma: any) {
  const real = new MetricsService(prisma as any, { nextUp: jest.fn() } as any);
  return {
    dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
    dueCards: jest.fn().mockResolvedValue([]),
    reviewStats7d: jest.fn().mockResolvedValue({ total: 25, again: 11, againRatio: 0.44 }),
    masteryStatus: real.masteryStatus.bind(real),
    topicLabels: real.topicLabels.bind(real),
    nextUp: jest.fn().mockResolvedValue(null),
  };
}

describe('ExportGeneratorService', () => {
  let service: ExportGeneratorService;
  let prisma: any;
  let metrics: any;

  beforeEach(async () => {
    prisma = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't1',
            title: 'Stacks & queues',
            domain: 'DSA',
            status: 'active',
            nextReviewAt: new Date('2026-01-01'),
            noteRef: null,
            summary: null,
            parentId: null,
            prerequisites: [],
            prompts: [{ reps: 3, stability: null, suspended: false }],
          },
        ]),
        findFirst: jest.fn(),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    metrics = makeMetrics(prisma);
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    service = mod.get(ExportGeneratorService);
  });

  it('always includes WHO I AM and the OUTPUT CONTRACT', async () => {
    const md = await service.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('## WHO I AM');
    expect(md).toContain('learning-os');
    expect(md).toContain('OUTPUT CONTRACT');
  });

  it('OUTPUT CONTRACT is always the last section emitted', async () => {
    const md = await service.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md.endsWith(OUTPUT_CONTRACT)).toBe(true);
  });

  it('MASTERY CONDITIONS uses the new retention wording', async () => {
    const md = await service.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('all active cards at stability ≥ 30d');
  });

  it('includes a ROADMAP section with the seeded topic', async () => {
    const md = await service.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('ROADMAP');
    expect(md).toContain('Stacks & queues');
  });

  it('adds a SESSION GOAL section only when focusTopicId is set', async () => {
    const without = await service.generate({
      now: new Date('2026-01-08T09:00:00Z'),
      userId: 'userA',
    });
    expect(without).not.toContain('SESSION GOAL');
    const withFocus = await service.generate({
      focusTopicId: 't1',
      now: new Date('2026-01-08T09:00:00Z'),
      userId: 'userA',
    });
    expect(withFocus).toContain('SESSION GOAL');
  });

  it('deep tree: nested topics A→B→C are all rendered (not dropped)', async () => {
    const prisma2 = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'A',
            title: 'TopicA',
            domain: 'DSA',
            status: 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            prerequisites: [],
            prompts: [],
          },
          {
            id: 'B',
            title: 'TopicB',
            domain: 'DSA',
            status: 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: 'A',
            prerequisites: [],
            prompts: [],
          },
          {
            id: 'C',
            title: 'TopicC',
            domain: 'DSA',
            status: 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: 'B',
            prerequisites: [],
            prompts: [],
          },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics2 = makeMetrics(prisma2);
    const mod2 = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma2 },
        { provide: MetricsService, useValue: metrics2 },
      ],
    }).compile();
    const svc2 = mod2.get(ExportGeneratorService);
    const md = await svc2.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('TopicA');
    expect(md).toContain('TopicB');
    expect(md).toContain('TopicC');
  });

  it('blocked glyph: planned topic stays blocked until its prerequisite chapter is complete', async () => {
    const prisma3 = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'basics',
            title: 'Blockchain basics',
            domain: 'Web3',
            status: 'active',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            prerequisites: [],
            prompts: [],
          },
          ...Array.from({ length: 13 }, (_, i) => ({
            id: `basic-${i + 1}`,
            title: `Basic ${i + 1}`,
            domain: 'Web3',
            status: i < 5 ? 'active' : 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: 'basics',
            prerequisites: [],
            prompts: [],
          })),
          {
            id: 'accounts',
            title: 'Accounts, transactions & gas',
            domain: 'DSA',
            status: 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            prerequisites: [{ prerequisiteId: 'basics' }],
            prompts: [],
          },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics3 = makeMetrics(prisma3);
    const mod3 = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma3 },
        { provide: MetricsService, useValue: metrics3 },
      ],
    }).compile();
    const svc3 = mod3.get(ExportGeneratorService);
    const md = await svc3.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('✗ Accounts, transactions & gas');
    expect(md).toContain('○ Basic 6');
  });

  it('reviewing tag: active topic with a reviewed card renders (reviewing)', async () => {
    const prisma4 = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'Y',
            title: 'ReviewingTopic',
            domain: 'DSA',
            status: 'active',
            nextReviewAt: new Date('2026-01-01'),
            noteRef: null,
            summary: null,
            parentId: null,
            prerequisites: [],
            prompts: [{ reps: 3, stability: null, suspended: false }],
          },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics4 = makeMetrics(prisma4);
    const mod4 = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma4 },
        { provide: MetricsService, useValue: metrics4 },
      ],
    }).compile();
    const svc4 = mod4.get(ExportGeneratorService);
    const md = await svc4.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('(reviewing)');
    expect(md).toContain('ReviewingTopic');
  });

  it('adds SUGGESTED NEXT FOCUS from the last import when no focusTopicId', async () => {
    const prisma: any = {
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ nextFocusTitle: 'Heaps', nextColdChallenge: 'LC #215' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics = {
      dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
      dueCards: jest.fn().mockResolvedValue([]),
      reviewStats7d: jest.fn().mockResolvedValue({ total: 0, again: 0, againRatio: null }),
      masteryStatus: () => ({
        retention: false,
        application: false,
        teaching: false,
        eligible: false,
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const local = mod.get(ExportGeneratorService);
    const md = await local.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('## SUGGESTED NEXT FOCUS');
    expect(md).toContain('Heaps');
    expect(md).toContain('LC #215');
  });

  it('renders PARKED IDEAS for aiProposed+archived topics (and omits when none)', async () => {
    const prisma: any = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'z',
            title: 'Skip lists',
            domain: 'DSA',
            topicType: 'concept',
            status: 'archived',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            aiProposed: true,
            aiContext: 'came up while discussing balanced trees',
            prerequisites: [],
            prompts: [],
          },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics = makeMetrics(prisma);
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const svc = mod.get(ExportGeneratorService);
    const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('## PARKED IDEAS');
    expect(md).toContain('- Skip lists (concept, DSA) — came up while discussing balanced trees');
    expect(md).not.toContain('↳ AI context');
  });

  it('excludes parked topics from ROADMAP while still listing them under PARKED IDEAS', async () => {
    const prisma: any = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'active1',
            title: 'Binary search',
            domain: 'DSA',
            topicType: 'pattern',
            status: 'active',
            nextReviewAt: new Date('2026-01-01'),
            noteRef: null,
            summary: null,
            parentId: null,
            aiProposed: false,
            aiContext: null,
            prerequisites: [],
            prompts: [{ reps: 2, stability: null, suspended: false }],
          },
          {
            id: 'parked1',
            title: 'Bloom filters',
            domain: 'DSA',
            topicType: 'concept',
            status: 'archived',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            aiProposed: true,
            aiContext: 'came up while discussing hashing',
            prerequisites: [],
            prompts: [],
          },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics = makeMetrics(prisma);
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const svc = mod.get(ExportGeneratorService);
    const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });

    // Isolate just the ROADMAP portion (from its header up to the PARKED IDEAS
    // header, which the generator emits immediately after the roadmap section).
    const roadmapStart = md.indexOf('## ROADMAP');
    const parkedStart = md.indexOf('## PARKED IDEAS');
    expect(roadmapStart).toBeGreaterThanOrEqual(0);
    expect(parkedStart).toBeGreaterThan(roadmapStart);
    const roadmapSection = md.slice(roadmapStart, parkedStart);

    // Active topic appears in ROADMAP; parked topic does NOT.
    expect(roadmapSection).toContain('Binary search');
    expect(roadmapSection).not.toContain('Bloom filters');

    // Parked topic is still listed once, under PARKED IDEAS.
    const parkedSection = md.slice(parkedStart);
    expect(parkedSection).toContain(
      '- Bloom filters (concept, DSA) — came up while discussing hashing',
    );
  });

  it('omits PARKED IDEAS when there are no parked topics', async () => {
    const md = await service.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).not.toContain('PARKED IDEAS');
  });

  it('annotates tentative nodes with their aiContext in the ROADMAP', async () => {
    const prisma: any = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'q',
            title: 'Fenwick trees',
            domain: 'DSA',
            topicType: 'pattern',
            status: 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            aiProposed: true,
            aiContext: 'suggested for prefix-sum problems',
            prerequisites: [],
            prompts: [],
          },
        ]),
      },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics = makeMetrics(prisma);
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const svc = mod.get(ExportGeneratorService);
    const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('Fenwick trees');
    expect(md).toContain('  ↳ AI context: suggested for prefix-sum problems');
  });

  it('renders RECENT SESSIONS from recent SessionExport rows (omits when none)', async () => {
    const prisma: any = {
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            generatedAt: new Date('2026-01-05T10:00:00Z'),
            importedAt: new Date('2026-01-06T08:00:00Z'),
            newTopicsCreated: ['a', 'b'],
            nextFocusTitle: 'Segment trees',
          },
          {
            generatedAt: new Date('2026-01-02T10:00:00Z'),
            importedAt: null,
            newTopicsCreated: [],
            nextFocusTitle: null,
          },
        ]),
      },
      user: makeUserMock(),
    };
    const metrics = makeMetrics(prisma);
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const svc = mod.get(ExportGeneratorService);
    const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('## RECENT SESSIONS');
    expect(md).toContain(
      '- 2026-01-05 — imported 2026-01-06; 2 topics created; next focus: Segment trees',
    );
    expect(md).toContain('- 2026-01-02 — not imported; 0 topics created');
    expect(prisma.sessionExport.findMany).toHaveBeenCalledWith({
      where: { userId: 'userA' },
      orderBy: { generatedAt: 'desc' },
      take: 3,
    });
  });

  it("scopes topics to the user and renders the user's profile as the identity block", async () => {
    const prisma: any = {
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'userA',
          name: 'Neo',
          headline: 'Hacker',
          learningStyle: 'x',
          codeStyle: 'y',
          noteSystem: 'z',
        }),
      },
    };
    const metrics: any = {
      reviewStats7d: jest.fn().mockResolvedValue({ total: 0, again: 0, againRatio: null }),
      dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
      dueCards: jest.fn().mockResolvedValue([]),
    };
    const svc = new ExportGeneratorService(prisma, metrics);
    const md = await svc.generate({ now: new Date('2026-07-01T00:00:00Z'), userId: 'userA' });
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'userA' }) }),
    );
    expect(md).toContain('Name: Neo');
    expect(md).not.toContain('Name: Dima');
  });

  it('due section lists due cards as sub-lines under their due topic', async () => {
    const dueTopic: any = { id: 't1', title: 'Stacks & queues', topicType: 'concept' };
    const prisma: any = {
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics: any = {
      dueTopics: jest.fn().mockResolvedValue({ overdue: [dueTopic], dueToday: [] }),
      dueCards: jest
        .fn()
        .mockResolvedValue([
          { id: 'card1', topicId: 't1', promptKind: 'concept', promptText: 'What is a stack?' },
        ]),
      reviewStats7d: jest.fn().mockResolvedValue({ total: 0, again: 0, againRatio: null }),
      masteryStatus: () => ({
        retention: false,
        application: false,
        teaching: false,
        eligible: false,
      }),
      topicLabels: () => ({ blocked: false, reviewing: false }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const svc = mod.get(ExportGeneratorService);
    const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).toContain('- Stacks & queues [concept]');
    expect(md).toContain('  - card card1 [concept] What is a stack?');
    expect(md.indexOf('- Stacks & queues [concept]')).toBeLessThan(
      md.indexOf('  - card card1 [concept] What is a stack?'),
    );
  });

  it('does not render due-card sub-lines for a card whose topic is not in the due topics list', async () => {
    const prisma: any = {
      topic: { findMany: jest.fn().mockResolvedValue([]) },
      applicationEvent: { count: jest.fn().mockResolvedValue(0) },
      sessionExport: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: makeUserMock(),
    };
    const metrics: any = {
      dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
      dueCards: jest
        .fn()
        .mockResolvedValue([
          { id: 'card2', topicId: 'orphan', promptKind: 'concept', promptText: 'Orphan card' },
        ]),
      reviewStats7d: jest.fn().mockResolvedValue({ total: 0, again: 0, againRatio: null }),
      masteryStatus: () => ({
        retention: false,
        application: false,
        teaching: false,
        eligible: false,
      }),
      topicLabels: () => ({ blocked: false, reviewing: false }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExportGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();
    const svc = mod.get(ExportGeneratorService);
    const md = await svc.generate({ now: new Date('2026-01-08T09:00:00Z'), userId: 'userA' });
    expect(md).not.toContain('Orphan card');
  });

  describe('mode=repeat', () => {
    const NOW = new Date('2026-07-03T10:00:00Z');

    function repeatMocks() {
      const items = [
        {
          promptId: 'p1',
          topicId: 't1',
          topicTitle: 'Two Sum',
          chapterTitle: 'Arrays & Hashing',
          kind: 'concept',
          isNew: false,
          nextReviewAt: new Date('2026-07-02T00:00:00Z'),
          createdAt: new Date('2026-06-01T00:00:00Z'),
        },
        {
          promptId: 'p2',
          topicId: 't2',
          topicTitle: 'Binary Search',
          chapterTitle: 'Binary Search',
          kind: 'problem',
          isNew: true,
          nextReviewAt: null,
          createdAt: new Date('2026-06-02T00:00:00Z'),
        },
      ];
      const prompts = [
        {
          id: 'p1',
          promptText: 'What does a hash map trade for O(1) lookups?',
          promptKind: 'concept',
          estimatedMinutes: null,
          answerHint: 'Extra space for an index; collisions still need resolution.',
          reviews: [
            {
              grade: 'again',
              reviewedAt: new Date('2026-07-01T10:00:00Z'),
              note: 'Claimed collisions are impossible; corrected after an example.',
            },
          ],
        },
        {
          id: 'p2',
          promptText: 'Solve: Search in Rotated Sorted Array',
          promptKind: 'problem',
          estimatedMinutes: 30,
          answerHint: null,
          reviews: [],
        },
      ];
      return { items, prompts };
    }

    it('renders the interleaved queue in order with [NEW] tags, conduct block, and no roadmap', async () => {
      const prisma: any = {
        user: makeUserMock(),
        prompt: { findMany: jest.fn() },
      };
      const metrics: any = { sessionQueue: jest.fn() };
      const { items, prompts } = repeatMocks();
      metrics.sessionQueue = jest.fn().mockResolvedValue({
        items: items.map((item, i) => ({
          ...item,
          promptText: prompts[i].promptText,
          estimatedMinutes: i === 0 ? 2 : 10,
        })),
        estimatedMinutes: 12,
        budgetMinutes: 15,
        backlogCount: 8,
        backlogMinutes: 55,
        deferredExercises: [],
      });
      prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
      prisma.prompt.findMany = jest.fn().mockResolvedValue(prompts);
      const svc = new ExportGeneratorService(prisma, metrics);

      const md = await svc.generate({ mode: 'repeat', now: NOW, userId: 'u1' });

      expect(md).toContain("## TODAY'S REVIEW QUEUE");
      expect(md).toContain('2 cards (1 due, 1 first retrievals)');
      expect(md).toContain('estimated 12 min');
      expect(md).toContain('budget 15 min');
      expect(md).toContain('Full eligible backlog: 8 cards · estimated 55 min');
      expect(md.split('\n')[0]).toBe(
        '<!-- terrain-review: {"promptIds":["p1","p2"],"estimatedMinutes":12,"budgetMinutes":15,"reviewMinutes":15} -->',
      );
      expect(prisma.prompt.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['p1', 'p2'] }, topic: { userId: 'u1' } },
        select: {
          id: true,
          answerHint: true,
          reviews: {
            where: { userId: 'u1' },
            orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { grade: true, reviewedAt: true, note: true },
          },
        },
      });
      expect(md).toContain('Extra space for an index; collisions still need resolution.');
      expect(md).toContain('2026-07-01T10:00:00.000Z');
      expect(md).toContain('Claimed collisions are impossible; corrected after an example.');
      expect(md).not.toContain('undefined');
      const p1 = md.indexOf('card p1 [concept] (Arrays & Hashing) What does a hash map');
      const p2 = md.indexOf('card p2 [problem] [NEW] (Binary Search) Solve: Search in Rotated');
      expect(p1).toBeGreaterThan(-1);
      expect(p2).toBeGreaterThan(p1); // queue order preserved
      expect(md).toContain('## SESSION CONDUCT — repetition');
      expect(md).toContain('## OUTPUT CONTRACT');
      expect(md).toContain('Export: repeat');
      // lean context: landscape sections omitted
      expect(md).not.toContain('## ROADMAP');
      expect(md).not.toContain('## MASTERY CONDITIONS');
      expect(md).not.toContain('## RECENT SESSIONS');
    });

    it('renders "Nothing due today." and no conduct block for an empty queue', async () => {
      const prisma: any = {
        user: makeUserMock(),
        prompt: { findMany: jest.fn() },
      };
      const metrics: any = { sessionQueue: jest.fn() };
      metrics.sessionQueue = jest.fn().mockResolvedValue({
        items: [],
        estimatedMinutes: 0,
        budgetMinutes: 15,
        backlogCount: 0,
        backlogMinutes: 0,
        deferredExercises: [],
      });
      prisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Dm' });
      const svc = new ExportGeneratorService(prisma, metrics);

      const md = await svc.generate({ mode: 'repeat', now: NOW, userId: 'u1' });

      expect(md).toContain('Nothing due today.');
      expect(prisma.prompt.findMany).not.toHaveBeenCalled();
      expect(md).not.toContain('## SESSION CONDUCT');
      expect(md).toContain('## OUTPUT CONTRACT');
    });

    it('does not claim all clear when the selected slice cannot fit the remaining exercise', async () => {
      const svc = new ExportGeneratorService(
        { user: makeUserMock() } as any,
        {
          sessionQueue: jest.fn().mockResolvedValue({
            items: [],
            estimatedMinutes: 0,
            budgetMinutes: 15,
            backlogCount: 1,
            backlogMinutes: 30,
            deferredExercises: [],
          }),
        } as any,
      );
      const md = await svc.generate({ mode: 'repeat', now: NOW, userId: 'u1' });
      expect(md).toContain('Full eligible backlog: 1 cards');
      expect(md).not.toContain('Nothing due today.');
      expect(md).toContain('Choose a focused exercise');
    });
  });

  describe('canonical learn context', () => {
    const NOW = new Date('2026-07-24T10:00:00Z');
    const evidence: LearningContext['mayRelyOn'][number]['evidence'] = {
      recentGrades: ['good'],
      lastReviewedAt: '2026-07-23T10:00:00.000Z',
      sourceTitles: ['Canonical docs'],
      applicationCount: 1,
      latestApplication: 'Implemented the mechanism',
    };
    const context = {
      schemaVersion: 1,
      generatedAt: NOW.toISOString(),
      learner: {
        role: 'TypeScript developer',
        learningStyle: 'Socratic',
        codeStyle: 'Readable',
        noteSystem: 'Obsidian',
      },
      target: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Prefix sums',
        domain: 'DSA',
        topicType: 'pattern',
        kind: 'leaf',
        sessionEligible: true,
        status: 'planned',
        description: 'Running cumulative totals.',
        sourcePlan: {
          policy: 'required',
          requirements: [
            {
              id: 'canonical',
              purpose: 'Ground the invariant',
              requiredWhen: 'first_exposure',
              options: [
                {
                  id: 'docs',
                  title: 'Prefix sum guide',
                  url: 'https://example.com/prefix-sums',
                  format: 'article',
                  scope: 'Construction and range queries',
                  estimatedMinutes: 10,
                  why: 'Concise worked examples',
                  paid: false,
                  language: 'en',
                  verifiedAt: '2026-01-01',
                  recheckAfterDays: 30,
                },
              ],
            },
          ],
        },
        chapter: {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Arrays & Hashing',
          learnedLeaves: 2,
          totalLeaves: 5,
        },
        approach: { recommended: 'guided', reasons: ['contains a code prompt'] },
        prompts: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            kind: 'code',
            text: 'Implement a prefix-sum query.',
            state: 'learning',
            difficulty: 4,
            stability: 2,
            lastGrade: 'hard',
          },
        ],
      },
      selection: {
        source: 'authored-order',
        importedFocus: {
          title: 'Blocked topic',
          accepted: false,
          reason: 'Prerequisite chapter is incomplete.',
        },
        learnableAlternatives: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            title: 'Two Sum',
            chapterTitle: 'Arrays & Hashing',
          },
        ],
      },
      prerequisites: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          title: 'Arrays',
          status: 'active',
          satisfied: true,
          reason: 'This prerequisite is satisfied.',
          learnedLeaves: 1,
          totalLeaves: 1,
          summary: 'Contiguous indexed storage.',
          evidence,
          children: [
            {
              id: '66666666-6666-4666-8666-666666666666',
              title: 'Index arithmetic',
              status: 'active',
              satisfied: true,
              reason: 'This prerequisite is satisfied.',
              learnedLeaves: 1,
              totalLeaves: 1,
              summary: null,
              evidence,
              children: [],
            },
          ],
        },
      ],
      mayRelyOn: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          title: 'Arrays',
          status: 'active',
          level: 'practicing',
          reason: 'Recorded evidence shows active practice.',
          summary: 'Contiguous indexed storage.',
          evidence,
        },
      ],
      doNotAssume: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          title: 'Algebraic invariants',
          status: 'active',
          level: 'introduced',
          reason: 'Verify it before relying on it.',
          summary: null,
          evidence: { ...evidence, recentGrades: [], applicationCount: 0 },
        },
      ],
      blockers: [
        {
          topicId: '88888888-8888-4888-8888-888888888888',
          title: 'Optional advanced branch',
          reason: 'Not required for this target.',
        },
      ],
    } satisfies LearningContext;

    it.each(['guided', 'source-first'] as const)(
      'carries partial study and its next challenge into a %s export',
      (approach) => {
        const resumedContext = {
          ...context,
          target: {
            ...context.target,
            prompts: [
              {
                ...context.target.prompts[0],
                lastGrade: 'again' as const,
                lastReviewedAt: '2026-09-01T12:00:00.000Z',
                lastReviewNote: 'First attempt confused list items with bytes; hint supplied.',
              },
            ],
            title: 'RLP',
            summary: 'Encoded short strings; lists remain unfinished.',
            studyContext: 'Build an RLP encoder and verify boundary lengths.',
            noteRef: 'Obsidian: Web3/RLP',
            continuation: {
              sessionId: '00000000-0000-4000-8000-000000000009',
              importedAt: '2026-09-01T12:00:00.000Z',
              coldChallenge: 'Encode a nested list and explain its length prefix.',
              resuming: true,
            },
          },
        };

        const md = service.generateLearnContext(resumedContext, approach, NOW);

        expect(md).toContain('Encoded short strings; lists remain unfinished.');
        expect(md).toContain('First attempt confused list items with bytes; hint supplied.');
        expect(md).toContain('Build an RLP encoder and verify boundary lengths.');
        expect(md).toContain('Obsidian: Web3/RLP');
        expect(md).toContain('Encode a nested list and explain its length prefix.');
        expect(md).toContain('2026-09-01T12:00:00.000Z');
        expect(md).toContain('00000000-0000-4000-8000-000000000009');
        expect(md).not.toContain('Exposure: not yet studied');
        expect(md).toContain('Requirement canonical');
        expect(md.endsWith(OUTPUT_CONTRACT)).toBe(true);
      },
    );

    it('keeps a suggested opening challenge separate from evidence of prior study', () => {
      const newTopicContext = {
        ...context,
        target: {
          ...context.target,
          continuation: {
            sessionId: '00000000-0000-4000-8000-000000000009',
            importedAt: '2026-09-01T12:00:00.000Z',
            coldChallenge: 'Explain what makes a prefix sum useful.',
            resuming: false,
          },
        },
      };

      const md = service.generateLearnContext(newTopicContext, 'guided', NOW);

      expect(md).toContain('Explain what makes a prefix sum useful.');
      expect(md).toContain('Exposure: no study recorded');
    });

    it('exports recorded study work and makes credited source requirements explicit', () => {
      const md = service.generateLearnContext(
        {
          ...context,
          target: {
            ...context.target,
            sourceProgress: [
              {
                requirementId: 'canonical',
                sourceTitle: 'Guide',
                sourceUrl: 'https://example.com/guide',
                mainClaim: 'Prefix sums accumulate ranges.',
                supportingMechanism: 'Subtract two prefixes.',
                openQuestion: 'How does overflow behave?',
                recordedAt: '2026-01-01T00:00:00.000Z',
                reusable: true,
              },
            ],
            applications: [
              {
                description: 'Derived range subtraction unaided.',
                url: 'https://example.com/derivation',
                appliedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        },
        'source-first',
        NOW,
      );
      expect(md).toContain('already credited');
      expect(md).not.toContain('EXPIRED — verify live before use');
      expect(md).toContain('catalog recheck due');
      expect(md).toContain('Prefix sums accumulate ranges.');
      expect(md).toContain('How does overflow behave?');
      expect(md).toContain('https://example.com/derivation');
      expect(md).toContain('Exposure: partial study recorded');
      expect(md).toContain('Do not resubmit recorded evidence');
      expect(md).toContain('Agree one objective');
      expect(md.endsWith(OUTPUT_CONTRACT)).toBe(true);
    });

    it('renders guided learning only from the canonical context and keeps the output contract last', () => {
      const md = service.generateLearnContext(context, 'guided', NOW);

      expect(md).toContain('## TERRAIN MCP — supplemental context');
      expect(md).toContain('call get_learning_context once for Prefix sums');
      expect(md).toContain('This copied export remains authoritative');
      expect(md).toContain('If the tool is unavailable, continue with this export');
      expect(md).toContain('## WHO I AM');
      expect(md).toContain('Role: TypeScript developer');
      expect(md).toContain('## SELECTION');
      expect(md).toContain('Prerequisite chapter is incomplete.');
      expect(md).toContain('## LEARNING GOAL');
      expect(md).toContain('Chapter: Arrays & Hashing (2/5 leaves learned)');
      expect(md).toContain('## SOURCE PLAN');
      expect(md).toContain('Prefix sum guide');
      expect(md).toContain('Paid: false; Language: en');
      expect(md).toContain('Verified at: 2026-01-01');
      expect(md).toContain('EXPIRED');
      expect(md).toContain('## PREREQUISITES');
      expect(md).toContain('  - Index arithmetic');
      expect(md).toContain('## MAY RELY ON');
      expect(md).toContain('Arrays [practicing]');
      expect(md).toContain('Sources: Canonical docs');
      expect(md).toContain('Latest application: Implemented the mechanism');
      expect(md).toContain('## DO NOT ASSUME');
      expect(md).toContain('Algebraic invariants [introduced]');
      expect(md).toContain('## BLOCKERS');
      expect(md).toContain('## SESSION CONDUCT — guided learning');
      expect(md).toContain('- card 33333333-3333-4333-8333-333333333333 [code]');
      expect(md).toContain('difficulty 4; stability 2');
      expect(md.endsWith(OUTPUT_CONTRACT)).toBe(true);
      expect(prisma.topic.findFirst).not.toHaveBeenCalled();
      expect(prisma.topic.findMany).not.toHaveBeenCalled();
    });

    it('selects the source-first conduct script without changing the canonical sections', () => {
      const md = service.generateLearnContext(context, 'source-first', NOW);

      expect(md).toContain('## SESSION CONDUCT — source-first learning');
      expect(md).toContain('1. SELECT');
      expect(md).toContain('2. CONSUME');
      expect(md).toContain('3. RECONSTRUCT');
      expect(md).toContain('Do not teach the topic before required source reconstruction');
      expect(md).toContain(
        'Exposure: no study recorded — prior understanding is unknown; calibrate only what this objective needs',
      );
      expect(md).toContain('Chosen approach: source-first');
      expect(md).toContain('Recommended approach: guided');
      expect(md).toContain('Recommendation reasons: contains a code prompt');
      expect(md).not.toContain('Approach: source-first\nWhy: contains a code prompt');
      expect(md).toContain('## MAY RELY ON');
      expect(md.endsWith(OUTPUT_CONTRACT)).toBe(true);
    });

    it('does not turn a missing source plan into a gate for guided learning', () => {
      const guidedContext = {
        ...context,
        target: { ...context.target, sourcePlan: null },
      } satisfies LearningContext;

      const md = service.generateLearnContext(guidedContext, 'guided', NOW);

      expect(md).toContain('Guided learning may proceed without a source gate.');
      expect(md).not.toContain('LEGACY FIRST EXPOSURE BLOCKED');
    });

    it.each([
      ['planned', 'LEGACY FIRST EXPOSURE BLOCKED'],
      ['active', 'LEGACY COMPATIBILITY MODE'],
    ] as const)('keeps source-first legacy handling for a %s target', (status, expected) => {
      const legacyContext = {
        ...context,
        target: { ...context.target, status, sourcePlan: null },
      } satisfies LearningContext;

      expect(service.generateLearnContext(legacyContext, 'source-first', NOW)).toContain(expected);
    });

    it('renders an explicit no-source policy', () => {
      const noSourceContext = {
        ...context,
        target: {
          ...context.target,
          sourcePlan: { policy: 'none', rationale: 'Practice only' },
        },
      } satisfies LearningContext;

      expect(service.generateLearnContext(noSourceContext, 'guided', NOW)).toContain(
        'No required sources: Practice only',
      );
    });

    it('renders only source requirements applicable to the target status', () => {
      const activeContext = {
        ...context,
        target: {
          ...context.target,
          status: 'active',
          sourcePlan: {
            policy: 'required',
            requirements: [
              ...context.target.sourcePlan.requirements,
              {
                id: 'current',
                purpose: 'Current behavior',
                requiredWhen: 'always',
                options: [
                  {
                    id: 'current-docs',
                    title: 'Current docs',
                    url: 'https://example.com/current',
                    format: 'documentation',
                    scope: 'Current behavior',
                    estimatedMinutes: 5,
                    why: 'Authoritative reference',
                  },
                ],
              },
            ],
          },
        },
      } satisfies LearningContext;

      const md = service.generateLearnContext(activeContext, 'source-first', NOW);
      expect(md).not.toContain('Requirement canonical');
      expect(md).toContain('Requirement current');
    });
  });
});
