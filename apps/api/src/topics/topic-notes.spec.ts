import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TopicsService } from './topics.service';

describe('learner-owned topic notes', () => {
  let service: TopicsService;
  let stored: { topicId: string; body: string; revision: number; updatedAt: Date } | null;
  let prisma: any;

  beforeEach(() => {
    stored = null;
    prisma = {
      topic: {
        findFirst: jest.fn(({ where }) =>
          Promise.resolve(
            where.id === 'topic-a' && where.userId === 'user-a'
              ? { id: 'topic-a', notes: stored, summary: 'AI summary' }
              : null,
          ),
        ),
        findMany: jest.fn().mockResolvedValue([{ id: 'topic-a' }]),
      },
      topicNotes: {
        create: jest.fn(({ data }) => {
          if (stored)
            throw new Prisma.PrismaClientKnownRequestError('duplicate', {
              code: 'P2002',
              clientVersion: 'test',
            });
          stored = { ...data, updatedAt: new Date('2026-09-25T10:00:00Z') };
          return Promise.resolve(stored);
        }),
        updateManyAndReturn: jest.fn(({ where, data }) => {
          if (!stored || stored.topicId !== where.topicId || stored.revision !== where.revision)
            return Promise.resolve([]);
          stored = {
            ...stored,
            body: data.body,
            revision: stored.revision + data.revision.increment,
          };
          return Promise.resolve([stored]);
        }),
      },
    };
    service = new TopicsService(prisma, {} as any);
  });

  it('starts empty and preserves exact learner text independently of the AI summary', async () => {
    expect(await service.getNotes('user-a', 'topic-a')).toEqual({
      body: '',
      revision: 0,
      updatedAt: null,
    });
    const saved = await service.saveNotes('user-a', 'topic-a', {
      body: '# My explanation\n\n  code\n',
      revision: 0,
    });
    expect(saved.body).toBe('# My explanation\n\n  code\n');
    expect(saved.revision).toBe(1);
    expect(await service.getNotes('user-a', 'topic-a')).toEqual(saved);
  });

  it('rejects stale first saves and stale edits without overwriting either device', async () => {
    await service.saveNotes('user-a', 'topic-a', { body: 'Device A', revision: 0 });
    await expect(
      service.saveNotes('user-a', 'topic-a', {
        body: 'Device B stale',
        revision: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.saveNotes('user-a', 'topic-a', {
      body: 'Device A updated',
      revision: 1,
    });
    await expect(
      service.saveNotes('user-a', 'topic-a', {
        body: 'Device B stale',
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await service.getNotes('user-a', 'topic-a')).body).toBe('Device A updated');
  });

  it('does not create a note for an unknown nonzero revision', async () => {
    await expect(
      service.saveNotes('user-a', 'topic-a', {
        body: 'stale deleted notes',
        revision: 2,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(stored).toBeNull();
  });

  it('hides another learner’s notes and rejects writes', async () => {
    await expect(service.getNotes('user-b', 'topic-a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.saveNotes('user-b', 'topic-a', {
        body: 'intrusion',
        revision: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(stored).toBeNull();
  });
});
