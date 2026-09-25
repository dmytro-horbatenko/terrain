import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StreakService } from './streak.service';

describe('StreakService pure logic', () => {
  let service: StreakService;
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [StreakService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = mod.get(StreakService);
  });

  it('classifyDay', () => {
    expect(service.classifyDay({ loggedCount: 2, dueCount: 3, freezeBalance: 0 })).toBe('active');
    expect(service.classifyDay({ loggedCount: 0, dueCount: 0, freezeBalance: 0 })).toBe('quiet');
    expect(service.classifyDay({ loggedCount: 0, dueCount: 1, freezeBalance: 1 })).toBe('frozen');
    expect(service.classifyDay({ loggedCount: 0, dueCount: 1, freezeBalance: 0 })).toBe('break');
  });

  it('active day increments streak and earns a freeze at 5 active days (cap 2)', () => {
    const base = { currentStreak: 4, longestStreak: 4, freezeBalance: 0, activeDayCounter: 4 };
    const next = service.applyDay(base, 'active');
    expect(next.currentStreak).toBe(5);
    expect(next.longestStreak).toBe(5);
    expect(next.freezeBalance).toBe(1); // earned at 5th active day
    expect(next.activeDayCounter).toBe(0); // reset
  });

  it('freeze earning is capped at 2', () => {
    const base = { currentStreak: 9, longestStreak: 9, freezeBalance: 2, activeDayCounter: 4 };
    const next = service.applyDay(base, 'active');
    expect(next.freezeBalance).toBe(2);
    expect(next.activeDayCounter).toBe(0);
  });

  it('quiet day preserves and continues streak, no freeze change', () => {
    const next = service.applyDay(
      { currentStreak: 7, longestStreak: 10, freezeBalance: 1, activeDayCounter: 2 },
      'quiet',
    );
    expect(next.currentStreak).toBe(8);
    expect(next.freezeBalance).toBe(1);
    expect(next.activeDayCounter).toBe(2);
  });

  it('frozen day consumes a freeze and preserves streak', () => {
    const next = service.applyDay(
      { currentStreak: 7, longestStreak: 10, freezeBalance: 2, activeDayCounter: 2 },
      'frozen',
    );
    expect(next.currentStreak).toBe(7);
    expect(next.freezeBalance).toBe(1);
  });

  it('break resets streak to 0', () => {
    const next = service.applyDay(
      { currentStreak: 7, longestStreak: 10, freezeBalance: 0, activeDayCounter: 3 },
      'break',
    );
    expect(next.currentStreak).toBe(0);
    expect(next.longestStreak).toBe(10);
  });

  it("getState upserts the caller's per-user streak row", async () => {
    const upsert = jest.fn().mockResolvedValue({ userId: 'userA', currentStreak: 0 });
    const prisma: any = { streakState: { upsert } };
    const svc = new StreakService(prisma);
    await svc.getState('userA');
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'userA' },
      update: {},
      create: { userId: 'userA' },
    });
  });
});

describe('StreakService learner calendar', () => {
  let state: any;
  let logs: any[];
  let prisma: any;
  let service: StreakService;

  beforeEach(() => {
    state = {
      userId: 'userA',
      currentStreak: 4,
      longestStreak: 4,
      freezeBalance: 2,
      activeDayCounter: 4,
      lastEvaluatedDate: null,
    };
    logs = [];
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      settings: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Sofia', disabledDomains: [] }),
      },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ createdAt: new Date('2026-01-01T00:00:00Z') }),
      },
      streakState: {
        upsert: jest.fn(async () => ({ ...state })),
        update: jest.fn(async ({ data }) => Object.assign(state, data)),
      },
      dailyLog: {
        findFirst: jest.fn(
          async () => [...logs].sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null,
        ),
        findUnique: jest.fn(
          async ({ where }) => logs.find((log) => +log.date === +where.userId_date.date) ?? null,
        ),
        create: jest.fn(async ({ data }) => {
          logs.push(data);
          return data;
        }),
      },
      review: { count: jest.fn().mockResolvedValue(1) },
      topic: { count: jest.fn().mockResolvedValue(0) },
    };
    // Model the database transaction lock: concurrent calls observe committed state in order.
    let pending = Promise.resolve();
    prisma.$transaction = jest.fn((fn) => {
      const result = pending.then(() => fn(prisma));
      pending = result.catch(() => {});
      return result;
    });
    service = new StreakService(prisma);
  });

  it('evaluates only the completed learner day and stores its date, not its midnight instant', async () => {
    const now = new Date('2026-03-29T21:05:00Z'); // March 30 locally, after the 23-hour day
    await service.evaluateCompletedDays('userA', now);
    expect(logs).toEqual([
      { userId: 'userA', date: new Date('2026-03-29T00:00:00Z'), dayType: 'active' },
    ]);
    expect(prisma.review.count).toHaveBeenCalledWith({
      where: {
        userId: 'userA',
        reviewedAt: { gte: new Date('2026-03-28T22:00:00Z'), lt: new Date('2026-03-29T21:00:00Z') },
      },
    });
    expect(state.currentStreak).toBe(5);
    expect(state.lastEvaluatedDate).toEqual(new Date('2026-03-29T00:00:00Z'));
  });

  it('does not recount completed dates when repeated concurrently or after a timezone move backward', async () => {
    await Promise.all([
      service.evaluateCompletedDays('userA', new Date('2026-09-25T21:05:00Z')),
      service.evaluateCompletedDays('userA', new Date('2026-09-25T21:05:00Z')),
    ]);
    prisma.settings.findUnique.mockResolvedValue({ timezone: 'America/Los_Angeles' });
    await service.evaluateCompletedDays('userA', new Date('2026-09-25T21:10:00Z'));
    expect(logs).toHaveLength(1);
    expect(state.currentStreak).toBe(5);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('keeps old log dates and totals and catches up only later dates after moving forward', async () => {
    logs.push({ userId: 'userA', date: new Date('2026-09-23T00:00:00Z'), dayType: 'active' });
    prisma.settings.findUnique.mockResolvedValue({ timezone: 'Pacific/Kiritimati' });
    await service.evaluateCompletedDays('userA', new Date('2026-09-25T12:00:00Z'));
    expect(logs.map((log) => log.date.toISOString().slice(0, 10))).toEqual([
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
    expect(state.currentStreak).toBe(6);
  });

  it('never awards a completed day from before signup', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      createdAt: new Date('2026-09-25T12:00:00Z'),
    });
    await service.evaluateCompletedDays('userA', new Date('2026-09-25T13:00:00Z'));
    expect(logs).toEqual([]);
    expect(state.currentStreak).toBe(4);
  });

  it('spends one freeze for the learner date and cron does not spend it again', async () => {
    const now = new Date('2026-09-25T21:05:00Z');
    const results = await Promise.allSettled([
      service.skipToday('userA', now),
      service.skipToday('userA', now),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(logs.find((log) => log.dayType === 'frozen')).toMatchObject({
      date: new Date('2026-09-26T00:00:00Z'),
      dayType: 'frozen',
    });
    await service.evaluateCompletedDays('userA', new Date('2026-09-26T21:05:00Z'));
    expect(state.freezeBalance).toBe(1);
    expect(state.currentStreak).toBe(5);
    expect(logs).toHaveLength(2);
  });

  it('settles yesterday before allowing a freeze spend after local midnight', async () => {
    state.lastEvaluatedDate = new Date('2026-09-24T00:00:00Z');
    state.freezeBalance = 1;
    prisma.review.count.mockResolvedValue(0);
    prisma.topic.count.mockResolvedValue(1);
    await expect(service.skipToday('userA', new Date('2026-09-25T21:01:00Z'))).rejects.toThrow(
      'No freezes left',
    );
    expect(logs).toEqual([
      { userId: 'userA', date: new Date('2026-09-25T00:00:00Z'), dayType: 'frozen' },
    ]);
    expect(state.freezeBalance).toBe(0);
  });

  it('bounds catch-up work per transaction without jumping over unfinished dates', async () => {
    state.lastEvaluatedDate = new Date('2026-01-01T00:00:00Z');
    await service.evaluateCompletedDays('userA', new Date('2026-09-25T12:00:00Z'));
    expect(logs).toHaveLength(7);
    expect(state.lastEvaluatedDate).toEqual(new Date('2026-01-08T00:00:00Z'));
  });

  it('does not spend today’s freeze while an older catch-up batch is still unfinished', async () => {
    state.lastEvaluatedDate = new Date('2026-01-01T00:00:00Z');
    await expect(service.skipToday('userA', new Date('2026-09-25T12:00:00Z'))).rejects.toThrow(
      'catching up',
    );
    expect(logs.some((log) => log.dayType === 'frozen')).toBe(false);
  });
});
