import { ConflictException, Injectable } from '@nestjs/common';
import { DayType, type Prisma, type StreakState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { localDateKey, localDateStart, shiftDateKey } from '../telegram/telegram.time';

const FREEZE_CAP = 2;
const ACTIVE_DAYS_PER_FREEZE = 5;

type StreakCore = Pick<
  StreakState,
  'currentStreak' | 'longestStreak' | 'freezeBalance' | 'activeDayCounter'
>;

@Injectable()
export class StreakService {
  constructor(private prisma: PrismaService) {}

  classifyDay(input: { loggedCount: number; dueCount: number; freezeBalance: number }): DayType {
    if (input.loggedCount > 0) return DayType.active;
    if (input.dueCount === 0) return DayType.quiet;
    if (input.freezeBalance > 0) return DayType.frozen;
    return DayType.break;
  }

  applyDay(state: StreakCore, dayType: DayType): StreakCore {
    let { currentStreak, longestStreak, freezeBalance, activeDayCounter } = state;
    switch (dayType) {
      case DayType.active: {
        currentStreak += 1;
        activeDayCounter += 1;
        if (activeDayCounter >= ACTIVE_DAYS_PER_FREEZE) {
          activeDayCounter = 0;
          freezeBalance = Math.min(FREEZE_CAP, freezeBalance + 1);
        }
        break;
      }
      case DayType.quiet:
        currentStreak += 1;
        break;
      case DayType.frozen:
        freezeBalance = Math.max(0, freezeBalance - 1);
        break;
      case DayType.break:
        currentStreak = 0;
        break;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
    return { currentStreak, longestStreak, freezeBalance, activeDayCounter };
  }

  async getState(userId: string): Promise<StreakState> {
    return this.prisma.streakState.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  private withUserLock<T>(userId: string, run: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`streak:${userId}`}, 0))`;
      return run(tx);
    });
  }

  async evaluateCompletedDays(userId: string, now: Date): Promise<void> {
    await this.withUserLock(userId, async (tx) => {
      const settings = await tx.settings.findUnique({ where: { userId } });
      const timezone = settings?.timezone ?? 'UTC';
      const lastComplete = shiftDateKey(localDateKey(now, timezone), -1);
      let state = await tx.streakState.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
      let cursor = state.lastEvaluatedDate?.toISOString().slice(0, 10);
      if (!cursor) {
        // Legacy @db.Date logs have already affected the totals. Preserve their
        // stored labels; their original server timezone cannot be recovered.
        const latest = await tx.dailyLog.findFirst({
          where: { userId },
          orderBy: { date: 'desc' },
        });
        cursor = latest?.date.toISOString().slice(0, 10) ?? shiftDateKey(lastComplete, -1);
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { createdAt: true },
      });
      const firstDay = localDateKey(user.createdAt, timezone);
      // ponytail: catch up at most seven days per tick; subsequent ticks resume
      // from the cursor so a long outage does not hold a database lock unboundedly.
      for (
        let i = 0, key = shiftDateKey(cursor, 1);
        i < 7 && key <= lastComplete;
        i++, key = shiftDateKey(key, 1)
      ) {
        const date = new Date(`${key}T00:00:00Z`); // @db.Date is a label, not the local midnight instant.
        const existing = await tx.dailyLog.findUnique({ where: { userId_date: { userId, date } } });
        const start = localDateStart(key, timezone);
        const end = localDateStart(shiftDateKey(key, 1), timezone);
        if (!existing && key >= firstDay && start < end) {
          const loggedCount = await tx.review.count({
            where: { userId, reviewedAt: { gte: start, lt: end } },
          });
          // Preserve the review-habit policy. Historical due snapshots do not
          // exist, so overdue catch-up uses the current topic schedule.
          const dueCount = await tx.topic.count({
            where: {
              userId,
              status: 'active',
              createdAt: { lt: end },
              nextReviewAt: { not: null, lt: end },
              ...(settings?.disabledDomains?.length
                ? { domain: { notIn: settings.disabledDomains } }
                : {}),
            },
          });
          const dayType = this.classifyDay({
            loggedCount,
            dueCount,
            freezeBalance: state.freezeBalance,
          });
          await tx.dailyLog.create({ data: { userId, date, dayType } });
          state = { ...state, ...this.applyDay(state, dayType) };
        }
        cursor = key;
      }
      await tx.streakState.update({
        where: { userId },
        data: {
          currentStreak: state.currentStreak,
          longestStreak: state.longestStreak,
          freezeBalance: state.freezeBalance,
          activeDayCounter: state.activeDayCounter,
          lastEvaluatedDate: new Date(`${cursor}T00:00:00Z`),
        },
      });
    });
  }

  async skipToday(userId: string, now: Date): Promise<{ freezeBalance: number }> {
    await this.evaluateCompletedDays(userId, now);
    return this.withUserLock(userId, async (tx) => {
      const settings = await tx.settings.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      const date = new Date(`${localDateKey(now, settings?.timezone ?? 'UTC')}T00:00:00Z`);
      const existing = await tx.dailyLog.findUnique({ where: { userId_date: { userId, date } } });
      if (existing) throw new ConflictException('Today is already logged.');
      const state = await tx.streakState.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
      if (state.lastEvaluatedDate && date <= state.lastEvaluatedDate)
        throw new ConflictException('Today is already evaluated.');
      const yesterday = new Date(`${shiftDateKey(date.toISOString().slice(0, 10), -1)}T00:00:00Z`);
      if (!state.lastEvaluatedDate || state.lastEvaluatedDate < yesterday)
        throw new ConflictException('Review streak is catching up. Try again shortly.');
      if (state.freezeBalance <= 0) throw new ConflictException('No freezes left to skip today.');
      await tx.dailyLog.create({ data: { userId, date, dayType: DayType.frozen } });
      const updated = await tx.streakState.update({
        where: { userId },
        data: { freezeBalance: state.freezeBalance - 1 },
      });
      return { freezeBalance: updated.freezeBalance };
    });
  }
}
