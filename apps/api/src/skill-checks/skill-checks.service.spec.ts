import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type SkillCheck as Row } from '@prisma/client';
import type { SkillCheckAttempt, SkillCheckPlan, SkillCheckResult } from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { SkillChecksService } from './skill-checks.service';

const plan: SkillCheckPlan = {
  id: '00000000-0000-4000-8000-000000000001',
  target: { kind: 'topic', topicId: '00000000-0000-4000-8000-000000000002' },
  kind: 'diagnosis',
  learnedOn: '2026-09-02',
  dueOn: '2026-09-03',
  task: 'Diagnose an out-of-order balance response after switching the active wallet account.',
  successCriteria:
    'Identify the incorrect identity and verify a regression with delayed responses.',
  allowedTools: 'documentation',
};
const attempt: SkillCheckAttempt = {
  firstAttempt:
    'I traced both account identities and reproduced the delayed request overwriting state.',
  evidence: 'The regression fails before the request identity guard and passes with the guard.',
  assistance: 'documentation',
  helpDetails: 'Read the React effect cleanup documentation.',
};
const result: SkillCheckResult = {
  outcome: 'passed',
  feedback: 'The supplied trace and regression demonstrate both stated criteria.',
  nextAction: 'Revisit cancellation during a network switch.',
  reviewer: 'self',
};

function setup() {
  const rows = new Map<string, Row>();
  const prisma = {
    settings: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Warsaw' }) },
    topic: { findFirst: jest.fn().mockResolvedValue({ title: 'Wallet state' }) },
    skillCheck: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = rows.get(where.id);
        return row?.userId === where.userId ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...rows.values()].filter((r) => r.userId === where.userId),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (rows.has(data.id))
          throw new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '7',
          });
        const row = {
          topicId: null,
          projectKey: null,
          milestoneKey: null,
          attempt: null,
          attemptedAt: null,
          result: null,
          assessedAt: null,
          cancelledAt: null,
          createdAt: new Date(),
          ...data,
        } as Row;
        rows.set(row.id, row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.id);
        if (
          !row ||
          row.userId !== where.userId ||
          row.cancelledAt ||
          (where.attemptedAt === null && row.attemptedAt) ||
          (where.attemptedAt?.not === null && !row.attemptedAt) ||
          (where.assessedAt === null && row.assessedAt)
        )
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  return { service: new SkillChecksService(prisma as unknown as PrismaService), prisma, rows };
}

describe('skill check lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-03T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('schedules under the authenticated owner without claiming an attempt or touching learning progress', async () => {
    const { service, prisma, rows } = setup();
    await service.create('alice', plan);
    expect(prisma.topic.findFirst).toHaveBeenCalledWith({
      where: { id: plan.target.kind === 'topic' && plan.target.topicId, userId: 'alice' },
      select: { title: true },
    });
    expect(rows.get(plan.id)).toMatchObject({ userId: 'alice', attempt: null, result: null });
    expect(await service.list('bob')).toMatchObject({ checks: [] });
    expect(await service.list('alice')).toMatchObject({
      today: '2026-09-03',
      timezone: 'Europe/Warsaw',
      checks: [{ plan, attempt: null, result: null }],
    });
  });

  it('requires an owned topic or known milestone', async () => {
    const { service, prisma, rows } = setup();
    prisma.topic.findFirst.mockResolvedValue(null);
    await expect(service.create('alice', plan)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.create('alice', {
        ...plan,
        target: { kind: 'milestone', projectId: 'wallet-console', milestoneId: 'missing' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.size).toBe(0);
    await service.create('alice', {
      ...plan,
      target: { kind: 'milestone', projectId: 'wallet-console', milestoneId: 'w1' },
    });
    expect(rows.get(plan.id)).toMatchObject({
      topicId: null,
      projectKey: 'wallet-console',
      milestoneKey: 'w1',
    });
  });

  it('validates dates and rejects client-supplied ownership', async () => {
    const { service, rows } = setup();
    for (const invalid of [
      { userId: 'bob' },
      { learnedOn: '2026-09-04', dueOn: '2026-09-11' },
      { learnedOn: '2026-09-01', dueOn: '2026-09-02' },
      { dueOn: '2026-09-02' },
    ])
      await expect(service.create('alice', { ...plan, ...invalid })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    expect(rows.size).toBe(0);
  });

  it('makes create retries idempotent, including races, and never reassigns identities across users', async () => {
    const { service, rows } = setup();
    const saves = await Promise.all([service.create('alice', plan), service.create('alice', plan)]);
    expect(saves.map((s) => s.alreadySaved).sort()).toEqual([false, true]);
    await expect(
      service.create('alice', { ...plan, task: 'Different but long enough task for a new check.' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create('bob', plan)).rejects.toBeInstanceOf(ConflictException);
    expect(rows.size).toBe(1);
    expect(rows.get(plan.id)?.userId).toBe('alice');
  });

  it('rejects feedback before an attempt and preserves the first attempt on corrections and concurrent saves', async () => {
    const { service, rows } = setup();
    await service.create('alice', plan);
    await expect(service.assess('alice', plan.id, result)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const conflicting = {
      ...attempt,
      firstAttempt: 'A different attempt that should not replace the original.',
    };
    const saves = await Promise.allSettled([
      service.attempt('alice', plan.id, attempt),
      service.attempt('alice', plan.id, conflicting),
    ]);
    expect(saves.map((s) => s.status)).toEqual(['fulfilled', 'rejected']);
    expect(rows.get(plan.id)?.attempt).toEqual(attempt);
    expect(await service.attempt('alice', plan.id, attempt)).toEqual({ alreadySaved: true });
    await expect(service.attempt('alice', plan.id, conflicting)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await service.assess('alice', plan.id, result);
    expect(rows.get(plan.id)).toMatchObject({ attempt, result });
    expect(await service.assess('alice', plan.id, result)).toEqual({ alreadySaved: true });
    await expect(
      service.assess('alice', plan.id, { ...result, outcome: 'needs_practice' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['none', 'documentation', 'hints', 'solution'] as const)(
    'applies the agreed help policy to %s assistance',
    async (assistance) => {
      const { service } = setup();
      await service.create('alice', plan);
      await service.attempt('alice', plan.id, { ...attempt, assistance });
      if (assistance === 'none' || assistance === 'documentation')
        await expect(service.assess('alice', plan.id, result)).resolves.toBeDefined();
      else {
        await expect(service.assess('alice', plan.id, result)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        await expect(
          service.assess('alice', plan.id, { ...result, outcome: 'needs_practice' }),
        ).resolves.toBeDefined();
      }
    },
  );

  it('distinguishes documentation-assisted engineering from closed-book recall', async () => {
    const { service } = setup();
    await service.create('alice', { ...plan, allowedTools: 'closed_book' });
    await service.attempt('alice', plan.id, attempt);
    await expect(service.assess('alice', plan.id, result)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses the learner’s calendar at midnight and refuses an early attempt', async () => {
    const { service } = setup();
    await service.create('alice', { ...plan, dueOn: '2026-09-04' });
    await expect(service.attempt('alice', plan.id, attempt)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    jest.setSystemTime(new Date('2026-09-03T22:05:00Z'));
    expect((await service.list('alice')).today).toBe('2026-09-04');
    await expect(service.attempt('alice', plan.id, attempt)).resolves.toBeDefined();
  });

  it('enforces ownership on every transition and cancels only unattempted work', async () => {
    const { service, rows } = setup();
    await service.create('alice', plan);
    await expect(service.attempt('bob', plan.id, attempt)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.assess('bob', plan.id, result)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancel('bob', plan.id)).rejects.toBeInstanceOf(NotFoundException);
    await service.cancel('alice', plan.id);
    expect(await service.cancel('alice', plan.id)).toEqual({ alreadySaved: true });
    await expect(service.attempt('alice', plan.id, attempt)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rows.get(plan.id)).toMatchObject({ attempt: null, result: null });
    const next = { ...plan, id: '00000000-0000-4000-8000-000000000003' };
    await service.create('alice', next);
    await service.attempt('alice', next.id, attempt);
    await expect(service.cancel('alice', next.id)).rejects.toBeInstanceOf(ConflictException);
  });
});
