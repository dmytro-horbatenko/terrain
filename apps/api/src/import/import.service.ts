import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { parseLearningOs, type LearningOsOutput } from '@terrain/types';
import { sm2, type SRState } from '@terrain/sr-engine';
import type { SessionExport, Topic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildReviewWrites } from '../reviews/sr-apply';

const norm = (s: string) => s.trim().toLowerCase();
const DEFAULT_SR: SRState = { easeFactor: 2.5, interval: 0, repetitions: 0, nextReviewAt: null };

export interface SrPreview {
  intervalBefore: number;
  intervalAfter: number;
  nextReviewAt: Date;
}
export interface ResolvedReview {
  topicTitle: string;
  topicId: string | null;
  quality: number;
  note?: string;
  resolvedTopicId: string | null;
  srPreview?: SrPreview;
}
export interface NewTopicPlan {
  title: string;
  topicType: string;
  domain: string;
  description?: string;
  prerequisiteTitles: string[];
  parentTitle: string | null;
  aiContext?: string;
  alreadyExists: boolean;
}
export interface NoteSummaryPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  composedSummary: string;
  suggestedNoteRef?: string;
}
export interface NewPromptPlan {
  topicTitle: string;
  promptText: string;
  answerHint?: string;
  promptKind: string;
}
export interface Unresolved {
  kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent' | 'prompt';
  title: string;
  context: string;
  reason: 'missing' | 'ambiguous' | 'self-reference';
}
export interface ImportPlan {
  sessionExportId: string;
  alreadyImported: boolean;
  reviews: ResolvedReview[];
  newTopics: NewTopicPlan[];
  newPrompts: NewPromptPlan[];
  noteSummaries: NoteSummaryPlan[];
  nextSession?: { focusTitle?: string; coldChallenge?: string };
  unresolved: Unresolved[];
  applicable: boolean;
}
export interface ImportResult {
  sessionExportId: string;
  reviewsApplied: number;
  topicsCreated: string[];
  noteSummariesApplied: number;
  nextSessionStored: boolean;
}

export function composeSummary(ns: {
  keyInsight: string;
  invariant?: string;
  contradiction?: string;
}): string {
  const parts = [`**Key insight:** ${ns.keyInsight}`];
  if (ns.invariant) parts.push(`**Invariant:** ${ns.invariant}`);
  if (ns.contradiction) parts.push(`**Watch out:** ${ns.contradiction}`);
  return parts.join('\n\n');
}

function stateFromTopic(t: Topic): SRState {
  return {
    easeFactor: t.easeFactor,
    interval: t.interval,
    repetitions: t.repetitions,
    nextReviewAt: t.nextReviewAt,
  };
}

@Injectable()
export class ImportService {
  constructor(protected prisma: PrismaService) {}

  protected now(): Date {
    return new Date();
  }

  protected async load(
    userId: string,
    raw: string,
  ): Promise<{ parsed: LearningOsOutput; sessionExport: SessionExport; existing: Topic[] }> {
    let parsed: LearningOsOutput;
    try {
      parsed = parseLearningOs(raw);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Invalid learning-os block.');
    }
    const sessionExport = await this.prisma.sessionExport.findFirst({
      where: { id: parsed.sessionId, userId },
    });
    if (!sessionExport) throw new NotFoundException(`SessionExport ${parsed.sessionId} not found`);
    const existing = await this.prisma.topic.findMany({ where: { userId } });
    return { parsed, sessionExport, existing };
  }

  async preview(userId: string, raw: string): Promise<ImportPlan> {
    const { parsed, sessionExport, existing } = await this.load(userId, raw);
    return this.buildPlan(parsed, sessionExport, existing);
  }

  async apply(userId: string, raw: string): Promise<ImportResult> {
    const { parsed, sessionExport, existing } = await this.load(userId, raw);
    const plan = this.buildPlan(parsed, sessionExport, existing);
    if (plan.alreadyImported)
      throw new ConflictException('This session export was already imported.');
    if (plan.unresolved.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Unresolved references block import.',
        unresolved: plan.unresolved,
      });
    }

    const now = this.now();
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.sessionExport.updateMany({
        where: { id: sessionExport.id, userId, importedAt: null },
        data: { importedAt: now },
      });
      if (claim.count === 0)
        throw new ConflictException('This session export was already imported.');

      const idByNorm = new Map<string, string>();
      for (const t of existing) idByNorm.set(norm(t.title), t.id);

      // a. create new topics (+ register type) for those that don't already exist
      const topicsCreated: string[] = [];
      for (const nt of plan.newTopics) {
        if (nt.alreadyExists) continue;
        const key = norm(nt.topicType);
        await tx.topicType.upsert({
          where: { userId_key: { userId, key } },
          update: {},
          create: { userId, key, label: nt.topicType.trim() },
        });
        const created = await tx.topic.create({
          data: {
            title: nt.title,
            domain: nt.domain,
            topicType: nt.topicType,
            description: nt.description,
            userId,
            aiProposed: true,
            aiContext: nt.aiContext,
            status: 'planned',
          },
        });
        idByNorm.set(norm(nt.title), created.id);
        topicsCreated.push(created.id);
      }

      // b. wire links (newly-created topics only)
      for (const nt of plan.newTopics) {
        if (nt.alreadyExists) continue;
        const selfId = idByNorm.get(norm(nt.title))!;
        if (nt.parentTitle) {
          const parentId = idByNorm.get(norm(nt.parentTitle));
          if (parentId && parentId !== selfId)
            await tx.topic.update({ where: { id: selfId }, data: { parentId } });
        }
        const seenPre = new Set<string>();
        for (const pre of nt.prerequisiteTitles) {
          const preId = idByNorm.get(norm(pre));
          if (!preId || preId === selfId || seenPre.has(preId)) continue;
          seenPre.add(preId);
          await tx.prerequisite.create({ data: { topicId: selfId, prerequisiteId: preId } });
        }
      }

      // c. create prompts against resolved topics (existing or just-created)
      for (const np of plan.newPrompts) {
        const topicId = idByNorm.get(norm(np.topicTitle));
        if (!topicId) continue; // unresolved already blocked apply() earlier
        await tx.prompt.create({
          data: {
            topicId,
            promptText: np.promptText,
            answerHint: np.answerHint,
            promptKind: np.promptKind,
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
            nextReviewAt: null,
          },
        });
      }

      // d. apply reviews sequentially (re-read so multiple reviews on one topic compound)
      let reviewsApplied = 0;
      for (const r of plan.reviews) {
        const id = r.resolvedTopicId ?? idByNorm.get(norm(r.topicTitle));
        if (!id) continue;
        const topic = await tx.topic.findUnique({ where: { id } });
        if (!topic) continue;
        const writes = buildReviewWrites(topic, r.quality, 'claude_session', r.note, now);
        await tx.review.create({ data: writes.review });
        await tx.topic.update({ where: { id }, data: writes.topic });
        reviewsApplied++;
      }

      // e. apply note summaries
      let noteSummariesApplied = 0;
      for (const ns of plan.noteSummaries) {
        const id = ns.resolvedTopicId ?? idByNorm.get(norm(ns.topicTitle));
        if (!id) continue;
        await tx.topic.update({
          where: { id },
          data: {
            summary: ns.composedSummary,
            ...(ns.suggestedNoteRef ? { noteRef: ns.suggestedNoteRef } : {}),
          },
        });
        noteSummariesApplied++;
      }

      // f. stamp the originating SessionExport + store nextSession
      const focusTitle = plan.nextSession?.focusTitle;
      const coldChallenge = plan.nextSession?.coldChallenge;
      const nextFocusTitle = focusTitle && focusTitle.trim().length > 0 ? focusTitle : null;
      const nextColdChallenge =
        coldChallenge && coldChallenge.trim().length > 0 ? coldChallenge : null;
      await tx.sessionExport.update({
        where: { id: sessionExport.id },
        data: {
          importedOutputRaw: raw,
          newTopicsCreated: topicsCreated,
          nextFocusTitle,
          nextColdChallenge,
        },
      });

      return {
        sessionExportId: sessionExport.id,
        reviewsApplied,
        topicsCreated,
        noteSummariesApplied,
        nextSessionStored: nextFocusTitle != null,
      };
    });
  }

  protected buildPlan(
    parsed: LearningOsOutput,
    sessionExport: SessionExport,
    existing: Topic[],
  ): ImportPlan {
    const byNorm = new Map<string, Topic[]>();
    for (const t of existing) {
      const k = norm(t.title);
      (byNorm.get(k) ?? byNorm.set(k, []).get(k)!).push(t);
    }
    const byId = new Map(existing.map((t) => [t.id, t]));
    const batchNorm = new Set(parsed.proposedTopics.map((p) => norm(p.title)));
    const unresolved: Unresolved[] = [];

    const resolveExisting = (title: string): { id: string | null; ambiguous: boolean } => {
      const m = byNorm.get(norm(title)) ?? [];
      if (m.length === 0) return { id: null, ambiguous: false };
      if (m.length > 1) return { id: null, ambiguous: true };
      return { id: m[0].id, ambiguous: false };
    };
    const inBatch = (title: string) => batchNorm.has(norm(title));

    const checkLink = (kind: 'parent' | 'prerequisite', title: string, ownerTitle: string) => {
      if (norm(title) === norm(ownerTitle)) {
        unresolved.push({
          kind,
          title,
          context: `proposedTopic "${ownerTitle}"`,
          reason: 'self-reference',
        });
        return;
      }
      const ex = resolveExisting(title);
      if (ex.ambiguous)
        unresolved.push({
          kind,
          title,
          context: `proposedTopic "${ownerTitle}"`,
          reason: 'ambiguous',
        });
      else if (ex.id == null && !inBatch(title))
        unresolved.push({
          kind,
          title,
          context: `proposedTopic "${ownerTitle}"`,
          reason: 'missing',
        });
    };

    const seenProposed = new Set<string>();
    const newTopics: NewTopicPlan[] = [];
    for (const p of parsed.proposedTopics) {
      const nk = norm(p.title);
      if (seenProposed.has(nk)) continue; // keep first occurrence only
      seenProposed.add(nk);
      const ex = resolveExisting(p.title);
      if (p.parentTitle) checkLink('parent', p.parentTitle, p.title);
      for (const pre of p.prerequisiteTitles) checkLink('prerequisite', pre, p.title);
      newTopics.push({
        title: p.title,
        topicType: p.type,
        domain: p.domain,
        description: p.description,
        prerequisiteTitles: p.prerequisiteTitles,
        parentTitle: p.parentTitle ?? null,
        aiContext: p.aiContext,
        alreadyExists: ex.id != null,
      });
    }

    const running = new Map<string, SRState>();
    const reviews: ResolvedReview[] = parsed.reviews.map((r) => {
      let resolvedTopicId: string | null = null;
      let stateKey: string | null = null;
      let base: SRState | null = null;
      if (r.topicId && byId.has(r.topicId)) {
        resolvedTopicId = r.topicId;
        stateKey = r.topicId;
        base = stateFromTopic(byId.get(r.topicId)!);
      } else {
        const ex = resolveExisting(r.topicTitle);
        if (ex.ambiguous) {
          unresolved.push({
            kind: 'review',
            title: r.topicTitle,
            context: 'review',
            reason: 'ambiguous',
          });
        } else if (ex.id != null) {
          resolvedTopicId = ex.id;
          stateKey = ex.id;
          base = stateFromTopic(byId.get(ex.id)!);
        } else if (inBatch(r.topicTitle)) {
          stateKey = 'batch:' + norm(r.topicTitle);
          base = DEFAULT_SR;
        } else {
          unresolved.push({
            kind: 'review',
            title: r.topicTitle,
            context: 'review',
            reason: 'missing',
          });
        }
      }
      let srPreview: SrPreview | undefined;
      if (stateKey && base) {
        const before = running.get(stateKey) ?? base;
        const after = sm2(r.quality, before, this.now());
        running.set(stateKey, after);
        srPreview = {
          intervalBefore: before.interval,
          intervalAfter: after.interval,
          nextReviewAt: after.nextReviewAt!,
        };
      }
      return {
        topicTitle: r.topicTitle,
        topicId: r.topicId ?? null,
        quality: r.quality,
        note: r.note,
        resolvedTopicId,
        srPreview,
      };
    });

    const noteSummaries: NoteSummaryPlan[] = parsed.noteSummaries.map((ns) => {
      const ex = resolveExisting(ns.topicTitle);
      let resolvedTopicId: string | null = null;
      if (ex.ambiguous)
        unresolved.push({
          kind: 'noteSummary',
          title: ns.topicTitle,
          context: 'noteSummary',
          reason: 'ambiguous',
        });
      else if (ex.id != null) resolvedTopicId = ex.id;
      else if (!inBatch(ns.topicTitle))
        unresolved.push({
          kind: 'noteSummary',
          title: ns.topicTitle,
          context: 'noteSummary',
          reason: 'missing',
        });
      return {
        topicTitle: ns.topicTitle,
        resolvedTopicId,
        composedSummary: composeSummary(ns),
        suggestedNoteRef: ns.suggestedNoteRef,
      };
    });

    const newPrompts: NewPromptPlan[] = parsed.proposedPrompts.map((p) => {
      const ex = resolveExisting(p.topicTitle);
      if (ex.ambiguous)
        unresolved.push({
          kind: 'prompt',
          title: p.topicTitle,
          context: 'proposedPrompt',
          reason: 'ambiguous',
        });
      else if (ex.id == null && !inBatch(p.topicTitle))
        unresolved.push({
          kind: 'prompt',
          title: p.topicTitle,
          context: 'proposedPrompt',
          reason: 'missing',
        });
      return {
        topicTitle: p.topicTitle,
        promptText: p.promptText,
        answerHint: p.answerHint,
        promptKind: p.promptKind,
      };
    });

    const alreadyImported = sessionExport.importedAt != null;
    return {
      sessionExportId: sessionExport.id,
      alreadyImported,
      reviews,
      newTopics,
      newPrompts,
      noteSummaries,
      nextSession: parsed.nextSession,
      unresolved,
      applicable: unresolved.length === 0 && !alreadyImported,
    };
  }
}
