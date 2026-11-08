import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PracticeService } from './practice.service';
import { PrismaService } from '../prisma/prisma.service';

const input = {
  version: 1,
  id: '00000000-0000-4000-8000-000000000001',
  topicId: '00000000-0000-4000-8000-000000000002',
  expectedRevision: 0,
  status: 'active',
  goal: 'Build RLP',
  acceptance: '',
  artifact: '',
  artifactVersion: '',
  backupUrl: '',
  command: '',
  result: '',
  reflection: '',
  nextAction: 'Check prefix boundaries',
  assistance: 'unrecorded',
  acceptanceMet: false,
};

describe('PracticeService', () => {
  let db: any;
  let service: PracticeService;
  beforeEach(() => {
    db = {
      $executeRaw: jest.fn(),
      topic: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: input.topicId, status: 'active', children: [] }),
        findMany: jest.fn(),
      },
      settings: { findUnique: jest.fn().mockResolvedValue(null) },
      practiceProgress: {
        upsert: jest.fn().mockResolvedValue({ id: 'progress' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      practiceCheckpoint: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Intentionally no review, topic.update, appEvent or skillCheck writers.
    };
    db.$transaction = (fn: any) => fn(db);
    service = new PracticeService(db as PrismaService);
  });
  it('saves an owned partial attempt and leaves study evidence unchanged', async () => {
    await expect(service.save('alice', input)).resolves.toEqual({ alreadySaved: false });
    expect(db.topic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: input.topicId, userId: 'alice' } }),
    );
    expect(db.practiceProgress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'progress', userId: 'alice', revision: 0 } }),
    );
    expect(db.practiceCheckpoint.create).toHaveBeenCalledWith({
      data: {
        id: input.id,
        progressId: 'progress',
        revision: 1,
        status: 'active',
        snapshot: input,
      },
    });
  });
  it('rejects cross-user topics and chapter containers', async () => {
    db.topic.findFirst.mockResolvedValue(null);
    await expect(service.save('bob', input)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.practiceProgress.upsert).not.toHaveBeenCalled();
    db.topic.findFirst.mockResolvedValue({ status: 'active', children: [{ id: 'child' }] });
    await expect(service.save('alice', input)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('makes retries idempotent and rejects altered identities and stale revisions', async () => {
    db.practiceCheckpoint.findFirst.mockResolvedValue({ snapshot: input });
    await expect(service.save('alice', input)).resolves.toEqual({ alreadySaved: true });
    expect(db.practiceCheckpoint.create).not.toHaveBeenCalled();
    await expect(service.save('alice', { ...input, result: 'Different' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    db.practiceCheckpoint.findFirst.mockResolvedValue(null);
    db.practiceProgress.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save('alice', input)).rejects.toBeInstanceOf(ConflictException);
    expect(db.practiceCheckpoint.create).not.toHaveBeenCalled();
  });
  it('never certifies an empty reference', async () => {
    await expect(service.save('alice', { ...input, status: 'reference' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.topic.findFirst).not.toHaveBeenCalled();
  });
  it('includes all available leaves, preserves blocked future lessons and scopes queries to the owner', async () => {
    const base = {
      domain: 'Web3',
      description: null,
      aiContext: 'Build a small implementation',
      prerequisites: [],
    };
    db.topic.findMany.mockResolvedValue([
      { ...base, id: 'chapter', parentId: null, title: 'Chapter', status: 'active' },
      { ...base, id: 'studied', parentId: 'chapter', title: 'Studied', status: 'active' },
      { ...base, id: 'next', parentId: 'chapter', title: 'Next', status: 'planned' },
      {
        ...base,
        id: 'blocked',
        parentId: 'chapter',
        title: 'Blocked',
        status: 'planned',
        prerequisites: [{ prerequisiteId: 'next' }],
      },
      { ...base, id: 'archived', parentId: null, title: 'Archived', status: 'archived' },
    ]);
    const result = await service.overview('alice');
    expect(result.lessons.map((l) => [l.id, l.eligible])).toEqual([
      ['studied', true],
      ['next', true],
      ['blocked', false],
    ]);
    expect(db.practiceProgress.findMany.mock.calls[0][0].where).toEqual({ userId: 'alice' });
    expect(db.practiceCheckpoint.findMany.mock.calls[0][0].where.progress).toEqual({
      userId: 'alice',
    });
  });
  it('does not reveal another user’s history', async () => {
    db.topic.findFirst.mockResolvedValue(null);
    await expect(service.history('bob', input.topicId)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.practiceCheckpoint.findMany).not.toHaveBeenCalled();
  });
});
