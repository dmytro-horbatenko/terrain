import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, Prompt, Topic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { OUTPUT_CONTRACT } from './output-contract';
import { estimateMinutes } from '../telegram/telegram.messages';
import { LEARN_CONDUCT, REPEAT_CONDUCT } from './session-conduct';

type TopicWithPrereqs = Prisma.TopicGetPayload<{
  include: {
    prerequisites: { include: { prerequisite: { select: { status: true } } } };
    prompts: { select: { reps: true; stability: true; suspended: true } };
  };
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
    if (mode === 'repeat') return this.generateRepeat(opts.userId, opts.now);
    if (mode === 'learn') return this.generateLearn(opts.userId, opts.now, opts.focusTopicId);
    const domainFilter = mode.startsWith('domain:') ? mode.slice('domain:'.length) : null;

    const topics = await this.prisma.topic.findMany({
      where: { userId: opts.userId, ...(domainFilter ? { domain: domainFilter } : {}) },
      orderBy: [{ domain: 'asc' }, { createdAt: 'asc' }],
      include: {
        prerequisites: { include: { prerequisite: { select: { status: true } } } },
        prompts: { select: { reps: true, stability: true, suspended: true } },
      },
    });

    const sections: string[] = [];
    sections.push(this.header(mode, opts.now));
    sections.push(await this.whoIAm(opts.userId));
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

  private async whoIAm(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return `## WHO I AM (stable)
Name: ${user?.name ?? ''}
Role: ${user?.headline ?? ''}
Learning style: ${user?.learningStyle ?? ''}
Code style: ${user?.codeStyle ?? ''}
Note system: ${user?.noteSystem ?? ''}`;
  }

  private header(mode: string, now: Date): string {
    return `---\nTERRAIN — SESSION CONTEXT\nGenerated: ${now.toISOString()}\nSession: <set-on-persist>\nExport: ${mode}\n---`;
  }

  /** Today-scoped repetition context: the interleaved session queue + a
   *  conduct script. Deliberately lean — no roadmap/mastery/landscape — so
   *  the chat stays on-script. */
  private async generateRepeat(userId: string, now: Date): Promise<string> {
    const { items } = await this.metrics.sessionQueue(userId, now);
    const sections = [this.header('repeat', now), await this.whoIAm(userId)];

    if (items.length === 0) {
      sections.push(`## TODAY'S REVIEW QUEUE\nNothing due today.`);
    } else {
      const prompts = await this.prisma.prompt.findMany({
        where: { id: { in: items.map((i) => i.promptId) } },
        select: { id: true, promptText: true, promptKind: true, estimatedMinutes: true },
      });
      const byId = new Map(prompts.map((p) => [p.id, p]));
      const dueCount = items.filter((i) => !i.isNew).length;
      const est = estimateMinutes(items.map((i) => byId.get(i.promptId)).filter((p) => p != null));
      const lines = items.map((i) => {
        const text = byId.get(i.promptId)?.promptText ?? '';
        const tag = i.isNew ? ' [NEW]' : '';
        return `- card ${i.promptId} [${i.kind}]${tag} (${i.chapterTitle}) ${text}`;
      });
      sections.push(
        `## TODAY'S REVIEW QUEUE\n${items.length} cards (${dueCount} due, ${items.length - dueCount} new) · estimated ${est} min\n${lines.join('\n')}`,
      );
      sections.push(REPEAT_CONDUCT);
    }

    sections.push(OUTPUT_CONTRACT);
    return sections.join('\n\n');
  }

  /** Learning context for one topic (default: Next Up): where it sits in the
   *  roadmap, what it builds on (prerequisites with their note summaries as
   *  the elaborative bridge), existing cards, and a teaching script. */
  private async generateLearn(userId: string, now: Date, focusTopicId?: string): Promise<string> {
    let focusId = focusTopicId;
    if (!focusId) {
      const next = await this.metrics.nextUp(userId);
      if (!next) {
        throw new UnprocessableEntityException(
          'No startable topic — pass focusTopicId or start something from the roadmap.',
        );
      }
      focusId = next.topic.id;
    }
    const focus = await this.prisma.topic.findFirst({
      where: { id: focusId, userId },
      include: {
        parent: {
          select: {
            id: true,
            title: true,
            prerequisites: { include: { prerequisite: { select: { id: true } } } },
          },
        },
        prerequisites: {
          include: { prerequisite: { select: { title: true, status: true, summary: true } } },
        },
        prompts: {
          where: { suspended: false },
          orderBy: { createdAt: 'asc' },
          select: { id: true, promptKind: true, promptText: true },
        },
      },
    });
    if (!focus || focus.status === 'archived') {
      throw new NotFoundException(`Topic ${focusId} not found`);
    }

    const goal: string[] = [`## LEARNING GOAL`, `Topic: ${focus.title} [${focus.topicType}]`];
    if (focus.description) goal.push(`Description: ${focus.description}`);
    if (focus.aiContext) goal.push(`AI context: ${focus.aiContext}`);
    if (focus.prerequisites.length > 0) {
      const lines = focus.prerequisites.map(({ prerequisite: p }) =>
        p.summary ? `- ${p.title} — ${p.summary}` : `- ${p.title}`,
      );
      goal.push(`Builds on (your existing knowledge):\n${lines.join('\n')}`);
    }
    if (focus.prompts.length > 0) {
      const lines = focus.prompts.map((c) => `- card ${c.id} [${c.promptKind}] ${c.promptText}`);
      goal.push(`Existing cards (do not duplicate):\n${lines.join('\n')}`);
    }

    const sections = [this.header('learn', now), await this.whoIAm(userId)];

    if (focus.parent) {
      const prereqChapterIds = focus.parent.prerequisites.map((p) => p.prerequisite.id);
      const chapterTopics = await this.prisma.topic.findMany({
        where: {
          userId,
          status: { not: 'archived' },
          OR: [{ parentId: focus.parent.id }, { id: { in: prereqChapterIds } }],
        },
        include: {
          prerequisites: { include: { prerequisite: { select: { status: true } } } },
          prompts: { select: { reps: true, stability: true, suspended: true } },
        },
      });
      const siblings = chapterTopics.filter(
        (t) => t.parentId === focus.parent!.id && t.id !== focus.id,
      );
      const prereqChapters = chapterTopics.filter((t) => prereqChapterIds.includes(t.id));
      sections.push(this.chapterContext(focus.parent.title, siblings, prereqChapters));
    }

    sections.push(goal.join('\n'), LEARN_CONDUCT, OUTPUT_CONTRACT);
    return sections.join('\n\n');
  }

  private prereqStatuses(t: TopicWithPrereqs): string[] {
    return (t.prerequisites ?? []).map((p) => p.prerequisite.status);
  }

  private glyph(t: TopicWithPrereqs): string {
    if (t.status === 'mastered') return '✓';
    const { blocked } = this.metrics.topicLabels({
      status: t.status,
      cards: t.prompts.map((p) => ({ reps: p.reps })),
      prerequisiteStatuses: this.prereqStatuses(t),
    });
    if (blocked) return '✗';
    if (t.status === 'active') return '●';
    return '○';
  }

  private reviewingTag(t: TopicWithPrereqs): string {
    const { reviewing } = this.metrics.topicLabels({
      status: t.status,
      cards: t.prompts.map((p) => ({ reps: p.reps })),
      prerequisiteStatuses: this.prereqStatuses(t),
    });
    return reviewing ? ' (reviewing)' : '';
  }

  private aiAnnotation(t: TopicWithPrereqs, depth: number): string {
    const tentative = t.aiProposed && t.status !== 'archived';
    if (!tentative || !t.aiContext) return '';
    return `${'  '.repeat(depth + 1)}↳ AI context: ${t.aiContext}`;
  }

  private chapterContext(
    chapterTitle: string,
    siblings: TopicWithPrereqs[],
    prereqChapters: TopicWithPrereqs[],
  ): string {
    const line = (t: TopicWithPrereqs) => `${this.glyph(t)} ${t.title}${this.reviewingTag(t)}`;
    const siblingBlock = siblings.length > 0 ? siblings.map(line).join('\n') : '- (none yet)';
    const parts = [`In this chapter (${chapterTitle}):\n${siblingBlock}`];
    if (prereqChapters.length > 0) {
      parts.push(`Builds on (chapters):\n${prereqChapters.map(line).join('\n')}`);
    }
    return `## CHAPTER CONTEXT\n${parts.join('\n\n')}`;
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
    const cards = await this.metrics.dueCards(userId, now, domain ?? undefined);
    const cardsByTopic = new Map<string, Prompt[]>();
    for (const c of cards) {
      const arr = cardsByTopic.get(c.topicId) ?? [];
      arr.push(c);
      cardsByTopic.set(c.topicId, arr);
    }
    const fmt = (t: Topic) => {
      const head = `- ${t.title} [${t.topicType}]`;
      const cardLines = (cardsByTopic.get(t.id) ?? []).map(
        (c) => `  - card ${c.id} [${c.promptKind}] ${c.promptText}`,
      );
      return [head, ...cardLines].join('\n');
    };
    const overdueBlock = overdue.length ? overdue.map(fmt).join('\n') : '- (none)';
    const todayBlock = dueToday.length ? dueToday.map(fmt).join('\n') : '- (none)';
    return `## DUE FOR REVIEW TODAY\nOVERDUE:\n${overdueBlock}\n\nDUE TODAY:\n${todayBlock}`;
  }

  private async mastery(topics: TopicWithPrereqs[], userId: string): Promise<string> {
    const header = '## MASTERY CONDITIONS (retention = all active cards at stability ≥ 30d)';
    const active = topics.filter((t) => t.status === 'active');
    if (active.length === 0) return `${header}\n- (no active topics)`;
    const lines: string[] = [];
    for (const t of active) {
      const appEventCount = await this.prisma.applicationEvent.count({
        where: { topicId: t.id, userId },
      });
      const s = this.metrics.masteryStatus({
        cards: t.prompts.map((p) => ({ stability: p.stability, suspended: p.suspended })),
        appEventCount,
        noteRef: t.noteRef,
        summary: t.summary,
      });
      const mark = (b: boolean) => (b ? '✓' : '✗');
      lines.push(
        `- ${t.title}: retention ${mark(s.retention)} application ${mark(s.application)} teaching ${mark(s.teaching)}`,
      );
    }
    return `${header}\n${lines.join('\n')}`;
  }
}
