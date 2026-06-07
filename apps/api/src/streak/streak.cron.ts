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

  @Cron('5 0 * * *') // 00:05 daily — evaluate the day that just ended
  async evaluateYesterday() {
    const yesterday = new Date(Date.now() - 86_400_000);
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const u of users) await this.streak.evaluateDay(u.id, yesterday);
    this.logger.log(`Evaluated streak for ${users.length} users on ${yesterday.toDateString()}`);
  }
}
