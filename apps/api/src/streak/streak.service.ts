import { ConflictException, Injectable } from '@nestjs/common';
import { DayType, type StreakState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;
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

  private dayBounds(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }

  async getState(userId: string): Promise<StreakState> {
    return this.prisma.streakState.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async evaluateDay(userId: string, date: Date): Promise<void> {
    const { start, end } = this.dayBounds(date);
    const existing = await this.prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: start } },
    });
    if (existing) return; // idempotent: already evaluated or skipped

    const loggedCount = await this.prisma.review.count({
      where: { userId, reviewedAt: { gte: start, lt: end } },
    });
    const dueCount = await this.prisma.topic.count({
      where: { userId, status: 'active', nextReviewAt: { not: null, lt: end } },
    });
    const state = await this.getState(userId);
    const dayType = this.classifyDay({ loggedCount, dueCount, freezeBalance: state.freezeBalance });
    const next = this.applyDay(state, dayType);

    await this.prisma.$transaction([
      this.prisma.dailyLog.create({ data: { userId, date: start, dayType } }),
      this.prisma.streakState.update({ where: { userId }, data: next }),
    ]);
  }

  async skipToday(userId: string, now: Date): Promise<{ freezeBalance: number }> {
    const { start } = this.dayBounds(now);
    const existing = await this.prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: start } },
    });
    if (existing) throw new ConflictException('Today is already logged.');
    const state = await this.getState(userId);
    if (state.freezeBalance <= 0) throw new ConflictException('No freezes left to skip today.');
    const [, updated] = await this.prisma.$transaction([
      this.prisma.dailyLog.create({ data: { userId, date: start, dayType: DayType.frozen } }),
      this.prisma.streakState.update({
        where: { userId },
        data: { freezeBalance: state.freezeBalance - 1 },
      }),
    ]);
    return { freezeBalance: updated.freezeBalance };
  }
}
