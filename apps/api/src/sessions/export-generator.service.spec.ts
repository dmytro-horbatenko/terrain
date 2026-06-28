import { Test } from '@nestjs/testing';
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
  const real = new MetricsService(prisma as any);
  return {
    dueTopics: jest.fn().mockResolvedValue({ overdue: [], dueToday: [] }),
    dueCards: jest.fn().mockResolvedValue([]),
    struggleRatio7d: jest.fn().mockResolvedValue(0.44),
    masteryStatus: real.masteryStatus.bind(real),
    topicLabels: real.topicLabels.bind(real),
  };
}

describe('ExportGeneratorService', () => {
  let service: ExportGeneratorService;

  beforeEach(async () => {
    const prisma = {
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

  it('blocked glyph: planned topic with unmastered prereq renders ✗', async () => {
    const prisma3 = {
      topic: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'X',
            title: 'BlockedTopic',
            domain: 'DSA',
            status: 'planned',
            nextReviewAt: null,
            noteRef: null,
            summary: null,
            parentId: null,
            prerequisites: [{ prerequisite: { status: 'planned' } }],
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
    expect(md).toContain('✗');
    expect(md).toContain('BlockedTopic');
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
      struggleRatio7d: jest.fn().mockResolvedValue(0),
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
      struggleRatio7d: jest.fn().mockResolvedValue(0),
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
      struggleRatio7d: jest.fn().mockResolvedValue(0),
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
      struggleRatio7d: jest.fn().mockResolvedValue(0),
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
});
