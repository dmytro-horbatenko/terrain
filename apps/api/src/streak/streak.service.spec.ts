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
