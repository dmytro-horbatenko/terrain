import { Injectable } from '@nestjs/common';
import type { Prisma, Topic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { OUTPUT_CONTRACT } from './output-contract';

type TopicWithPrereqs = Prisma.TopicGetPayload<{
  include: { prerequisites: { include: { prerequisite: { select: { status: true } } } } };
}>;

@Injectable()
export class ExportGeneratorService {
  constructor(
    private prisma: PrismaService,
    private metrics: MetricsService,
  ) {}

  async generate(opts: {
    mode?: string;
    focusTopicId?: string;
    now: Date;
    userId: string;
  }): Promise<string> {
    const mode = opts.mode ?? 'full';
    const domainFilter = mode.startsWith('domain:') ? mode.slice('domain:'.length) : null;

    const topics = await this.prisma.topic.findMany({
      where: { userId: opts.userId, ...(domainFilter ? { domain: domainFilter } : {}) },
      orderBy: [{ domain: 'asc' }, { createdAt: 'asc' }],
      include: { prerequisites: { include: { prerequisite: { select: { status: true } } } } },
    });

    const user = await this.prisma.user.findUnique({ where: { id: opts.userId } });
    const whoIAm = `## WHO I AM (stable)
Name: ${user?.name ?? ''}
Role: ${user?.role ?? ''}
Learning style: ${user?.learningStyle ?? ''}
Code style: ${user?.codeStyle ?? ''}
Note system: ${user?.noteSystem ?? ''}`;

    const sections: string[] = [];
    sections.push(
      `---\nTERRAIN — SESSION CONTEXT\nGenerated: ${opts.now.toISOString()}\nSession: <set-on-persist>\nExport: ${mode}\n---`,
    );
    sections.push(whoIAm);
    // ROADMAP shows the active/planned tree only. Archived topics are excluded
    // here so parked ideas (aiProposed && archived) aren't double-listed — they
    // appear solely under PARKED IDEAS below. The tree walk is orphan-safe, so a
    // child whose parent was filtered out is treated as a root.
    sections.push(this.roadmap(topics.filter((t) => t.status !== 'archived')));
    const parked = this.parkedIdeas(topics);
    if (parked) sections.push(parked);
    sections.push(await this.due(opts.userId, opts.now, domainFilter));
    sections.push(
      `## RECENT SIGNALS\nStruggle ratio 7d: ${Math.round(
        (await this.metrics.struggleRatio7d(opts.userId, opts.now)) * 100,
      )}% (target 40-60%)`,
    );
    sections.push(await this.mastery(topics, opts.userId));
    if (opts.focusTopicId) {
      const focus = topics.find((t) => t.id === opts.focusTopicId);
      sections.push(
        `## SESSION GOAL\nFocus: ${focus ? focus.title : opts.focusTopicId}\nStyle: Socratic; push back if I move too fast; enforce confusion time.`,
      );
    } else {
      const lastImport = await this.prisma.sessionExport.findFirst({
        where: { userId: opts.userId, importedAt: { not: null }, nextFocusTitle: { not: null } },
        orderBy: { importedAt: 'desc' },
      });
      if (lastImport?.nextFocusTitle) {
        const cold = lastImport.nextColdChallenge
          ? `\nCold challenge: ${lastImport.nextColdChallenge}`
          : '';
        sections.push(
          `## SUGGESTED NEXT FOCUS (from last session)\nFocus: ${lastImport.nextFocusTitle}${cold}`,
        );
      }
    }
    const recent = await this.recentSessions(opts.userId);
    if (recent) sections.push(recent);
    sections.push(OUTPUT_CONTRACT);
    return sections.join('\n\n');
  }

  private prereqStatuses(t: TopicWithPrereqs): string[] {
    return (t.prerequisites ?? []).map((p) => p.prerequisite.status);
  }

  private glyph(t: TopicWithPrereqs): string {
    if (t.status === 'mastered') return '✓';
    const { blocked } = this.metrics.topicLabels({
      status: t.status,
      repetitions: t.repetitions,
      prerequisiteStatuses: this.prereqStatuses(t),
    });
    if (blocked) return '✗';
    if (t.status === 'active') return '●';
    return '○';
  }

  private reviewingTag(t: TopicWithPrereqs): string {
    const { reviewing } = this.metrics.topicLabels({
      status: t.status,
      repetitions: t.repetitions,
      prerequisiteStatuses: this.prereqStatuses(t),
    });
    return reviewing ? ' (reviewing)' : '';
  }

  private aiAnnotation(t: TopicWithPrereqs, depth: number): string {
    const tentative = t.aiProposed && t.status !== 'archived';
    if (!tentative || !t.aiContext) return '';
    return `${'  '.repeat(depth + 1)}↳ AI context: ${t.aiContext}`;
  }

  private roadmap(topics: TopicWithPrereqs[]): string {
    const byDomain = new Map<string, TopicWithPrereqs[]>();
    for (const t of topics) {
      const arr = byDomain.get(t.domain) ?? [];
      arr.push(t);
      byDomain.set(t.domain, arr);
    }
    const blocks: string[] = [];
    for (const [domain, list] of byDomain) {
      const ids = new Set(list.map((t) => t.id));
      const visited = new Set<string>();
      const childrenOf = (parentId: string) => list.filter((t) => t.parentId === parentId);
      // roots = no parent, OR parent not present in this domain group (orphan-safe)
      const roots = list.filter((t) => !t.parentId || !ids.has(t.parentId));
      const render = (t: TopicWithPrereqs, depth: number): string => {
        if (visited.has(t.id)) return '';
        visited.add(t.id);
        const prefix = depth === 0 ? '' : '  '.repeat(depth) + '├─ ';
        const head = `${prefix}${this.glyph(t)} ${t.title}${this.reviewingTag(t)}`;
        const annotation = this.aiAnnotation(t, depth);
        const headBlock = annotation ? `${head}\n${annotation}` : head;
        const kids = childrenOf(t.id)
          .map((c) => render(c, depth + 1))
          .filter((s) => s.length > 0);
        return kids.length ? `${headBlock}\n${kids.join('\n')}` : headBlock;
      };
      const lines = roots.map((r) => render(r, 0)).filter((s) => s.length > 0);
      blocks.push(`## ROADMAP — ${domain}\n${lines.join('\n')}`);
    }
    return blocks.join('\n\n');
  }

  private parkedIdeas(topics: TopicWithPrereqs[]): string {
    const parked = topics.filter((t) => t.aiProposed && t.status === 'archived');
    if (parked.length === 0) return '';
    const lines = parked.map(
      (t) => `- ${t.title} (${t.topicType}, ${t.domain})${t.aiContext ? ` — ${t.aiContext}` : ''}`,
    );
    return `## PARKED IDEAS\n${lines.join('\n')}`;
  }

  private async recentSessions(userId: string): Promise<string> {
    const rows = await this.prisma.sessionExport.findMany({
      where: { userId },
      orderBy: { generatedAt: 'desc' },
      take: 3,
    });
    if (rows.length === 0) return '';
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const lines = rows.map((r) => {
      const imported = r.importedAt ? `imported ${day(r.importedAt)}` : 'not imported';
      const created = r.newTopicsCreated?.length ?? 0;
      const focus = r.nextFocusTitle ? `; next focus: ${r.nextFocusTitle}` : '';
      return `- ${day(r.generatedAt)} — ${imported}; ${created} topics created${focus}`;
    });
    return `## RECENT SESSIONS\n${lines.join('\n')}`;
  }

  private async due(userId: string, now: Date, domain: string | null): Promise<string> {
    const { overdue, dueToday } = await this.metrics.dueTopics(userId, now, domain ?? undefined);
    const fmt = (t: Topic) => `- ${t.title} [${t.topicType}]`;
    const overdueBlock = overdue.length ? overdue.map(fmt).join('\n') : '- (none)';
    const todayBlock = dueToday.length ? dueToday.map(fmt).join('\n') : '- (none)';
    return `## DUE FOR REVIEW TODAY\nOVERDUE:\n${overdueBlock}\n\nDUE TODAY:\n${todayBlock}`;
  }

  private async mastery(topics: TopicWithPrereqs[], userId: string): Promise<string> {
    const active = topics.filter((t) => t.status === 'active');
    if (active.length === 0) return `## MASTERY CONDITIONS\n- (no active topics)`;
    const lines: string[] = [];
    for (const t of active) {
      const appEventCount = await this.prisma.applicationEvent.count({
        where: { topicId: t.id, userId },
      });
      const s = this.metrics.masteryStatus({
        interval: t.interval,
        appEventCount,
        noteRef: t.noteRef,
        summary: t.summary,
      });
      const mark = (b: boolean) => (b ? '✓' : '✗');
      lines.push(
        `- ${t.title}: retention ${mark(s.retention)} application ${mark(s.application)} teaching ${mark(s.teaching)}`,
      );
    }
    return `## MASTERY CONDITIONS\n${lines.join('\n')}`;
  }
}
