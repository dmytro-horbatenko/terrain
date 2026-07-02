import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Settings } from '@prisma/client';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { StreakService } from '../streak/streak.service';
import { composeDigest, composeNudge, estimateMinutes } from './telegram.messages';
import { TelegramService } from './telegram.service';
import { localDayStart, localHour } from './telegram.time';

@Injectable()
export class TelegramCron {
  private readonly logger = new Logger(TelegramCron.name);

  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private metrics: MetricsService,
    private streak: StreakService,
  ) {}

  @Cron('0 * * * *') // every hour on the hour
  async hourly(): Promise<void> {
    await this.tick(new Date());
  }

  /** Exposed with an injectable `now` for tests and manual smoke runs. */
  async tick(now: Date): Promise<void> {
    if (!this.telegram.isConfigured()) return;
    const rows = await this.prisma.settings.findMany({
      where: { telegramChatId: { not: null } },
    });
    for (const s of rows) {
      try {
        const hour = localHour(now, s.timezone);
        if (s.digestHour !== null && hour === s.digestHour) await this.sendDigest(s, now);
        if (s.nudgeHour !== null && hour === s.nudgeHour) await this.maybeSendNudge(s, now);
      } catch (e) {
        this.logger.error(`Telegram tick failed for user ${s.userId}: ${e}`);
      }
    }
  }

  private webUrl(): string {
    return process.env.WEB_BASE_URL ?? 'http://localhost:5180';
  }

  private async sendDigest(s: Settings, now: Date): Promise<void> {
    const [cards, due, streakState, nextUp] = await Promise.all([
      this.metrics.dueCards(s.userId, now),
      this.metrics.dueTopics(s.userId, now),
      this.streak.getState(s.userId),
      this.metrics.nextUp(s.userId),
    ]);
    const byKind = (k: string) => cards.filter((c) => c.promptKind === k).length;
    const html = composeDigest({
      date: now,
      timezone: s.timezone,
      dueByKind: { concept: byKind('concept'), code: byKind('code'), problem: byKind('problem') },
      dueCount: cards.length,
      estMinutes: estimateMinutes(cards),
      overdueTopics: due.overdue.length,
      streak: streakState.currentStreak,
      nextUpTitle: nextUp?.topic.title ?? null,
    });
    await this.telegram.sendTo(s.userId, s.telegramChatId!, html, {
      text: 'Start review',
      url: this.webUrl(),
    });
  }

  /** Streak-at-risk nudge: only when today (user-local) has zero reviews AND cards are due. */
  private async maybeSendNudge(s: Settings, now: Date): Promise<void> {
    const dayStart = localDayStart(now, s.timezone);
    const reviewsToday = await this.prisma.review.count({
      where: { userId: s.userId, reviewedAt: { gte: dayStart } },
    });
    if (reviewsToday > 0) return;
    const cards = await this.metrics.dueCards(s.userId, now);
    if (cards.length === 0) return;
    const streakState = await this.streak.getState(s.userId);
    const html = composeNudge({
      streak: streakState.currentStreak,
      dueCount: cards.length,
      estMinutes: estimateMinutes(cards),
    });
    await this.telegram.sendTo(s.userId, s.telegramChatId!, html, {
      text: 'Review now',
      url: this.webUrl(),
    });
  }
}
