import { BadRequestException, ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ProductCurriculum, ProjectCheckpointInput } from '@terrain/types';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { CONTENT_DIR } from '../courses/content-dir';

const catalog = JSON.parse(
  readFileSync(join(CONTENT_DIR, 'projects/web3-products.json'), 'utf8'),
) as ProductCurriculum;
const input: ProjectCheckpointInput = {
  id: '9ddc8b31-8d49-4aad-b6ac-887095d3bb88',
  curriculumVersion: catalog.version,
  projectId: 'wallet-console',
  milestoneId: 'w1',
  expectedRevision: 0,
  status: 'active',
  repositoryUrl: '',
  notes: 'Started the account workspace',
  evidence: '',
  reflection: '',
  nextAction: 'Test switching chain during an RPC request',
  assistance: 'hints',
  checkedCriteria: [],
};

function setup() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    projectCheckpoint: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    projectProgress: {
      upsert: jest.fn().mockResolvedValue({ id: 'progress-1', revision: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    projectProgress: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new ProjectsService(prisma as unknown as PrismaService), prisma, tx };
}

describe('project checkpoints', () => {
  it('saves only under the authenticated owner, with a revision and an append-only checkpoint', async () => {
    const { service, tx } = setup();
    expect(await service.save('alice', input)).toEqual({ alreadySaved: false });
    expect(tx.projectProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_projectKey: { userId: 'alice', projectKey: 'wallet-console' } },
      }),
    );
    expect(tx.projectProgress.updateMany).toHaveBeenCalledWith({
      where: { id: 'progress-1', userId: 'alice', revision: 0 },
      data: { revision: { increment: 1 }, repositoryUrl: '' },
    });
    expect(tx.projectCheckpoint.create).toHaveBeenCalledWith({
      data: {
        id: input.id,
        projectProgressId: 'progress-1',
        milestoneKey: 'w1',
        revision: 1,
        snapshot: input,
      },
    });
  });

  it('rejects an older session without creating an evidence record', async () => {
    const { service, tx } = setup();
    tx.projectProgress.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save('alice', input)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectCheckpoint.create).not.toHaveBeenCalled();
  });

  it('returns an identical retry safely but rejects changes to a saved identity', async () => {
    const { service, tx } = setup();
    tx.projectCheckpoint.findFirst.mockResolvedValue({ snapshot: input });
    expect(await service.save('alice', input)).toEqual({ alreadySaved: true });
    expect(tx.projectProgress.upsert).not.toHaveBeenCalled();
    expect(tx.projectCheckpoint.findFirst).toHaveBeenCalledWith({
      where: { id: input.id, projectProgress: { userId: 'alice', projectKey: 'wallet-console' } },
    });
    await expect(service.save('alice', { ...input, notes: 'changed' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('validates completion before any database work', async () => {
    const { service, prisma } = setup();
    await expect(service.save('alice', { ...input, status: 'completed' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reads only this learner’s latest milestone snapshots in revision order', async () => {
    const { service, prisma } = setup();
    expect(await service.list('bob')).toEqual([]);
    expect(prisma.projectProgress.findMany).toHaveBeenCalledWith({
      where: { userId: 'bob' },
      include: { checkpoints: { distinct: ['milestoneKey'], orderBy: { revision: 'desc' } } },
    });
  });
});
