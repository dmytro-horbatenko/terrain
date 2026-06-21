import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LearningOsParseError, parseLearningOs, type LearningOsV2 } from '@terrain/types';
import { applyGrade, type CardSrState, type Grade } from '@terrain/sr-engine';
import type { Prompt, ReviewMode, SessionExport, Topic } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildCardReviewWrites,
  buildEvidenceReviewWrite,
  recomputeTopicDue,
} from '../reviews/sr-apply';
import { STARTER_CARD_DATA } from '../prompts/starter-card';

const norm = (s: string) => s.trim().toLowerCase();
const DAY = 86_400_000;
// Same day-rounding formula as sr-apply.ts's reviewCreate.intervalBefore/After
// — kept local (not exported there) since it's only needed here for a
// display-only preview, not a DB write.
const daysBetween = (a: Date | null, b: Date | null) =>
  a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY)) : 0;
// Import always represents a Claude session transcript being replayed.
const IMPORT_MODE: ReviewMode = 'claude_session';

export interface CardPreview {
  intervalBefore: number;
  intervalAfter: number;
  nextReviewAt: Date | null;
}

/**
 * A card review (`reviews[].promptId` present in the v2 contract). The
 * prompt is resolved by id (scoped to the owning user) while building the
 * plan. `topicId`/`cardPreview` are only populated when resolution
 * succeeds; on a miss they stay null/undefined and a matching `Unresolved`
 * entry (`kind: 'prompt'`, `ref: promptId`) blocks `apply()`.
 */
export interface ResolvedCardReview {
  kind: 'card';
  promptId: string;
  topicId: string | null;
  grade: Grade;
  note?: string;
  cardPreview?: CardPreview;
}

/**
 * An evidence review (`reviews[].topicTitle` only, no `promptId`).
 * Resolved by title exactly like v1: `resolvedTopicId` is the existing
 * topic's id, or `null` both when the review targets a topic created in
 * this same import batch (re-resolved by title inside `apply()`'s
 * transaction, once the batch topic exists) and when the title is
 * unresolved (blocked separately via `unresolved`). Evidence reviews never
 * touch a Prompt row or a Topic's materialized `nextReviewAt` — there is
 * nothing to schedule.
 */
export interface ResolvedEvidenceReview {
  kind: 'evidence';
  topicTitle: string;
  resolvedTopicId: string | null;
  grade: Grade;
  note?: string;
}

export type ResolvedReview = ResolvedCardReview | ResolvedEvidenceReview;

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
// Aligned with the v2 contract's proposedPrompts entry type (packages/types)
// rather than duplicated/widened, so promptKind/problemDifficulty stay
// exactly the literal unions Prisma's Prompt columns expect.
type ProposedPromptV2 = LearningOsV2['proposedPrompts'][number];

export interface NewPromptPlan {
  topicTitle: string;
  promptText: string;
  answerHint?: string;
  promptKind: ProposedPromptV2['promptKind'];
  url?: string;
  problemDifficulty?: ProposedPromptV2['problemDifficulty'];
  estimatedMinutes?: number;
}

/**
 * An unresolved reference that blocks `apply()`.
 *
 * `kind: 'prompt'` is deliberately reused for two distinct cases,
 * disambiguated by which of `title`/`ref` is populated (never both):
 *  - `ref` set, `title` absent: a `reviews[].promptId` that didn't resolve
 *    via `prompt.findFirst` scoped to the user — a card-review miss.
 *  - `title` set, `ref` absent: a `proposedPrompts[].topicTitle` that
 *    didn't resolve to an existing or in-batch topic — unchanged from v1.
 * Every other `kind` (`review`/`noteSummary`/`prerequisite`/`parent`)
 * always uses `title` (a topic title); `ref` is unused there.
 */
export interface Unresolved {
  kind: 'review' | 'noteSummary' | 'prerequisite' | 'parent' | 'prompt';
  title?: string;
  ref?: string;
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
  nextSession?: LearningOsV2['nextSession'];
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

function cardStateFromPrompt(p: Prompt): CardSrState {
  return {
    stability: p.stability,
    difficulty: p.difficulty,
    reps: p.reps,
    lapses: p.lapses,
    state: p.state,
    lastReviewedAt: p.lastReviewedAt,
    nextReviewAt: p.nextReviewAt,
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
  ): Promise<{
    parsed: LearningOsV2;
    sessionExport: SessionExport;
    existing: Topic[];
    promptsById: Map<string, Prompt>;
  }> {
    let parsed: LearningOsV2;
    try {
      parsed = parseLearningOs(raw);
    } catch (e) {
      if (e instanceof LearningOsParseError) {
        // no-block / invalid-json: the raw text itself is malformed.
        if (e.code === 'no-block' || e.code === 'invalid-json') {
          throw new BadRequestException(e.message);
        }
        // unsupported-version / schema: well-formed JSON, semantically wrong.
        throw new UnprocessableEntityException(e.message);
      }
      throw e; // unexpected error type — a bug elsewhere, let it propagate/500
    }
    if (parsed.sessionId == null) {
      throw new NotFoundException('SessionExport id is required');
    }
    const sessionExport = await this.prisma.sessionExport.findFirst({
      where: { id: parsed.sessionId, userId },
    });
    if (!sessionExport) throw new NotFoundException(`SessionExport ${parsed.sessionId} not found`);
    const existing = await this.prisma.topic.findMany({ where: { userId } });

    // Resolve every reviews[].promptId in ONE batched query (not N+1),
    // scoped to this user so a miss also covers "not owned by this user".
    const promptIds = [
      ...new Set(parsed.reviews.map((r) => r.promptId).filter((id): id is string => id != null)),
    ];
    const promptsById = new Map<string, Prompt>();
    if (promptIds.length > 0) {
      const prompts = await this.prisma.prompt.findMany({
        where: { id: { in: promptIds }, topic: { userId } },
      });
      for (const p of prompts) promptsById.set(p.id, p);
    }

    return { parsed, sessionExport, existing, promptsById };
  }

  async preview(userId: string, raw: string): Promise<ImportPlan> {
    const { parsed, sessionExport, existing, promptsById } = await this.load(userId, raw);
    return this.buildPlan(parsed, sessionExport, existing, promptsById);
  }

  async apply(userId: string, raw: string): Promise<ImportResult> {
    const { parsed, sessionExport, existing, promptsById } = await this.load(userId, raw);
    const plan = this.buildPlan(parsed, sessionExport, existing, promptsById);
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

      // c. starter-card rule: a batch-created topic gets a starter card
      // unless it either (i) is some other batch topic's parent (a
      // category/root node), or (ii) is targeted by a proposedPrompts
      // entry in this batch (it already gets a real card). "Batch
      // children"/"batch prompts" only — existing-DB children/prompts
      // don't count (existing topics are never backfilled, and this rule
      // only fires for topics created in THIS import). Runs after link
      // wiring so the full batch parent/child structure is known; order
      // relative to steps d/e below doesn't matter for correctness —
      // starter cards are created with nextReviewAt: null (schema
      // default), so they can never move recomputeTopicDue's min.
      const batchParentTitles = new Set(
        plan.newTopics
          .filter((nt) => !nt.alreadyExists && nt.parentTitle)
          .map((nt) => norm(nt.parentTitle!)),
      );
      const batchPromptTargets = new Set(plan.newPrompts.map((np) => norm(np.topicTitle)));
      for (const nt of plan.newTopics) {
        if (nt.alreadyExists) continue;
        const key = norm(nt.title);
        if (batchParentTitles.has(key)) continue; // has batch children
        if (batchPromptTargets.has(key)) continue; // targeted by a batch prompt
        const topicId = idByNorm.get(key)!;
        await tx.prompt.create({ data: { topicId, ...STARTER_CARD_DATA(nt.title) } });
      }

      // d. create prompts for resolved proposedPrompts
      for (const np of plan.newPrompts) {
        const topicId = idByNorm.get(norm(np.topicTitle));
        if (!topicId) continue; // unresolved already blocked apply() earlier
        await tx.prompt.create({
          data: {
            topicId,
            promptText: np.promptText,
            answerHint: np.answerHint,
            promptKind: np.promptKind,
            url: np.url,
            problemDifficulty: np.problemDifficulty,
            estimatedMinutes: np.estimatedMinutes,
          },
        });
      }

      // e. apply reviews — card reviews re-read fresh Prompt state inside
      // the tx (so multiple reviews on the same card compound, mirroring
      // the topic re-read pattern below/previously); evidence reviews only
      // ever create a Review row. Dedupe recompute to one call per
      // distinct topicId touched by a card review.
      let reviewsApplied = 0;
      const touchedTopicIds = new Set<string>();
      for (const r of plan.reviews) {
        if (r.kind === 'card') {
          if (!r.topicId) continue; // unresolved, already blocked apply() earlier
          const prompt = await tx.prompt.findFirst({
            where: { id: r.promptId, topicId: r.topicId, topic: { userId } },
          });
          if (!prompt) continue;
          const { promptUpdate, reviewCreate } = buildCardReviewWrites({
            userId,
            topicId: r.topicId,
            prompt,
            grade: r.grade,
            mode: IMPORT_MODE,
            note: r.note,
            now,
          });
          await tx.prompt.update(promptUpdate);
          await tx.review.create({ data: reviewCreate });
          touchedTopicIds.add(r.topicId);
          reviewsApplied++;
        } else {
          const topicId = r.resolvedTopicId ?? idByNorm.get(norm(r.topicTitle));
          if (!topicId) continue; // unresolved, already blocked apply() earlier
          await tx.review.create({
            data: buildEvidenceReviewWrite({
              userId,
              topicId,
              grade: r.grade,
              mode: IMPORT_MODE,
              note: r.note,
              now,
            }),
          });
          reviewsApplied++;
        }
      }
      for (const topicId of touchedTopicIds) await recomputeTopicDue(tx, topicId);

      // f. apply note summaries
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

      // g. stamp the originating SessionExport + store nextSession
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
    parsed: LearningOsV2,
    sessionExport: SessionExport,
    existing: Topic[],
    promptsById: Map<string, Prompt>,
  ): ImportPlan {
    const now = this.now();
    const byNorm = new Map<string, Topic[]>();
    for (const t of existing) {
      const k = norm(t.title);
      (byNorm.get(k) ?? byNorm.set(k, []).get(k)!).push(t);
    }
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

    const running = new Map<string, CardSrState>();
    const reviews: ResolvedReview[] = parsed.reviews.map((r): ResolvedReview => {
      if (r.promptId) {
        const row = promptsById.get(r.promptId);
        if (!row) {
          unresolved.push({
            kind: 'prompt',
            ref: r.promptId,
            context: 'review',
            reason: 'missing',
          });
          return {
            kind: 'card',
            promptId: r.promptId,
            topicId: null,
            grade: r.grade,
            note: r.note,
          };
        }
        const before = running.get(r.promptId) ?? cardStateFromPrompt(row);
        const after = applyGrade(before, r.grade, now);
        running.set(r.promptId, after);
        return {
          kind: 'card',
          promptId: r.promptId,
          topicId: row.topicId,
          grade: r.grade,
          note: r.note,
          cardPreview: {
            intervalBefore: daysBetween(before.lastReviewedAt, before.nextReviewAt),
            intervalAfter: daysBetween(now, after.nextReviewAt),
            nextReviewAt: after.nextReviewAt,
          },
        };
      }

      const title = r.topicTitle!; // schema refine guarantees promptId or topicTitle
      const ex = resolveExisting(title);
      let resolvedTopicId: string | null = null;
      if (ex.ambiguous) {
        unresolved.push({ kind: 'review', title, context: 'review', reason: 'ambiguous' });
      } else if (ex.id != null) {
        resolvedTopicId = ex.id;
      } else if (!inBatch(title)) {
        unresolved.push({ kind: 'review', title, context: 'review', reason: 'missing' });
      }
      return { kind: 'evidence', topicTitle: title, resolvedTopicId, grade: r.grade, note: r.note };
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
        url: p.url,
        problemDifficulty: p.problemDifficulty,
        estimatedMinutes: p.estimatedMinutes,
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
