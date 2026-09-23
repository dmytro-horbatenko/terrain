import { Injectable } from '@nestjs/common';
import type { Prompt, Topic } from '@prisma/client';
import type { LearningApproach } from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { LearningContextService } from '../learning/learning-context.service';
import { estimateMinutes } from '../telegram/telegram.messages';
import { localDayStart } from '../telegram/telegram.time';
import {
  completedReview,
  readReviewSnapshot,
  selectReviewQueue,
  type ReviewCard,
  type ReviewOptions,
  type ReviewQueue,
  type ReviewSnapshot,
} from './review-queue';

const DAY_MS = 86_400_000;

export interface NextUp {
  topic: Topic;
  chapterTitle: string | null;
  chapterProgress: { started: number; total: number } | null;
  sourcePlanStats: { requiredCount: number; estimatedMinutes: number; hasExpired: boolean };
}

/** Local-time YYYY-MM-DD key (matches the streak engine's local day bounds). */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class MetricsService {
  constructor(
    private prisma: PrismaService,
    private learning: LearningContextService,
  ) {}

  private async disabledDomains(userId: string): Promise<string[]> {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { disabledDomains: true },
    });
    return settings?.disabledDomains ?? [];
  }

  private domainFilter(
    domain: string | undefined,
    disabledDomains: string[],
  ): { domain?: string | { notIn: string[] } } {
    if (domain) return { domain };
    return disabledDomains.length ? { domain: { notIn: disabledDomains } } : {};
  }

  topicLabels(input: { status: string; cards: { reps: number }[]; blocked: boolean }): {
    blocked: boolean;
    reviewing: boolean;
  } {
    const blocked = input.status === 'planned' && input.blocked;
    const reviewing = input.status === 'active' && input.cards.some((c) => c.reps > 0);
    return { blocked, reviewing };
  }

  masteryStatus(input: {
    cards: { stability: number | null; suspended: boolean }[];
    appEventCount: number;
    noteRef: string | null;
    summary: string | null;
  }) {
    const activeCards = input.cards.filter((c) => !c.suspended);
    const retention =
      input.cards.length > 0 &&
      activeCards.length > 0 &&
      Math.min(...activeCards.map((c) => c.stability ?? -Infinity)) >= 30;
    const application = input.appEventCount >= 1;
    const teaching = !!(input.noteRef?.trim() || input.summary?.trim());
    return { retention, application, teaching, eligible: retention && application && teaching };
  }

  async reviewStats7d(userId: string, now: Date) {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const reviews = await this.prisma.review.findMany({
      where: { userId, reviewedAt: { gte: cutoff, lte: now } },
      select: { grade: true },
    });
    const total = reviews.length;
    const again = reviews.filter((r) => r.grade === 'again').length;
    return { total, again, againRatio: total ? again / total : null };
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
    const disabled = await this.disabledDomains(userId);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    const active = await this.prisma.topic.findMany({
      where: {
        userId,
        status: 'active',
        nextReviewAt: { not: null, lt: endOfToday },
        ...this.domainFilter(domain, disabled),
      },
      orderBy: { nextReviewAt: 'asc' },
    });
    const overdue = active.filter((t) => t.nextReviewAt! < startOfToday);
    const dueToday = active.filter((t) => t.nextReviewAt! >= startOfToday);
    return { overdue, dueToday };
  }

  /**
   * Non-suspended cards due by end of today, scoped through their topic.
   * Unlike `dueTopics`, mastered topics are included — only archived topics
   * are excluded (mastered topics still keep reviewing under FSRS).
   */
  async dueCards(userId: string, now: Date, domain?: string): Promise<Prompt[]> {
    const disabled = await this.disabledDomains(userId);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
    return this.prisma.prompt.findMany({
      where: {
        suspended: false,
        nextReviewAt: { not: null, lt: endOfToday },
        topic: {
          userId,
          status: { not: 'archived' },
          children: { none: {} },
          ...this.domainFilter(domain, disabled),
        },
      },
      orderBy: { nextReviewAt: 'asc' },
    });
  }

  /** Bounded review slice plus the full eligible backlog; planned study stays separate. */
  async sessionQueue(
    userId: string,
    now: Date,
    domain?: string,
    options: ReviewOptions = {},
  ): Promise<ReviewQueue> {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { disabledDomains: true, timezone: true },
    });
    const disabled = settings?.disabledDomains ?? [];
    const timezone = settings?.timezone ?? 'UTC';
    const startOfToday = localDayStart(now, timezone);
    const endOfToday = localDayStart(
      new Date(startOfToday.getTime() + 36 * 60 * 60 * 1000),
      timezone,
    );
    const topicJoin = {
      select: {
        id: true,
        title: true,
        domain: true,
        parent: { select: { title: true } },
      },
    };
    const [due, fresh] = await Promise.all([
      this.prisma.prompt.findMany({
        where: {
          suspended: false,
          state: { not: 'new' },
          nextReviewAt: { not: null, lt: endOfToday },
          topic: {
            userId,
            status: { in: ['active', 'mastered'] },
            children: { none: {} },
            ...this.domainFilter(domain, disabled),
          },
        },
        orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }],
        include: { topic: topicJoin },
      }),
      this.prisma.prompt.findMany({
        where: {
          suspended: false,
          state: 'new',
          createdAt: { lt: startOfToday },
          topic: {
            userId,
            status: { in: ['active', 'mastered'] },
            OR: [{ learnedAt: null }, { learnedAt: { lt: startOfToday } }],
            children: { none: {} },
            ...this.domainFilter(domain, disabled),
          },
        },
        orderBy: [
          { topic: { learnedAt: { sort: 'desc', nulls: 'last' } } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        include: { topic: topicJoin },
      }),
    ]);
    // ponytail: load compact curriculum candidates for exact backlog totals;
    // move selection/aggregation to paged queries if this outgrows personal use.
    const items = [...due, ...fresh].map(
      (p): ReviewCard => ({
        promptId: p.id,
        topicId: p.topic.id,
        topicTitle: p.topic.title,
        chapterTitle: p.topic.parent?.title ?? p.topic.domain,
        kind: p.promptKind,
        isNew: p.state === 'new',
        nextReviewAt: p.nextReviewAt,
        createdAt: p.createdAt,
        promptText: p.promptText,
        estimatedMinutes: estimateMinutes([p]),
      }),
    );
    return selectReviewQueue(items, options);
  }

  /** Unreviewed cards on studied topics, including cards awaiting their first eligible day. */
  async newCardsCount(userId: string, domain?: string): Promise<number> {
    const disabled = await this.disabledDomains(userId);
    return this.prisma.prompt.count({
      where: {
        suspended: false,
        state: 'new',
        topic: {
          userId,
          status: { in: ['active', 'mastered'] },
          children: { none: {} },
          ...this.domainFilter(domain, disabled),
        },
      },
    });
  }

  /**
   * The single guided suggestion: first startable planned topic in creation
   * order (preserves authored curriculum order). Tentative (aiProposed)
   * topics are candidates — starting one commits it (web-side).
   */
  async nextUp(userId: string, domain?: string, now = new Date()): Promise<NextUp | null> {
    return this.learning.nextUp(userId, domain, now);
  }

  /**
   * Latest repeat/learn export per mode that hasn't come back through Import,
   * within 48h — the Dashboard's "session in flight" breadcrumb. Only the
   * newest row per mode counts, so repeated copies don't stack entries.
   */
  private async pendingSessions(
    userId: string,
    now: Date,
  ): Promise<
    {
      id: string;
      mode: 'repeat' | 'learn';
      generatedAt: Date;
      focusTopicId: string | null;
      topicTitle: string | null;
      approach: LearningApproach | null;
      reviewPlan: ReviewSnapshot | null;
    }[]
  > {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const modes = ['repeat', 'learn'] as const;
    const latest = await Promise.all(
      modes.map((mode) =>
        this.prisma.sessionExport.findFirst({
          where: { userId, mode },
          orderBy: { generatedAt: 'desc' },
          select: {
            id: true,
            mode: true,
            generatedAt: true,
            importedAt: true,
            focusTopicId: true,
            approach: true,
            exportMd: true,
          },
        }),
      ),
    );
    const pending = latest.flatMap((row) =>
      row && row.importedAt === null && row.generatedAt >= cutoff ? [row] : [],
    );
    const focusIds = pending.flatMap((row) => (row.focusTopicId ? [row.focusTopicId] : []));
    const topics = focusIds.length
      ? await this.prisma.topic.findMany({
          where: { userId, id: { in: focusIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleById = new Map(topics.map((topic) => [topic.id, topic.title]));
    return pending.map((row) => ({
      id: row.id,
      mode: row.mode as 'repeat' | 'learn',
      generatedAt: row.generatedAt,
      focusTopicId: row.focusTopicId,
      topicTitle: row.focusTopicId ? (titleById.get(row.focusTopicId) ?? null) : null,
      approach: row.approach === 'source_first' ? 'source-first' : row.approach,
      reviewPlan: row.mode === 'repeat' ? readReviewSnapshot(row.exportMd) : null,
    }));
  }

  private async reviewDay(userId: string, now: Date) {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const timezone = settings?.timezone ?? 'UTC';
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
    const sessions = await this.prisma.sessionExport.findMany({
      where: {
        userId,
        mode: 'repeat',
        importedAt: { gte: localDayStart(now, timezone), lte: now },
      },
      select: { id: true, exportMd: true, importedOutputRaw: true },
    });
    return {
      dayKey,
      completed: sessions.some((s) => completedReview(s.exportMd, s.importedOutputRaw, s.id)),
    };
  }

  async dashboard(userId: string, now: Date, domain?: string, options: ReviewOptions = {}) {
    const [
      reviewStats7d,
      due,
      grouped,
      newCards,
      nextUp,
      sessionQueue,
      pendingSessions,
      reviewDay,
    ] = await Promise.all([
      this.reviewStats7d(userId, now),
      this.dueTopics(userId, now, domain),
      this.prisma.topic.groupBy({
        by: ['status'],
        _count: true,
        where: { userId, ...(domain ? { domain } : {}) },
      }),
      this.newCardsCount(userId, domain),
      this.nextUp(userId, domain, now),
      this.sessionQueue(userId, now, domain, options),
      this.pendingSessions(userId, now),
      this.reviewDay(userId, now),
    ]);
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count ?? 0;
    return {
      generatedAt: now.toISOString(),
      reviewStats7d,
      due,
      newCards,
      nextUp,
      sessionQueueCount: sessionQueue.items.length,
      sessionQueueMinutes: sessionQueue.estimatedMinutes,
      reviewQueue: sessionQueue,
      reviewDay,
      pendingSessions,
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
