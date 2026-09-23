import { Test } from '@nestjs/testing';
import { LearningContextService } from '../learning/learning-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExportGeneratorService } from './export-generator.service';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

describe('SessionsService.createExport', () => {
  let service: SessionsService;
  let create: jest.Mock;
  let update: jest.Mock;
  let findFirst: jest.Mock;
  let learning: { context: jest.Mock };
  let generator: { generate: jest.Mock; generateLearnContext: jest.Mock };

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({ id: 'sess-1' });
    update = jest.fn().mockResolvedValue({});
    findFirst = jest.fn();
    const prisma = { sessionExport: { create, update, findFirst } };
    generator = {
      generate: jest.fn().mockResolvedValue('header Session: <set-on-persist>\n\nbody'),
      generateLearnContext: jest
        .fn()
        .mockResolvedValue('header Session: <set-on-persist>\n\nlearn body'),
    };
    learning = {
      context: jest.fn().mockResolvedValue({
        target: {
          id: 't1',
          sessionEligible: true,
          approach: { recommended: 'guided' },
        },
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExportGeneratorService, useValue: generator },
        { provide: LearningContextService, useValue: learning },
      ],
    }).compile();
    service = mod.get(SessionsService);
  });

  it('persists the export and injects the session id into the markdown', async () => {
    const out = await service.createExport('userA', { mode: 'full' });
    expect(out.id).toBe('sess-1');
    expect(out.exportMd).toContain('Session: sess-1');
    expect(out.exportMd).not.toContain('<set-on-persist>');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'userA' }) }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: { exportMd: expect.stringContaining('Session: sess-1') },
    });
  });

  it('recovers an owned export unchanged without creating a replacement', async () => {
    const saved = { id: 'sess-1', exportMd: 'Session: sess-1\nSaved 30-minute exercise' };
    findFirst.mockImplementation(({ where }) =>
      Promise.resolve(where.id === saved.id && where.userId === 'userA' ? saved : null),
    );
    await expect(service.getExport('userA', saved.id)).resolves.toEqual(saved);
    await expect(service.getExport('userB', saved.id)).rejects.toThrow('Session not found');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: saved.id, userId: 'userA' },
      select: { id: true, exportMd: true },
    });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns the persisted review snapshot for the wizard to retain with its session id', async () => {
    const reviewPlan = {
      promptIds: ['11111111-1111-4111-8111-111111111111'],
      estimatedMinutes: 30,
      budgetMinutes: 30,
      reviewMinutes: 15,
      reviewPromptId: '11111111-1111-4111-8111-111111111111',
    };
    generator.generate.mockResolvedValue(
      `<!-- terrain-review: ${JSON.stringify(reviewPlan)} -->\nSession: <set-on-persist>`,
    );
    const out = await service.createExport('userA', {
      mode: 'repeat',
      reviewPromptId: reviewPlan.reviewPromptId,
    });
    expect(out).toMatchObject({ id: 'sess-1', reviewPlan });
    expect(out.exportMd).toContain('Session: sess-1');
  });

  it("writes mode: 'full' and domain: null for a plain full export", async () => {
    await service.createExport('userA', { mode: 'full' });
    const data = create.mock.calls[0][0].data;
    expect(data.mode).toBe('full');
    expect(data.domain).toBeNull();
    expect(data).not.toHaveProperty('domains');
  });

  it("writes mode: 'domain' and the parsed domain for a domain-scoped export", async () => {
    await service.createExport('userA', { mode: 'domain:DSA' });
    const data = create.mock.calls[0][0].data;
    expect(data.mode).toBe('domain');
    expect(data.domain).toBe('DSA');
    expect(data).not.toHaveProperty('domains');
  });

  it("treats an unset mode as 'full' with a null domain", async () => {
    await service.createExport('userA', {});
    const data = create.mock.calls[0][0].data;
    expect(data.mode).toBe('full');
    expect(data.domain).toBeNull();
  });

  it.each([
    ['repeat', 'repeat', null],
    ['learn', 'learn', null],
  ])("writes mode: '%s' and a null domain for mode %s", async (mode, expected, domain) => {
    await service.createExport('userA', { mode });
    const data = create.mock.calls[0][0].data;
    expect(data.mode).toBe(expected);
    expect(data.domain).toBe(domain);
  });

  it('persists the resolved focus and recommended approach for a default learn export', async () => {
    await service.createExport('userA', { mode: 'learn' });

    expect(learning.context).toHaveBeenCalledWith('userA', {
      topic: undefined,
      now: expect.any(Date),
    });
    expect(learning.context.mock.calls[0][1].now).toBe(
      generator.generateLearnContext.mock.calls[0][2],
    );
    expect(generator.generateLearnContext).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ id: 't1' }) }),
      'guided',
      expect.any(Date),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'userA',
        mode: 'learn',
        focusTopicId: 't1',
        approach: 'guided',
      }),
    });
  });

  it('persists an explicit source-first override using the Prisma enum spelling', async () => {
    await service.createExport('userA', {
      mode: 'learn',
      focusTopicId: 'requested-topic',
      approach: 'source-first',
    });

    expect(learning.context).toHaveBeenCalledWith('userA', {
      topic: 'requested-topic',
      now: expect.any(Date),
    });
    expect(generator.generateLearnContext).toHaveBeenCalledWith(
      expect.any(Object),
      'source-first',
      expect.any(Date),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        focusTopicId: 't1',
        approach: 'source_first',
      }),
    });
  });

  it('rejects a context whose target cannot start a session', async () => {
    learning.context.mockResolvedValue({
      target: {
        id: 'blocked',
        sessionEligible: false,
        approach: { recommended: 'guided' },
      },
    });

    await expect(
      service.createExport('userA', { mode: 'learn', focusTopicId: 'blocked' }),
    ).rejects.toThrow('No startable topic.');
    expect(generator.generateLearnContext).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('SessionsController.export', () => {
  it('uses the first query value and passes an exact learning approach', () => {
    const createExport = jest.fn();
    const controller = new SessionsController({ createExport } as unknown as SessionsService);

    controller.export(
      'userA',
      ['learn', 'full'],
      ['topic-1', 'topic-2'],
      ['source-first', 'guided'],
    );

    expect(createExport).toHaveBeenCalledWith('userA', {
      mode: 'learn',
      focusTopicId: 'topic-1',
      approach: 'source-first',
    });
  });

  it('rejects an approach outside guided and source-first', () => {
    const controller = new SessionsController({
      createExport: jest.fn(),
    } as unknown as SessionsService);

    expect(() => controller.export('userA', 'learn', 'topic-1', ['other', 'guided'])).toThrow(
      'approach must be guided or source-first',
    );
  });
});
