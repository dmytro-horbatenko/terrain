import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { StreakService } from './streak.service';

@Injectable()
export class StreakCron {
  private readonly logger = new Logger(StreakCron.name);
  constructor(
    private streak: StreakService,
    private prisma: PrismaService,
  ) {}

  @Cron('5,20,35,50 * * * *') // Every 15 minutes, including fractional-hour learner timezones.
  async evaluateYesterday(now = new Date()) {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const u of users) {
      try {
        await this.streak.evaluateCompletedDays(u.id, now);
      } catch (error) {
        this.logger.error(`Review streak evaluation failed for user ${u.id}: ${error}`);
      }
    }
  }
}
