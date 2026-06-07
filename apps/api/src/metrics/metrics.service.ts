import { Injectable } from '@nestjs/common';
import type { Topic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

/** Local-time YYYY-MM-DD key (matches the streak engine's local day bounds). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class MetricsService {
  constructor(private prisma: PrismaService) {}

  topicLabels(input: { status: string; repetitions: number; prerequisiteStatuses: string[] }): {
    blocked: boolean;
    reviewing: boolean;
  } {
    const blocked =
      input.status === 'planned' && input.prerequisiteStatuses.some((s) => s !== 'mastered');
    const reviewing = input.status === 'active' && input.repetitions > 0;
    return { blocked, reviewing };
  }

  masteryStatus(input: {
    interval: number;
    appEventCount: number;
    noteRef: string | null;
    summary: string | null;
  }) {
    const retention = input.interval >= 30;
    const application = input.appEventCount >= 1;
    const teaching = input.noteRef != null || input.summary != null;
    return { retention, application, teaching, eligible: retention && application && teaching };
  }

  async struggleRatio7d(userId: string, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const reviews = await this.prisma.review.findMany({
      where: { userId, reviewedAt: { gte: cutoff } },
      select: { quality: true },
    });
    if (reviews.length === 0) return 0;
    const poor = reviews.filter((r) => r.quality <= 2).length;
    return poor / reviews.length;
  }

  /**
   * Dense reviews-per-day series over the trailing `days` window (inclusive of
   * today), oldest first. Days with no reviews are emitted with count 0 so the
   * web heatmap can render a continuous calendar grid.
   */
  async heatmap(userId: string, now: Date, days = 182): Promise<{ date: string; count: number }[]> {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const reviews = await this.prisma.review.findMany({
      where: { userId, reviewedAt: { gte: start } },
      select: { reviewedAt: true },
    });

    const counts = new Map<string, number>();
    for (const r of reviews) {
      const key = localDateKey(r.reviewedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const series: { date: string; count: number }[] = [];
    const cursor = new Date(start);
    for (let i = 0; i < days; i++) {
      const key = localDateKey(cursor);
      series.push({ date: key, count: counts.get(key) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    return series;
  }

  async dueTopics(
    userId: string,
    now: Date,
    domain?: string,
  ): Promise<{ overdue: Topic[]; dueToday: Topic[] }> {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    const active = await this.prisma.topic.findMany({
      where: {
        userId,
        status: 'active',
        nextReviewAt: { not: null, lt: endOfToday },
        ...(domain ? { domain } : {}),
      },
      orderBy: { nextReviewAt: 'asc' },
    });
    const overdue = active.filter((t) => t.nextReviewAt! < startOfToday);
    const dueToday = active.filter((t) => t.nextReviewAt! >= startOfToday);
    return { overdue, dueToday };
  }

  async dashboard(userId: string, now: Date, domain?: string) {
    const [struggleRatio7d, due, grouped] = await Promise.all([
      this.struggleRatio7d(userId, now),
      this.dueTopics(userId, now, domain),
      this.prisma.topic.groupBy({
        by: ['status'],
        _count: true,
        where: { userId, ...(domain ? { domain } : {}) },
      }),
    ]);
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count ?? 0;
    return {
      generatedAt: now.toISOString(),
      struggleRatio7d,
      due,
      counts: {
        total: grouped.reduce((sum, g) => sum + g._count, 0),
        planned: countOf('planned'),
        active: countOf('active'),
        mastered: countOf('mastered'),
        archived: countOf('archived'),
        dueToday: due.dueToday.length,
        overdue: due.overdue.length,
      },
    };
  }
}
