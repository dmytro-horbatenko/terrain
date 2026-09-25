import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CardState, PromptKind, ReviewGrade, Topic, TopicStatus } from '@prisma/client';
import {
  learningContextSchema,
  parseLearningOs,
  skillCheckEvidence,
  type Grade,
  type LearningContext,
} from '@terrain/types';
import type { NextUp } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  canReuseSourceEvidence,
  parseStoredSourcePlan,
  sourcePlanStats,
} from '../sources/source-plan';
import { recommendApproach } from './approach';
import { buildRoadmapPolicy, type RoadmapEligibility } from './roadmap-policy';

type LoadedPrompt = {
  id: string;
  promptKind: PromptKind;
  promptText: string;
  state: CardState;
  difficulty: number | null;
  stability: number | null;
  suspended: boolean;
};

type LoadedTopic = Topic & {
  prerequisites: { prerequisiteId: string }[];
  prompts: LoadedPrompt[];
};

type Selection = {
  targetId: string | null;
  source: LearningContext['selection']['source'];
  importedFocus: LearningContext['selection']['importedFocus'];
  graph: LoadedTopic[];
  policy: Map<string, RoadmapEligibility>;
  scopeIds: Set<string>;
};

type ReviewEvidence = {
  topicId: string;
  grade: ReviewGrade;
  reviewedAt: Date;
  promptId: string | null;
  note?: string | null;
};

type CompactEvidence = LearningContext['mayRelyOn'][number]['evidence'];

const normalizeTitle = (value: string) => value.trim().toLowerCase();
const learned = (status: TopicStatus) => status === 'active' || status === 'mastered';
const malformedRoadmapData = (policy: RoadmapEligibility) =>
  policy.cycle || policy.malformedParent || policy.unavailablePrerequisite;

@Injectable()
export class LearningContextService {
  constructor(private readonly prisma: PrismaService) {}

  private async select(userId: string, topic?: string, domain?: string): Promise<Selection> {
    const [settings, graph, imported] = await Promise.all([
      this.prisma.settings.findUnique({
        where: { userId },
        select: { disabledDomains: true },
      }),
      this.prisma.topic.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          userId: true,
          title: true,
          domain: true,
          topicType: true,
          status: true,
          description: true,
          summary: true,
          noteRef: true,
          parentId: true,
          nextReviewAt: true,
          learnedAt: true,
          aiProposed: true,
          aiContext: true,
          curriculumOrder: true,
          sourcePlan: true,
          createdAt: true,
          updatedAt: true,
          prerequisites: { select: { prerequisiteId: true } },
          prompts: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              promptKind: true,
              promptText: true,
              state: true,
              difficulty: true,
              stability: true,
              suspended: true,
            },
          },
        },
      }),
      topic
        ? Promise.resolve(null)
        : this.prisma.sessionExport.findFirst({
            where: {
              userId,
              mode: 'learn',
              importedAt: { not: null },
            },
            orderBy: { importedAt: 'desc' },
            select: { nextFocusTitle: true, importedOutputRaw: true },
          }),
    ]);
    // Bulk creation timestamps can tie. Sort prepared topics within their existing
    // domain slots, leaving custom topics and the relative domain placement intact.
    const authored = new Map<string, LoadedTopic[]>();
    for (const node of graph) {
      if (node.curriculumOrder != null) {
        const items = authored.get(node.domain) ?? [];
        items.push(node);
        authored.set(node.domain, items);
      }
    }
    for (const items of authored.values())
      items.sort((a, b) => a.curriculumOrder! - b.curriculumOrder!);
    const cursors = new Map<string, number>();
    for (let index = 0; index < graph.length; index++) {
      const node = graph[index];
      if (node.curriculumOrder == null) continue;
      const cursor = cursors.get(node.domain) ?? 0;
      graph[index] = authored.get(node.domain)![cursor];
      cursors.set(node.domain, cursor + 1);
    }
    const policy = buildRoadmapPolicy(
      graph.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        status: node.status,
        prerequisiteIds: node.prerequisites.map((edge) => edge.prerequisiteId),
      })),
    );
    const disabledDomains = domain ? [] : (settings?.disabledDomains ?? []);
    const inScope = (candidate: LoadedTopic) =>
      domain ? candidate.domain === domain : !disabledDomains.includes(candidate.domain);
    const scopeIds = new Set(graph.filter(inScope).map(({ id }) => id));

    if (topic) {
      const byId = graph.find((candidate) => candidate.id === topic);
      const matches = byId
        ? [byId]
        : graph.filter((candidate) => normalizeTitle(candidate.title) === normalizeTitle(topic));
      if (matches.length > 1) {
        throw new ConflictException('More than one owned topic matches this title');
      }
      if (matches.length === 0) throw new NotFoundException(`Topic ${topic} not found`);
      return {
        targetId: matches[0].id,
        source: 'explicit',
        importedFocus: null,
        graph,
        policy,
        scopeIds,
      };
    }

    const candidates = graph.filter(
      (candidate) =>
        inScope(candidate) &&
        candidate.status === 'planned' &&
        this.sessionEligible(candidate, policy),
    );
    const importedTitle = imported?.nextFocusTitle?.trim();
    if (importedTitle) {
      const completedInImport = (() => {
        if (!imported?.importedOutputRaw) return false;
        try {
          return (parseLearningOs(imported.importedOutputRaw).studiedTopics ?? []).some(
            (title) => normalizeTitle(title) === normalizeTitle(importedTitle),
          );
        } catch {
          return false;
        }
      })();
      if (completedInImport) {
        return {
          targetId: candidates[0]?.id ?? null,
          source: candidates.length ? 'authored-order' : 'none',
          importedFocus: null,
          graph,
          policy,
          scopeIds,
        };
      }
      const matches = graph.filter(
        (candidate) => normalizeTitle(candidate.title) === normalizeTitle(importedTitle),
      );
      const accepted =
        matches.length === 1 && inScope(matches[0]) && this.sessionEligible(matches[0], policy);
      if (accepted) {
        return {
          targetId: matches[0].id,
          source: 'imported-focus',
          importedFocus: {
            title: importedTitle,
            accepted: true,
            reason:
              matches[0].status === 'planned'
                ? 'Accepted as a learnable planned leaf.'
                : 'Accepted as a previously studied leaf to continue.',
          },
          graph,
          policy,
          scopeIds,
        };
      }
      const reason =
        matches.length === 1
          ? this.rejectionReason(matches[0], graph, policy, inScope)
          : matches.length > 1
            ? 'The imported title is ambiguous in owned legacy data.'
            : 'No owned topic matches the imported title.';
      return {
        targetId: candidates[0]?.id ?? null,
        source: candidates.length ? 'authored-order' : 'none',
        importedFocus: {
          title: importedTitle,
          accepted: false,
          reason,
        },
        graph,
        policy,
        scopeIds,
      };
    }
    return {
      targetId: candidates[0]?.id ?? null,
      source: candidates.length ? 'authored-order' : 'none',
      importedFocus: null,
      graph,
      policy,
      scopeIds,
    };
  }

  private rejectionReason(
    topic: LoadedTopic,
    graph: LoadedTopic[],
    policy: Map<string, RoadmapEligibility>,
    inScope: (topic: LoadedTopic) => boolean,
  ): string {
    if (!inScope(topic)) return `${topic.title} is outside the enabled domain scope.`;
    const eligibility = policy.get(topic.id);
    if (eligibility?.cycle) return `${topic.title} belongs to a hierarchy cycle.`;
    if (eligibility?.malformedParent) return `${topic.title} has an unavailable parent.`;
    if (eligibility?.unavailablePrerequisite) {
      return `${topic.title} has an unavailable prerequisite.`;
    }
    if (eligibility?.kind === 'group') return `${topic.title} is a group, not a leaf.`;
    if (learned(topic.status)) return `${topic.title} has unavailable or cyclic prerequisite data.`;
    if (topic.status !== 'planned') return `${topic.title} is ${topic.status}, not planned.`;
    const blockerId = eligibility?.blockerIds[0];
    if (blockerId) {
      const blocker = policy.get(blockerId);
      const title =
        graph.find((candidate) => candidate.id === blockerId)?.title ?? 'Unavailable prerequisite';
      return blocker
        ? `${title} is incomplete (${blocker.learnedLeaves}/${blocker.totalLeaves} leaves learned).`
        : `${title} is unavailable.`;
    }
    return `${topic.title} is not currently learnable.`;
  }

  async nextUp(userId: string, domain?: string, now = new Date()): Promise<NextUp | null> {
    const selection = await this.select(userId, undefined, domain);
    const topic = selection.graph.find(({ id }) => id === selection.targetId);
    if (!topic) return null;
    const { prerequisites: _prerequisites, prompts: _prompts, ...topicScalars } = topic;
    const sourcePlan = parseStoredSourcePlan(topic.sourcePlan);
    const sourceStats = sourcePlanStats(sourcePlan, topic.status, now);
    const parent = topic.parentId
      ? selection.graph.find(({ id }) => id === topic.parentId)
      : undefined;
    if (!parent) {
      return {
        topic: topicScalars,
        chapterTitle: null,
        chapterProgress: null,
        sourcePlanStats: sourceStats,
      };
    }
    const children = selection.graph.filter(({ parentId }) => parentId === parent.id);
    return {
      topic: topicScalars,
      chapterTitle: parent.title,
      chapterProgress: {
        started: children.filter(({ status }) => learned(status)).length,
        total: children.length,
      },
      sourcePlanStats: sourceStats,
    };
  }

  async context(
    userId: string,
    options: { topic?: string; domain?: string; now?: Date } = {},
  ): Promise<LearningContext> {
    const now = options.now ?? new Date();
    const selection = await this.select(userId, options.topic, options.domain);
    const byId = new Map(selection.graph.map((topic) => [topic.id, topic]));
    const target = selection.targetId ? byId.get(selection.targetId) : undefined;
    const relevantIds = target ? this.relevantIds(target, selection.policy) : [];
    const targetPromptIds =
      target?.prompts.filter((prompt) => !prompt.suspended).map((prompt) => prompt.id) ?? [];
    const [
      learner,
      reviewGroups,
      sourceEvidence,
      applicationEvents,
      continuation,
      targetReviews,
      skillCheckGroups,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          headline: true,
          learningStyle: true,
          codeStyle: true,
          noteSystem: true,
        },
      }),
      Promise.all(
        relevantIds.map((topicId) =>
          this.prisma.review.findMany({
            where: { userId, topicId },
            orderBy: { reviewedAt: 'desc' },
            take: 3,
            select: {
              topicId: true,
              grade: true,
              reviewedAt: true,
              promptId: true,
            },
          }),
        ),
      ),
      this.prisma.sourceEvidence.findMany({
        where: { userId, topicId: { in: relevantIds } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.applicationEvent.findMany({
        where: { userId, topicId: { in: relevantIds } },
        orderBy: { appliedAt: 'desc' },
        select: { topicId: true, description: true, url: true, appliedAt: true },
      }),
      target ? this.studyContinuation(userId, target, selection.graph) : Promise.resolve(null),
      targetPromptIds.length
        ? this.prisma.review.findMany({
            where: { userId, topicId: target!.id, promptId: { in: targetPromptIds } },
            distinct: ['promptId'],
            orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
            select: { topicId: true, promptId: true, grade: true, reviewedAt: true, note: true },
          })
        : Promise.resolve([]),
      Promise.all(
        relevantIds.map(async (topicId) => ({
          topicId,
          checks: (
            await this.prisma.skillCheck.findMany({
              where: { userId, topicId, assessedAt: { not: null }, cancelledAt: null },
              orderBy: [{ assessedAt: 'desc' }, { id: 'desc' }],
              take: 3,
              select: { plan: true, attempt: true, result: true, attemptedAt: true },
            })
          ).flatMap(skillCheckEvidence),
        })),
      ),
    ]);
    const reviews = reviewGroups.flat() as ReviewEvidence[];
    const evidenceFor = (topicId: string): CompactEvidence => {
      const topicReviews = reviews.filter((review) => review.topicId === topicId);
      const topicSources = sourceEvidence.filter((row) => row.topicId === topicId);
      const applications = applicationEvents.filter((row) => row.topicId === topicId);
      return {
        recentGrades: topicReviews.map((review) => review.grade as Grade),
        lastReviewedAt: topicReviews[0]?.reviewedAt.toISOString() ?? null,
        sourceTitles: [...new Set(topicSources.map((row) => row.sourceTitle))],
        applicationCount: applications.length,
        latestApplication: applications[0]?.description ?? null,
        skillChecks: skillCheckGroups.find((group) => group.topicId === topicId)?.checks ?? [],
      };
    };
    const prerequisiteIds = target ? this.prerequisiteIds(target.id, selection.policy) : [];
    const knowledge = prerequisiteIds.flatMap((id) => {
      const prerequisite = byId.get(id);
      if (!prerequisite || selection.policy.get(id)?.kind === 'group') return [];
      const evidence = evidenceFor(id);
      const level = this.knowledgeLevel(prerequisite, evidence);
      return [
        {
          id,
          title: prerequisite.title,
          status: prerequisite.status,
          level,
          reason: this.knowledgeReason(level, prerequisite.status, evidence),
          summary: prerequisite.summary,
          evidence,
        },
      ];
    });
    const targetSources = sourceEvidence.filter((row) => row.topicId === target?.id);
    const sourcePlan = target ? parseStoredSourcePlan(target.sourcePlan) : null;
    const reusable = (row: (typeof sourceEvidence)[number]) =>
      !!target && canReuseSourceEvidence(sourcePlan, target.status, row, now);
    const sourceProgress = [...new Set(targetSources.map((row) => row.requirementId))].map(
      (requirementId) => {
        const matches = targetSources.filter((row) => row.requirementId === requirementId);
        const row = matches.find(reusable) ?? matches[0];
        return {
          requirementId,
          sourceTitle: row.sourceTitle,
          sourceUrl: row.sourceUrl,
          mainClaim: row.mainClaim,
          supportingMechanism: row.supportingMechanism,
          openQuestion: row.openQuestion,
          recordedAt: row.createdAt.toISOString(),
          reusable: reusable(row),
        };
      },
    );
    const result: LearningContext = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      learner: {
        role: learner?.headline ?? null,
        learningStyle: learner?.learningStyle ?? null,
        codeStyle: learner?.codeStyle ?? null,
        noteSystem: learner?.noteSystem ?? null,
      },
      target: target
        ? {
            ...this.targetContext(
              target,
              selection,
              reviews,
              byId,
              now,
              targetReviews,
              sourceProgress
                .filter((source) => source.reusable)
                .map((source) => source.requirementId),
            ),
            continuation,
            sourceProgress,
            skillChecks: evidenceFor(target.id).skillChecks,
            applications: applicationEvents
              .filter((row) => row.topicId === target.id)
              .slice(0, 3)
              .map((row) => ({
                description: row.description,
                url: row.url,
                appliedAt: row.appliedAt.toISOString(),
              })),
          }
        : null,
      selection: {
        source: selection.source,
        importedFocus: selection.importedFocus,
        learnableAlternatives: selection.graph.flatMap((candidate) => {
          if (
            candidate.id === selection.targetId ||
            !selection.scopeIds.has(candidate.id) ||
            candidate.status !== 'planned' ||
            !this.sessionEligible(candidate, selection.policy)
          ) {
            return [];
          }
          const parent = candidate.parentId ? byId.get(candidate.parentId) : undefined;
          return [
            {
              id: candidate.id,
              title: candidate.title,
              chapterTitle: parent?.title ?? null,
            },
          ];
        }),
      },
      prerequisites: target
        ? (selection.policy.get(target.id)?.effectivePrerequisiteIds ?? []).flatMap(
            (prerequisiteId) => {
              const prerequisite = this.prerequisiteContext(
                prerequisiteId,
                selection,
                evidenceFor,
                new Set([target.id]),
              );
              return prerequisite ? [prerequisite] : [];
            },
          )
        : [],
      mayRelyOn: knowledge.filter(({ level }) => level === 'practicing' || level === 'mastered'),
      doNotAssume: knowledge.filter(({ level }) => level !== 'practicing' && level !== 'mastered'),
      blockers: target ? this.blockers(target, selection) : this.noTargetBlockers(selection),
    };
    return learningContextSchema.parse(result);
  }

  private async studyContinuation(
    userId: string,
    target: LoadedTopic,
    graph: LoadedTopic[],
  ): Promise<NonNullable<LearningContext['target']>['continuation']> {
    // Saved next steps identify their destination by title, even for ID-selected topics.
    if (
      graph.filter((topic) => normalizeTitle(topic.title) === normalizeTitle(target.title))
        .length !== 1
    ) {
      return null;
    }
    const sessions = await this.prisma.sessionExport.findMany({
      where: {
        userId,
        mode: 'learn',
        importedAt: { not: null },
        OR: [
          { focusTopicId: target.id },
          { nextFocusTitle: { contains: target.title.trim(), mode: 'insensitive' } },
        ],
      },
      orderBy: [{ importedAt: 'desc' }, { generatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        focusTopicId: true,
        nextFocusTitle: true,
        nextColdChallenge: true,
        importedAt: true,
      },
    });
    // ponytail: legacy titles need trimming in memory; store a next-topic ID if
    // per-topic histories grow too large to load these compact candidate rows.
    const matchesTitle = (title: string | null) =>
      title != null && normalizeTitle(title) === normalizeTitle(target.title);
    const latest = sessions.find(
      (session) => session.focusTopicId === target.id || matchesTitle(session.nextFocusTitle),
    );
    const challenge = latest?.nextColdChallenge?.trim();
    // A newer same-topic session may finish or redirect the work. Do not revive
    // an older challenge after that session has cleared it.
    if (!latest?.importedAt || !matchesTitle(latest.nextFocusTitle) || !challenge) return null;
    return {
      sessionId: latest.id,
      importedAt: latest.importedAt.toISOString(),
      coldChallenge: challenge,
      resuming: latest.focusTopicId === target.id,
    };
  }

  private relevantIds(target: LoadedTopic, policy: Map<string, RoadmapEligibility>): string[] {
    return [target.id, ...this.prerequisiteIds(target.id, policy)];
  }

  private sessionEligible(target: LoadedTopic, policy: Map<string, RoadmapEligibility>): boolean {
    const targetPolicy = policy.get(target.id)!;
    return (
      targetPolicy.kind === 'leaf' &&
      (targetPolicy.learnable || learned(target.status)) &&
      this.relevantIds(target, policy).every((id) => !malformedRoadmapData(policy.get(id)!))
    );
  }

  private prerequisiteIds(targetId: string, policy: Map<string, RoadmapEligibility>): string[] {
    const result: string[] = [];
    const visited = new Set<string>([targetId]);
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const topicPolicy = policy.get(id);
      if (!topicPolicy) return;
      result.push(id);
      if (topicPolicy.kind === 'group') {
        for (const leafId of topicPolicy.leafIds) visit(leafId);
      }
      for (const prerequisiteId of topicPolicy.effectivePrerequisiteIds) visit(prerequisiteId);
    };
    for (const prerequisiteId of policy.get(targetId)?.effectivePrerequisiteIds ?? []) {
      visit(prerequisiteId);
    }
    return result;
  }

  private knowledgeLevel(
    topic: LoadedTopic,
    evidence: CompactEvidence,
  ): LearningContext['mayRelyOn'][number]['level'] {
    if (topic.status === 'planned' || topic.status === 'archived') return 'unseen';
    if (
      evidence.recentGrades.includes('again') ||
      evidence.skillChecks?.[0]?.outcome === 'needs_practice'
    ) {
      return 'needs_verification';
    }
    if (topic.status === 'mastered') return 'mastered';
    return evidence.recentGrades.length ||
      evidence.sourceTitles.length ||
      topic.summary ||
      evidence.applicationCount
      ? 'practicing'
      : 'introduced';
  }

  private knowledgeReason(
    level: LearningContext['mayRelyOn'][number]['level'],
    status: TopicStatus,
    evidence: CompactEvidence,
  ): string {
    if (level === 'needs_verification') {
      return evidence.skillChecks?.[0]?.outcome === 'needs_practice'
        ? 'The latest independent check needs practice; verify the recorded gap before relying on it. Historical progress is preserved.'
        : 'A failed recall appears in the last three attempts; verify that concept before relying on it. Historical progress is preserved.';
    }
    if (level === 'mastered')
      return 'Recorded as mastered under the progress criteria; use the dated evidence and verify transfer to a changed task.';
    if (level === 'practicing')
      return 'Recorded evidence shows prior practice, not guaranteed independent competence; calibrate to the task.';
    if (level === 'introduced') return 'Active but unevidenced; verify it before relying on it.';
    return status === 'archived'
      ? 'Archived; verify or reteach it before relying on it.'
      : 'Not yet learned; teach it before relying on it.';
  }

  private targetContext(
    target: LoadedTopic,
    selection: Selection,
    reviews: ReviewEvidence[],
    byId: Map<string, LoadedTopic>,
    now: Date,
    targetReviews: ReviewEvidence[],
    creditedRequirementIds: string[],
  ): NonNullable<LearningContext['target']> {
    const targetPolicy = selection.policy.get(target.id)!;
    const directIds = new Set(this.relevantIds(target, selection.policy));
    const approachReviews = reviews.filter((review) => directIds.has(review.topicId));
    const activePrompts = target.prompts.filter(({ suspended }) => !suspended);
    const parent = target.parentId ? byId.get(target.parentId) : undefined;
    const parentPolicy = parent ? selection.policy.get(parent.id) : undefined;
    return {
      id: target.id,
      title: target.title,
      domain: target.domain,
      topicType: target.topicType,
      kind: targetPolicy.kind,
      sessionEligible: this.sessionEligible(target, selection.policy),
      status: target.status,
      description: target.description,
      summary: target.summary ?? null,
      studyContext: target.aiContext ?? null,
      noteRef: target.noteRef ?? null,
      sourcePlan: parseStoredSourcePlan(target.sourcePlan),
      chapter:
        parent && parentPolicy
          ? {
              id: parent.id,
              title: parent.title,
              learnedLeaves: parentPolicy.learnedLeaves,
              totalLeaves: parentPolicy.totalLeaves,
            }
          : null,
      approach: recommendApproach({
        plan: parseStoredSourcePlan(target.sourcePlan),
        creditedRequirementIds,
        status: target.status,
        now,
        recentGrades: approachReviews.map((review) => review.grade as Grade),
        promptKinds: activePrompts.map((prompt) => prompt.promptKind),
      }),
      prompts: activePrompts.map((prompt) => {
        const lastReview = targetReviews.find((review) => review.promptId === prompt.id);
        return {
          id: prompt.id,
          kind: prompt.promptKind,
          text: prompt.promptText,
          state: prompt.state,
          difficulty: prompt.difficulty,
          stability: prompt.stability,
          lastGrade: (lastReview?.grade as Grade | undefined) ?? null,
          lastReviewedAt: lastReview?.reviewedAt.toISOString() ?? null,
          lastReviewNote: lastReview?.note ?? null,
        };
      }),
    };
  }

  private prerequisiteContext(
    id: string,
    selection: Selection,
    evidenceFor: (topicId: string) => CompactEvidence,
    path: Set<string>,
    includeDependencies = true,
  ): LearningContext['prerequisites'][number] | null {
    const topic = selection.graph.find((candidate) => candidate.id === id);
    const policy = selection.policy.get(id);
    if (!topic || !policy) return null;
    const cycle = path.has(id);
    const nextPath = new Set(path).add(id);
    return {
      id: topic.id,
      title: topic.title,
      status: topic.status,
      satisfied: !cycle && policy.satisfied,
      reason: cycle
        ? 'Prerequisite cycle detected; do not rely on this topic.'
        : policy.unavailablePrerequisite
          ? 'Prerequisite roadmap data is unavailable; do not rely on this topic.'
          : policy.malformedParent
            ? 'Prerequisite parent data is unavailable; do not rely on this topic.'
            : policy.satisfied
              ? 'This prerequisite is satisfied.'
              : `${policy.unfinishedLeafIds.length} prerequisite leaves remain unfinished.`,
      learnedLeaves: policy.learnedLeaves,
      totalLeaves: policy.totalLeaves,
      summary: topic.summary,
      evidence: evidenceFor(id),
      children: cycle
        ? []
        : (policy.kind === 'group'
            ? policy.leafIds
            : includeDependencies
              ? policy.effectivePrerequisiteIds
              : []
          ).flatMap((prerequisiteId) => {
            const child = this.prerequisiteContext(
              prerequisiteId,
              selection,
              evidenceFor,
              nextPath,
              policy.kind !== 'group',
            );
            return child ? [child] : [];
          }),
    };
  }

  private blockers(target: LoadedTopic, selection: Selection): LearningContext['blockers'] {
    const policy = selection.policy.get(target.id)!;
    if (policy.cycle) {
      return [
        {
          topicId: target.id,
          title: target.title,
          reason: 'The topic hierarchy contains a cycle.',
        },
      ];
    }
    const blockers: LearningContext['blockers'] = [];
    if (policy.unavailablePrerequisite) {
      blockers.push({
        topicId: target.id,
        title: 'Unavailable prerequisite',
        reason: 'A prerequisite is unavailable in the owned roadmap.',
      });
    }
    if (policy.malformedParent) {
      blockers.push({
        topicId: target.id,
        title: 'Unavailable parent',
        reason: 'The parent is unavailable in the owned roadmap.',
      });
    }
    if (policy.kind === 'group') {
      blockers.push({
        topicId: target.id,
        title: target.title,
        reason: 'Groups are diagnostic only; choose a learnable leaf.',
        learnedLeaves: policy.learnedLeaves,
        totalLeaves: policy.totalLeaves,
      });
    }
    if (target.status === 'archived') {
      blockers.push({
        topicId: target.id,
        title: target.title,
        reason: 'Archived topics are not session eligible.',
      });
    }
    const blockerIds = new Set([
      ...policy.blockerIds,
      ...this.prerequisiteIds(target.id, selection.policy).filter((id) =>
        malformedRoadmapData(selection.policy.get(id)!),
      ),
    ]);
    blockers.push(...[...blockerIds].map((blockerId) => this.blocker(blockerId, selection)));
    return blockers;
  }

  private blocker(blockerId: string, selection: Selection): LearningContext['blockers'][number] {
    const topic = selection.graph.find((candidate) => candidate.id === blockerId)!;
    const policy = selection.policy.get(blockerId)!;
    return {
      topicId: topic.id,
      title: topic.title,
      reason: policy.cycle
        ? 'The prerequisite hierarchy contains a cycle.'
        : policy.unavailablePrerequisite
          ? 'Prerequisite roadmap data is unavailable.'
          : policy.malformedParent
            ? 'Prerequisite parent data is unavailable.'
            : `${policy.unfinishedLeafIds.length} prerequisite leaves remain unfinished.`,
      learnedLeaves: policy.learnedLeaves,
      totalLeaves: policy.totalLeaves,
      unfinishedLeaves: policy.unfinishedLeafIds.flatMap((id) => {
        const leaf = selection.graph.find((candidate) => candidate.id === id);
        return leaf ? [{ id: leaf.id, title: leaf.title, status: leaf.status }] : [];
      }),
    };
  }

  private noTargetBlockers(selection: Selection): LearningContext['blockers'] {
    return selection.graph
      .filter(
        (topic) =>
          topic.status === 'planned' &&
          selection.scopeIds.has(topic.id) &&
          !this.sessionEligible(topic, selection.policy),
      )
      .flatMap((topic) => this.blockers(topic, selection));
  }
}
