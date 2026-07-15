import { Injectable } from '@nestjs/common';
import type { Prompt, Topic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseStoredSourcePlan, sourcePlanStats } from '../sources/source-plan';
import { estimateMinutes } from '../telegram/telegram.messages';
import { interleaveQueue, type SessionQueueItem } from './interleave';

const DAY_MS = 86_400_000;
const NEW_CARDS_PER_SESSION = 5;

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
  constructor(private prisma: PrismaService) {}

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

  topicLabels(input: {
    status: string;
    cards: { reps: number }[];
    prerequisiteStatuses: string[];
  }): {
    blocked: boolean;
    reviewing: boolean;
  } {
    const blocked =
      input.status === 'planned' &&
      input.prerequisiteStatuses.some((s) => s !== 'mastered' && s !== 'active');
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
    const teaching = input.noteRef != null || input.summary != null;
    return { retention, application, teaching, eligible: retention && application && teaching };
  }

  async struggleRatio7d(userId: string, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 7 * DAY_MS);
    const reviews = await this.prisma.review.findMany({
      where: { userId, reviewedAt: { gte: cutoff } },
      select: { grade: true },
    });
    if (reviews.length === 0) return 0;
    const poor = reviews.filter((r) => r.grade === 'again').length;
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
        topic: { userId, status: { not: 'archived' }, ...this.domainFilter(domain, disabled) },
      },
      orderBy: { nextReviewAt: 'asc' },
    });
  }

  /**
   * Interleaved review-session queue: every due card (same predicate as
   * `dueCards`, kept separate because this query needs topic/parent joins)
   * plus up to NEW_CARDS_PER_SESSION new cards from *active* topics only —
   * starting planned topics stays a deliberate act via Next Up.
   */
  async sessionQueue(
    userId: string,
    now: Date,
    domain?: string,
  ): Promise<{ items: SessionQueueItem[]; estimatedMinutes: number }> {
    const disabled = await this.disabledDomains(userId);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday.getTime() + DAY_MS);
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
          nextReviewAt: { not: null, lt: endOfToday },
          topic: { userId, status: { not: 'archived' }, ...this.domainFilter(domain, disabled) },
        },
        orderBy: { nextReviewAt: 'asc' },
        include: { topic: topicJoin },
      }),
      this.prisma.prompt.findMany({
        where: {
          suspended: false,
          state: 'new',
          topic: { userId, status: 'active', ...this.domainFilter(domain, disabled) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: NEW_CARDS_PER_SESSION,
        include: { topic: topicJoin },
      }),
    ]);
    const raw = [...due, ...fresh];
    const items = raw.map(
      (p): SessionQueueItem => ({
        promptId: p.id,
        topicId: p.topic.id,
        topicTitle: p.topic.title,
        chapterTitle: p.topic.parent?.title ?? p.topic.domain,
        kind: p.promptKind,
        isNew: p.state === 'new',
        nextReviewAt: p.nextReviewAt,
        createdAt: p.createdAt,
      }),
    );
    return {
      items: interleaveQueue(items),
      estimatedMinutes: estimateMinutes(
        raw.map((p) => ({ promptKind: p.promptKind, estimatedMinutes: p.estimatedMinutes })),
      ),
    };
  }

  /**
   * IDs of planned topics whose direct prerequisites are all started
   * (active or mastered) — the startable frontier, in creation order.
   * Topics with children are category/chapter nodes (organizational, per the
   * same hasChildren convention as the web roadmap projection), not
   * reviewable units — they're excluded so a category can't outrank its own
   * leaves just for being created first.
   */
  private async startablePlannedIds(
    userId: string,
    domain: string | undefined,
    disabledDomains: string[],
  ): Promise<string[]> {
    const planned = await this.prisma.topic.findMany({
      where: { userId, status: 'planned', ...this.domainFilter(domain, disabledDomains) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        prerequisites: { select: { prerequisite: { select: { status: true } } } },
        children: { select: { id: true }, take: 1 },
      },
    });
    return planned
      .filter((t) => t.children.length === 0)
      .filter((t) =>
        t.prerequisites.every(
          (p) => p.prerequisite.status === 'active' || p.prerequisite.status === 'mastered',
        ),
      )
      .map((t) => t.id);
  }

  /**
   * Non-suspended `new`-state cards whose topic is studyable today: active or
   * mastered, or a startable planned topic. Blocked planned topics' starter
   * cards are excluded — they'd inflate "New: N" with cards you can't reach.
   */
  async newCardsCount(userId: string, domain?: string): Promise<number> {
    const disabled = await this.disabledDomains(userId);
    const startableIds = await this.startablePlannedIds(userId, domain, disabled);
    return this.prisma.prompt.count({
      where: {
        suspended: false,
        state: 'new',
        topic: { userId, ...this.domainFilter(domain, disabled) },
        OR: [
          { topic: { status: { in: ['active', 'mastered'] } } },
          { topicId: { in: startableIds } },
        ],
      },
    });
  }

  /**
   * The single guided suggestion: first startable planned topic in creation
   * order (preserves authored curriculum order). Tentative (aiProposed)
   * topics are candidates — starting one commits it (web-side).
   */
  async nextUp(userId: string, domain?: string, now = new Date()): Promise<NextUp | null> {
    const disabled = await this.disabledDomains(userId);
    const [firstId] = await this.startablePlannedIds(userId, domain, disabled);
    if (!firstId) return null;
    const topic = await this.prisma.topic.findFirst({ where: { id: firstId, userId } });
    if (!topic) return null;
    const stats = sourcePlanStats(parseStoredSourcePlan(topic.sourcePlan), topic.status, now);
    if (!topic.parentId)
      return { topic, chapterTitle: null, chapterProgress: null, sourcePlanStats: stats };
    const parent = await this.prisma.topic.findFirst({
      where: { id: topic.parentId, userId },
      select: { title: true, children: { select: { status: true } } },
    });
    if (!parent)
      return { topic, chapterTitle: null, chapterProgress: null, sourcePlanStats: stats };
    const started = parent.children.filter(
      (c) => c.status === 'active' || c.status === 'mastered',
    ).length;
    return {
      topic,
      chapterTitle: parent.title,
      chapterProgress: { started, total: parent.children.length },
      sourcePlanStats: stats,
    };
  }

  /**
   * Latest repeat/learn export per mode that hasn't come back through Import,
   * within 48h — the Dashboard's "session in flight" breadcrumb. Only the
   * newest row per mode counts, so repeated copies don't stack entries.
   */
  private async pendingSessions(
    userId: string,
    now: Date,
  ): Promise<{ id: string; mode: 'repeat' | 'learn'; generatedAt: Date }[]> {
    const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const modes = ['repeat', 'learn'] as const;
    const latest = await Promise.all(
      modes.map((mode) =>
        this.prisma.sessionExport.findFirst({
          where: { userId, mode },
          orderBy: { generatedAt: 'desc' },
          select: { id: true, mode: true, generatedAt: true, importedAt: true },
        }),
      ),
    );
    return latest.flatMap((row) =>
      row && row.importedAt === null && row.generatedAt >= cutoff
        ? [{ id: row.id, mode: row.mode as 'repeat' | 'learn', generatedAt: row.generatedAt }]
        : [],
    );
  }

  async dashboard(userId: string, now: Date, domain?: string) {
    const [struggleRatio7d, due, grouped, newCards, nextUp, sessionQueue, pendingSessions] =
      await Promise.all([
        this.struggleRatio7d(userId, now),
        this.dueTopics(userId, now, domain),
        this.prisma.topic.groupBy({
          by: ['status'],
          _count: true,
          where: { userId, ...(domain ? { domain } : {}) },
        }),
        this.newCardsCount(userId, domain),
        this.nextUp(userId, domain, now),
        this.sessionQueue(userId, now, domain),
        this.pendingSessions(userId, now),
      ]);
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count ?? 0;
    return {
      generatedAt: now.toISOString(),
      struggleRatio7d,
      due,
      newCards,
      nextUp,
      sessionQueueCount: sessionQueue.items.length,
      sessionQueueMinutes: sessionQueue.estimatedMinutes,
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
