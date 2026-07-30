import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma, Prompt, Topic } from '@prisma/client';
import type { LearningApproach, LearningContext } from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { buildRoadmapPolicy, type RoadmapEligibility } from '../learning/roadmap-policy';
import { MetricsService } from '../metrics/metrics.service';
import { OUTPUT_CONTRACT } from './output-contract';
import { estimateMinutes } from '../telegram/telegram.messages';
import { GUIDED_CONDUCT, REPEAT_CONDUCT, SOURCE_FIRST_CONDUCT } from './session-conduct';
import { applicableRequirements, isSourceExpired } from '../sources/source-plan';

type TopicWithPrereqs = Prisma.TopicGetPayload<{
  include: {
    prerequisites: { select: { prerequisiteId: true } };
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
    if (mode === 'learn') {
      throw new UnprocessableEntityException('Learning exports require resolved context.');
    }
    const domainFilter = mode.startsWith('domain:') ? mode.slice('domain:'.length) : null;

    const allTopics = await this.prisma.topic.findMany({
      where: { userId: opts.userId },
      orderBy: [{ domain: 'asc' }, { createdAt: 'asc' }],
      include: {
        prerequisites: { select: { prerequisiteId: true } },
        prompts: { select: { reps: true, stability: true, suspended: true } },
      },
    });
    const policy = buildRoadmapPolicy(
      allTopics.map((topic) => ({
        id: topic.id,
        parentId: topic.parentId,
        status: topic.status,
        prerequisiteIds: topic.prerequisites.map((edge) => edge.prerequisiteId),
      })),
    );
    const topics = domainFilter
      ? allTopics.filter((topic) => topic.domain === domainFilter)
      : allTopics;

    const sections: string[] = [];
    sections.push(this.header(mode, opts.now));
    sections.push(await this.whoIAm(opts.userId));
    // ROADMAP shows the active/planned tree only. Archived topics are excluded
    // here so parked ideas (aiProposed && archived) aren't double-listed — they
    // appear solely under PARKED IDEAS below. The tree walk is orphan-safe, so a
    // child whose parent was filtered out is treated as a root.
    sections.push(
      this.roadmap(
        topics.filter((t) => t.status !== 'archived'),
        policy,
      ),
    );
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

  generateLearnContext(context: LearningContext, approach: LearningApproach, now: Date): string {
    const target = context.target;
    if (!target) throw new UnprocessableEntityException('No startable topic.');
    const learner = `## WHO I AM (stable)
Role: ${context.learner.role ?? ''}
Learning style: ${context.learner.learningStyle ?? ''}
Code style: ${context.learner.codeStyle ?? ''}
Note system: ${context.learner.noteSystem ?? ''}`;
    const imported = context.selection.importedFocus
      ? `\nImported focus: ${context.selection.importedFocus.title} — ${
          context.selection.importedFocus.accepted ? 'accepted' : 'rejected'
        }: ${context.selection.importedFocus.reason}`
      : '';
    const alternatives = context.selection.learnableAlternatives.length
      ? `\nAlternatives:\n${context.selection.learnableAlternatives
          .map((topic) => `- ${topic.title}${topic.chapterTitle ? ` (${topic.chapterTitle})` : ''}`)
          .join('\n')}`
      : '';
    const selection = `## SELECTION
Resolved by: ${context.selection.source}${imported}${alternatives}`;
    const prompts = target.prompts.length
      ? `\nExisting cards (do not duplicate):\n${target.prompts
          .map(
            (prompt) =>
              `- card ${prompt.id} [${prompt.kind}] (${prompt.state}${
                prompt.lastGrade ? `; last grade ${prompt.lastGrade}` : ''
              }; difficulty ${prompt.difficulty ?? 'unrated'}; stability ${
                prompt.stability ?? 'unrated'
              }) ${prompt.text}`,
          )
          .join('\n')}`
      : '';
    const chapter = target.chapter
      ? `\nChapter: ${target.chapter.title} (${target.chapter.learnedLeaves}/${target.chapter.totalLeaves} leaves learned)`
      : '';
    const exposure =
      target.status === 'planned'
        ? 'not yet studied — treat this as first exposure, start from fundamentals'
        : target.status === 'mastered'
          ? 'mastered — this is a deliberate re-review'
          : target.status === 'active'
            ? 'in progress — you have studied this before, teach it as a review'
            : 'archived — this topic is not session eligible';
    const goal = `## LEARNING GOAL
Topic: ${target.title}
Domain: ${target.domain}
Type: ${target.topicType}
Status: ${target.status}
Exposure: ${exposure}
Chosen approach: ${approach}
Recommended approach: ${target.approach.recommended}
Recommendation reasons: ${target.approach.reasons.join('; ')}${chapter}${
      target.description ? `\nDescription: ${target.description}` : ''
    }${prompts}`;
    const prerequisiteLines = context.prerequisites.flatMap((prerequisite) =>
      this.prerequisiteLines(prerequisite),
    );
    const prerequisites = `## PREREQUISITES
${prerequisiteLines.length ? prerequisiteLines.join('\n') : '- (none)'}`;
    const knowledge = (
      heading: string,
      topics: LearningContext['mayRelyOn'] | LearningContext['doNotAssume'],
    ) =>
      `## ${heading}\n${
        topics.length
          ? topics
              .map(
                (topic) =>
                  `- ${topic.title} [${topic.level}] — ${topic.reason}${
                    topic.summary ? ` Summary: ${topic.summary}` : ''
                  }\n  Evidence: grades ${topic.evidence.recentGrades.join(', ') || 'none'}; ` +
                  `last reviewed ${topic.evidence.lastReviewedAt ?? 'never'}; Sources: ${
                    topic.evidence.sourceTitles.join(', ') || 'none'
                  }; applications ${topic.evidence.applicationCount}` +
                  (topic.evidence.latestApplication
                    ? `; Latest application: ${topic.evidence.latestApplication}`
                    : ''),
              )
              .join('\n')
          : '- (none)'
      }`;
    const blockers = `## BLOCKERS
${
  context.blockers.length
    ? context.blockers.map((blocker) => `- ${blocker.title} — ${blocker.reason}`).join('\n')
    : '- (none)'
}`;
    const mcp = `## TERRAIN MCP — supplemental context
If Terrain's get_learning_context tool is available, call get_learning_context once for ${target.title} before teaching. Use it only to supplement this export with current prior-learning evidence, prerequisite and blocker state, and roadmap alternatives.
This copied export remains authoritative for the session target, Session ID, chosen approach, SOURCE PLAN, SESSION CONDUCT, and OUTPUT CONTRACT. If the tool is unavailable, continue with this export.`;
    return [
      this.header('learn', now),
      learner,
      selection,
      this.learningSourcePlan(target, approach, now),
      goal,
      prerequisites,
      knowledge('MAY RELY ON', context.mayRelyOn),
      knowledge('DO NOT ASSUME', context.doNotAssume),
      blockers,
      mcp,
      approach === 'guided' ? GUIDED_CONDUCT : SOURCE_FIRST_CONDUCT,
      OUTPUT_CONTRACT,
    ].join('\n\n');
  }

  private learningSourcePlan(
    target: NonNullable<LearningContext['target']>,
    approach: LearningApproach,
    now: Date,
  ): string {
    const plan = target.sourcePlan;
    const lines = ['## SOURCE PLAN'];
    if (!plan) {
      lines.push(
        approach === 'guided'
          ? 'No curated source plan is stored. Guided learning may proceed without a source gate.'
          : target.status === 'planned'
            ? 'LEGACY FIRST EXPOSURE BLOCKED — no source plan is stored for this topic.'
            : 'LEGACY COMPATIBILITY MODE — no source plan is stored for this previously studied topic.',
      );
      return lines.join('\n');
    }
    if (plan.policy === 'none') {
      lines.push(`No required sources: ${plan.rationale}`);
      return lines.join('\n');
    }
    for (const requirement of applicableRequirements(plan, target.status)) {
      lines.push(
        `Requirement ${requirement.id} (${requirement.requiredWhen}): ${requirement.purpose}`,
      );
      for (const option of requirement.options) {
        const expired = isSourceExpired(option, now) ? ' [EXPIRED — verify live before use]' : '';
        lines.push(
          `- ${option.id}${expired}: ${option.title} [${option.format}]\n` +
            `  URL: ${option.url}\n` +
            `  Scope: ${option.scope}\n` +
            `  Time: ${option.estimatedMinutes} min\n` +
            `  Why: ${option.why}\n` +
            `  Paid: ${option.paid ?? false}; Language: ${option.language ?? 'unspecified'}` +
            (option.verifiedAt
              ? `\n  Verified at: ${option.verifiedAt}\n  Recheck after: ${option.recheckAfterDays} days`
              : ''),
        );
      }
    }
    return lines.join('\n');
  }

  private prerequisiteLines(
    prerequisite: LearningContext['prerequisites'][number],
    depth = 0,
  ): string[] {
    const line = `${'  '.repeat(depth)}- ${prerequisite.title} [${
      prerequisite.satisfied ? 'satisfied' : 'blocked'
    }] (${prerequisite.learnedLeaves}/${prerequisite.totalLeaves}) — ${prerequisite.reason}${
      prerequisite.summary ? ` Summary: ${prerequisite.summary}` : ''
    }`;
    return [
      line,
      ...prerequisite.children.flatMap((child) => this.prerequisiteLines(child, depth + 1)),
    ];
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

  private glyph(t: TopicWithPrereqs, policy: Map<string, RoadmapEligibility>): string {
    if (t.status === 'mastered') return '✓';
    const { blocked } = this.metrics.topicLabels({
      status: t.status,
      cards: t.prompts.map((p) => ({ reps: p.reps })),
      blocked: t.status === 'planned' && policy.get(t.id)?.learnable === false,
    });
    if (blocked) return '✗';
    if (t.status === 'active') return '●';
    return '○';
  }

  private reviewingTag(t: TopicWithPrereqs): string {
    const { reviewing } = this.metrics.topicLabels({
      status: t.status,
      cards: t.prompts.map((p) => ({ reps: p.reps })),
      blocked: false,
    });
    return reviewing ? ' (reviewing)' : '';
  }

  private aiAnnotation(t: TopicWithPrereqs, depth: number): string {
    const tentative = t.aiProposed && t.status !== 'archived';
    if (!tentative || !t.aiContext) return '';
    return `${'  '.repeat(depth + 1)}↳ AI context: ${t.aiContext}`;
  }

  private roadmap(topics: TopicWithPrereqs[], policy: Map<string, RoadmapEligibility>): string {
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
        const head = `${prefix}${this.glyph(t, policy)} ${t.title}${this.reviewingTag(t)}`;
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
