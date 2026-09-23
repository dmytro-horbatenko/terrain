import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LearningOsParseError,
  parseLearningOs,
  type LearningOsV2,
  type SourcePlan,
} from '@terrain/types';
import { applyGrade, type CardSrState, type Grade } from '@terrain/sr-engine';
import {
  Prisma,
  type Prompt,
  type ReviewMode,
  type SessionExport,
  type SourceEvidence,
  type Topic,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { buildRoadmapPolicy, type RoadmapNode } from '../learning/roadmap-policy';
import {
  buildCardReviewWrites,
  buildEvidenceReviewWrite,
  recomputeTopicDue,
} from '../reviews/sr-apply';
import { STARTER_CARD_DATA } from '../prompts/starter-card';
import {
  applicableRequirements,
  canReuseSourceEvidence,
  isSourceExpired,
  parseStoredSourcePlan,
} from '../sources/source-plan';

const norm = (s: string) => s.trim().toLowerCase();
type ImportTopic = Topic & { prerequisites?: { prerequisiteId: string }[] };
const topicRefKeys = (title: string, topicType: string) => [
  norm(title),
  norm(`${title} [${topicType}]`),
];
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
  /** Display-only enrichment for the web preview (null on a resolution miss). */
  topicTitle: string | null;
  promptText: string | null;
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
  sourcePlan?: SourcePlan;
  alreadyExists: boolean;
}
export type SourceEvidencePlan = LearningOsV2['sourceEvidence'][number] & {
  resolvedTopicId: string | null;
  substituted: boolean;
};
export interface SourceIssue {
  topicTitle: string;
  requirementId?: string;
  sourceId?: string;
  reason:
    | 'missing-plan'
    | 'missing-evidence'
    | 'unknown-requirement'
    | 'unknown-source'
    | 'duplicate'
    | 'verification-required';
  blocking: boolean;
  message: string;
}
export interface NoteSummaryPlan {
  topicTitle: string;
  resolvedTopicId: string | null;
  composedSummary: string;
  suggestedNoteRef?: string;
}
export interface ApplicationEventPlan {
  topicTitle: string;
  /** null = topic created in this same import (resolved by title inside apply's tx). */
  resolvedTopicId: string | null;
  kind: LearningOsV2['applicationEvents'][number]['kind'];
  description: string;
  url?: string;
}
// Aligned with the v2 contract's proposedPrompts entry type (packages/types)
// rather than duplicated/widened, so promptKind/problemDifficulty stay
// exactly the literal unions Prisma's Prompt columns expect.
type ProposedPromptV2 = LearningOsV2['proposedPrompts'][number];
type PromptIdentity = Pick<Prompt, 'topicId' | 'promptText' | 'promptKind' | 'url'>;
const promptIdentitySelect = {
  topicId: true,
  promptText: true,
  promptKind: true,
  url: true,
} as const;
const promptKey = (
  topicId: string,
  p: { promptText: string; promptKind: string; url?: string | null },
) =>
  JSON.stringify([
    topicId,
    p.promptKind,
    p.promptText.replace(/\r\n?/g, '\n').trim(),
    p.url?.trim() ?? '',
  ]);

export interface NewPromptPlan {
  duplicate: boolean;
  topicTitle: string;
  promptText: string;
  answerHint?: string;
  promptKind: ProposedPromptV2['promptKind'];
  url?: string;
  problemDifficulty?: ProposedPromptV2['problemDifficulty'];
  estimatedMinutes?: number;
}

export interface ActivationPlan {
  topicTitle: string;
  /** null = topic created in this same import (resolved by title inside apply's tx). */
  resolvedTopicId: string | null;
  /** null = in-batch (created planned in this import, then activated). */
  currentStatus: string | null;
  willActivate: boolean;
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
  kind:
    | 'review'
    | 'noteSummary'
    | 'prerequisite'
    | 'parent'
    | 'prompt'
    | 'studiedTopic'
    | 'applicationEvent';
  title?: string;
  ref?: string;
  context: string;
  reason: 'missing' | 'ambiguous' | 'self-reference' | 'archived' | 'cycle';
}
export interface ImportPlan {
  sessionExportId: string;
  alreadyImported: boolean;
  reviews: ResolvedReview[];
  newTopics: NewTopicPlan[];
  newPrompts: NewPromptPlan[];
  noteSummaries: NoteSummaryPlan[];
  applicationEvents: ApplicationEventPlan[];
  activations: ActivationPlan[];
  sourceEvidence: SourceEvidencePlan[];
  sourceIssues: SourceIssue[];
  nextSession?: LearningOsV2['nextSession'];
  unresolved: Unresolved[];
  applicable: boolean;
}
export interface ImportResult {
  sessionExportId: string;
  reviewsApplied: number;
  topicsCreated: string[];
  promptsCreated: number;
  duplicatePromptsSkipped: number;
  noteSummariesApplied: number;
  appEventsApplied: number;
  topicsActivated: number;
  sourceEvidenceApplied: number;
  topicsMastered: number;
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
    existing: ImportTopic[];
    promptsById: Map<string, Prompt>;
    existingPrompts: PromptIdentity[];
    priorSourceEvidence: SourceEvidence[];
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
    const existing = await this.prisma.topic.findMany({
      where: { userId },
      include: { prerequisites: { select: { prerequisiteId: true } } },
    });

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

    const proposedRefs = new Set(parsed.proposedPrompts.map((p) => norm(p.topicTitle)));
    const topicIds = existing
      .filter((t) => topicRefKeys(t.title, t.topicType).some((key) => proposedRefs.has(key)))
      .map((t) => t.id);
    const existingPrompts = topicIds.length
      ? await this.prisma.prompt.findMany({
          where: { topicId: { in: topicIds }, topic: { userId } },
          select: promptIdentitySelect,
        })
      : [];
    const studiedRefs = new Set((parsed.studiedTopics ?? []).map(norm));
    const historyTopicIds =
      sessionExport.approach === 'guided'
        ? []
        : existing
            .filter(
              (topic) =>
                topic.status === 'planned' &&
                topicRefKeys(topic.title, topic.topicType).some((key) => studiedRefs.has(key)) &&
                parseStoredSourcePlan(topic.sourcePlan)?.policy === 'required',
            )
            .map((topic) => topic.id);
    const priorSourceEvidence = historyTopicIds.length
      ? await this.prisma.sourceEvidence.findMany({
          where: { userId, topicId: { in: historyTopicIds } },
        })
      : [];
    return { parsed, sessionExport, existing, promptsById, existingPrompts, priorSourceEvidence };
  }

  async preview(userId: string, raw: string): Promise<ImportPlan> {
    const { parsed, sessionExport, existing, promptsById, existingPrompts, priorSourceEvidence } =
      await this.load(userId, raw);
    return this.buildPlan(
      parsed,
      sessionExport,
      existing,
      promptsById,
      existingPrompts,
      priorSourceEvidence,
    );
  }

  async apply(userId: string, raw: string): Promise<ImportResult> {
    const {
      parsed,
      sessionExport,
      existing: loadedTopics,
      promptsById,
      existingPrompts,
      priorSourceEvidence,
    } = await this.load(userId, raw);
    let existing = loadedTopics;
    let plan = this.buildPlan(
      parsed,
      sessionExport,
      existing,
      promptsById,
      existingPrompts,
      priorSourceEvidence,
    );
    if (plan.alreadyImported)
      throw new ConflictException('This session export was already imported.');
    const blockingSourceIssues = plan.sourceIssues.filter((issue) => issue.blocking);
    if (plan.unresolved.length > 0 || blockingSourceIssues.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Unresolved references or source requirements block import.',
        unresolved: plan.unresolved,
        sourceIssues: blockingSourceIssues,
      });
    }

    const now = this.now();
    const changesTopology = plan.newTopics.some((topic) => !topic.alreadyExists);
    const applyPlan = async (tx: Prisma.TransactionClient) => {
      if (changesTopology) {
        const currentTopics = await tx.topic.findMany({
          where: { userId },
          include: { prerequisites: { select: { prerequisiteId: true } } },
        });
        const currentPlan = this.buildPlan(
          parsed,
          sessionExport,
          currentTopics,
          promptsById,
          existingPrompts,
          priorSourceEvidence,
        );
        if (
          currentPlan.unresolved.length ||
          currentPlan.sourceIssues.some((issue) => issue.blocking)
        ) {
          throw new UnprocessableEntityException({
            message: 'The roadmap changed. Preview this import again.',
            unresolved: currentPlan.unresolved,
            sourceIssues: currentPlan.sourceIssues.filter((issue) => issue.blocking),
          });
        }
        existing = currentTopics;
        plan = currentPlan;
      }
      const claim = await tx.sessionExport.updateMany({
        where: { id: sessionExport.id, userId, importedAt: null },
        data: { importedAt: now },
      });
      if (claim.count === 0)
        throw new ConflictException('This session export was already imported.');

      if (plan.newPrompts.length) {
        // Serialize card-producing session imports for this user; re-read after
        // this transaction lock so different Session IDs cannot race a duplicate.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`terrain:prompt-import:${userId}`}))`;
      }

      const idByNorm = new Map<string, string>();
      for (const t of existing) {
        for (const key of topicRefKeys(t.title, t.topicType)) idByNorm.set(key, t.id);
      }

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
            sourcePlan: nt.sourcePlan,
            status: 'planned',
          },
        });
        for (const key of topicRefKeys(nt.title, nt.topicType)) idByNorm.set(key, created.id);
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

      let sourceEvidenceApplied = 0;
      for (const evidence of plan.sourceEvidence) {
        const topicId = evidence.resolvedTopicId ?? idByNorm.get(norm(evidence.topicTitle));
        if (!topicId) continue;
        const {
          resolvedTopicId: _resolvedTopicId,
          substituted: _substituted,
          topicTitle: _topicTitle,
          ...data
        } = evidence;
        await tx.sourceEvidence.create({
          data: {
            ...data,
            sourceId: data.sourceId ?? null,
            openQuestion: data.openQuestion ?? null,
            substitutionReason: data.substitutionReason ?? null,
            verifiedLiveAt: data.verifiedLiveAt ? new Date(data.verifiedLiveAt) : null,
            verificationNote: data.verificationNote ?? null,
            userId,
            topicId,
            sessionExportId: sessionExport.id,
          },
        });
        sourceEvidenceApplied++;
      }

      // b2. activate studied topics — explicit studiedTopics contract field.
      // Guarded updateMany: only planned→active flips count, so an entry that
      // was already active (willActivate false) or was concurrently activated
      // is a clean no-op.
      let topicsActivated = 0;
      for (const a of plan.activations) {
        if (!a.willActivate) continue;
        const id = a.resolvedTopicId ?? idByNorm.get(norm(a.topicTitle));
        if (!id) continue;
        const res = await tx.topic.updateMany({
          where: { id, userId, status: 'planned' },
          data: { status: 'active', aiProposed: false, learnedAt: now },
        });
        topicsActivated += res.count;
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
      let promptsCreated = 0;
      for (const nt of plan.newTopics) {
        if (nt.alreadyExists) continue;
        const key = norm(nt.title);
        if (batchParentTitles.has(key)) continue; // has batch children
        if (batchPromptTargets.has(key)) continue; // targeted by a batch prompt
        const topicId = idByNorm.get(key)!;
        await tx.prompt.create({ data: { topicId, ...STARTER_CARD_DATA(nt.title) } });
        promptsCreated++;
      }

      // d. create prompts for resolved proposedPrompts
      let duplicatePromptsSkipped = 0;
      const promptTopicIds = [
        ...new Set(
          plan.newPrompts.flatMap((p) => {
            const id = idByNorm.get(norm(p.topicTitle));
            return id ? [id] : [];
          }),
        ),
      ];
      const currentPrompts = promptTopicIds.length
        ? await tx.prompt.findMany({
            where: { topicId: { in: promptTopicIds }, topic: { userId } },
            select: promptIdentitySelect,
          })
        : [];
      const seenPrompts = new Set(currentPrompts.map((p) => promptKey(p.topicId, p)));
      for (const np of plan.newPrompts) {
        const topicId = idByNorm.get(norm(np.topicTitle));
        if (!topicId) continue; // unresolved already blocked apply() earlier
        const key = promptKey(topicId, np);
        if (seenPrompts.has(key)) {
          duplicatePromptsSkipped++;
          continue;
        }
        seenPrompts.add(key);
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
        promptsCreated++;
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

      // f2. apply application events — the "doing" a session captured. Each
      // resolves to an existing or in-batch topic (unresolved already blocked
      // apply earlier); creating a row satisfies mastery's application gate.
      let appEventsApplied = 0;
      for (const ae of plan.applicationEvents) {
        const id = ae.resolvedTopicId ?? idByNorm.get(norm(ae.topicTitle));
        if (!id) continue;
        await tx.applicationEvent.create({
          data: {
            userId,
            topicId: id,
            kind: ae.kind,
            description: ae.description,
            url: ae.url ?? null,
          },
        });
        appEventsApplied++;
      }

      // A completed studiedTopics import can close the topic when the same
      // evidence required by the manual mastery action is now present.
      let topicsMastered = 0;
      const candidateIds = plan.activations
        .map(
          (activation) => activation.resolvedTopicId ?? idByNorm.get(norm(activation.topicTitle)),
        )
        .filter((id): id is string => id != null);
      if (candidateIds.length) {
        const candidates = await tx.topic.findMany({
          where: { userId, id: { in: [...new Set(candidateIds)] }, status: 'active' },
          select: {
            id: true,
            summary: true,
            noteRef: true,
            prompts: { select: { stability: true, suspended: true } },
            _count: { select: { appEvents: true } },
          },
        });
        for (const topic of candidates) {
          const prompts = topic.prompts ?? [];
          const cards = prompts.filter((prompt) => !prompt.suspended);
          const retention =
            prompts.length > 0 &&
            cards.length > 0 &&
            Math.min(...cards.map((card) => card.stability ?? -Infinity)) >= 30;
          const teaching = !!(topic.noteRef?.trim() || topic.summary?.trim());
          if (!retention || topic._count.appEvents < 1 || !teaching) continue;
          const result = await tx.topic.updateMany({
            where: { id: topic.id, userId, status: 'active' },
            data: { status: 'mastered' },
          });
          topicsMastered += result.count;
        }
      }

      // g. stamp the originating SessionExport + store nextSession
      const focusTitle = plan.nextSession?.focusTitle;
      const coldChallenge = plan.nextSession?.coldChallenge;
      const completedTitles = new Set((parsed.studiedTopics ?? []).map(norm));
      const nextFocusTitle =
        focusTitle && focusTitle.trim().length > 0 && !completedTitles.has(norm(focusTitle))
          ? focusTitle
          : null;
      const nextColdChallenge =
        nextFocusTitle && coldChallenge && coldChallenge.trim().length > 0 ? coldChallenge : null;
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
        promptsCreated,
        duplicatePromptsSkipped,
        noteSummariesApplied,
        appEventsApplied,
        topicsActivated,
        topicsMastered,
        sourceEvidenceApplied,
        nextSessionStored: nextFocusTitle != null,
      };
    };
    return this.prisma
      .$transaction(
        applyPlan,
        changesTopology
          ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          : undefined,
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          throw new ConflictException('The roadmap changed during import. Preview and try again.');
        }
        throw error;
      });
  }

  protected buildPlan(
    parsed: LearningOsV2,
    sessionExport: SessionExport,
    existing: ImportTopic[],
    promptsById: Map<string, Prompt>,
    existingPrompts: PromptIdentity[],
    priorSourceEvidence: SourceEvidence[],
  ): ImportPlan {
    const now = this.now();
    const byNorm = new Map<string, Topic[]>();
    for (const t of existing) {
      for (const key of topicRefKeys(t.title, t.topicType)) {
        (byNorm.get(key) ?? byNorm.set(key, []).get(key)!).push(t);
      }
    }
    const titleById = new Map(existing.map((t) => [t.id, t.title] as const));
    const batchNorm = new Set(parsed.proposedTopics.flatMap((p) => topicRefKeys(p.title, p.type)));
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
        sourcePlan: p.sourcePlan,
        alreadyExists: ex.id != null,
      });
    }

    const addedTopics = newTopics.filter((topic) => !topic.alreadyExists);
    if (addedTopics.length) {
      const addedIds = new Map(
        addedTopics.flatMap((topic) =>
          topicRefKeys(topic.title, topic.topicType).map((key) => [
            key,
            `new:${norm(topic.title)}`,
          ]),
        ),
      );
      const resolveId = (title: string) =>
        resolveExisting(title).id ?? addedIds.get(norm(title)) ?? `missing:${norm(title)}`;
      const nodes: RoadmapNode[] = [
        ...existing.map((topic) => ({
          id: topic.id,
          parentId: topic.parentId,
          status: topic.status,
          prerequisiteIds: topic.prerequisites?.map((edge) => edge.prerequisiteId) ?? [],
        })),
        ...addedTopics.map((topic) => ({
          id: resolveId(topic.title),
          parentId: topic.parentTitle ? resolveId(topic.parentTitle) : null,
          status: 'planned' as const,
          prerequisiteIds: topic.prerequisiteTitles.map(resolveId),
        })),
      ];
      const policy = buildRoadmapPolicy(nodes);
      for (const topic of addedTopics) {
        if (policy.get(resolveId(topic.title))?.cycle) {
          unresolved.push({
            kind: 'prerequisite',
            title: topic.title,
            context: 'Prerequisites and chapter contents create a circular dependency',
            reason: 'cycle',
          });
        }
      }
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
            topicTitle: null,
            promptText: null,
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
          topicTitle: titleById.get(row.topicId) ?? null,
          promptText: row.promptText,
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

    const seenAppEvent = new Set<string>();
    const applicationEvents: ApplicationEventPlan[] = [];
    for (const ae of parsed.applicationEvents) {
      const dedupKey = `${norm(ae.topicTitle)}|${ae.kind}|${ae.description.trim()}`;
      if (seenAppEvent.has(dedupKey)) continue; // drop exact duplicates
      seenAppEvent.add(dedupKey);
      const ex = resolveExisting(ae.topicTitle);
      let resolvedTopicId: string | null = null;
      if (ex.ambiguous)
        unresolved.push({
          kind: 'applicationEvent',
          title: ae.topicTitle,
          context: 'applicationEvent',
          reason: 'ambiguous',
        });
      else if (ex.id != null) resolvedTopicId = ex.id;
      else if (!inBatch(ae.topicTitle))
        unresolved.push({
          kind: 'applicationEvent',
          title: ae.topicTitle,
          context: 'applicationEvent',
          reason: 'missing',
        });
      applicationEvents.push({
        topicTitle: ae.topicTitle,
        resolvedTopicId,
        kind: ae.kind,
        description: ae.description,
        url: ae.url,
      });
    }

    const batchTopicByRef = new Map(
      parsed.proposedTopics.flatMap((t) =>
        topicRefKeys(t.title, t.type).map((ref) => [ref, norm(t.title)] as const),
      ),
    );
    const seenPrompts = new Set(existingPrompts.map((p) => promptKey(p.topicId, p)));
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
      const topicKey =
        ex.id ?? `new:${batchTopicByRef.get(norm(p.topicTitle)) ?? norm(p.topicTitle)}`;
      const key = promptKey(topicKey, p);
      const duplicate = seenPrompts.has(key);
      seenPrompts.add(key);
      return {
        duplicate,
        topicTitle: p.topicTitle,
        promptText: p.promptText,
        answerHint: p.answerHint,
        promptKind: p.promptKind,
        url: p.url,
        problemDifficulty: p.problemDifficulty,
        estimatedMinutes: p.estimatedMinutes,
      };
    });

    const seenStudied = new Set<string>();
    const activations: ActivationPlan[] = [];
    for (const title of parsed.studiedTopics ?? []) {
      const key = norm(title);
      if (seenStudied.has(key)) continue;
      seenStudied.add(key);
      const matches = byNorm.get(key) ?? [];
      if (matches.length > 1) {
        unresolved.push({
          kind: 'studiedTopic',
          title,
          context: 'studiedTopics',
          reason: 'ambiguous',
        });
        continue;
      }
      const match = matches[0];
      if (!match) {
        if (inBatch(title)) {
          activations.push({
            topicTitle: title,
            resolvedTopicId: null,
            currentStatus: null,
            willActivate: true,
          });
        } else {
          unresolved.push({
            kind: 'studiedTopic',
            title,
            context: 'studiedTopics',
            reason: 'missing',
          });
        }
        continue;
      }
      if (match.status === 'archived') {
        unresolved.push({
          kind: 'studiedTopic',
          title,
          context: 'studiedTopics',
          reason: 'archived',
        });
        continue;
      }
      activations.push({
        topicTitle: title,
        resolvedTopicId: match.id,
        currentStatus: match.status,
        willActivate: match.status === 'planned',
      });
    }

    const sourceIssues: SourceIssue[] = [];
    const sourceEvidence: SourceEvidencePlan[] = [];
    const accepted = new Set<string>();
    const seenEvidence = new Set<string>();
    const batchByNorm = new Map(newTopics.map((topic) => [norm(topic.title), topic]));
    const planFor = (title: string): SourcePlan | null => {
      const matches = byNorm.get(norm(title)) ?? [];
      if (matches.length === 1) return parseStoredSourcePlan(matches[0].sourcePlan);
      const batch = batchByNorm.get(norm(title));
      if (batch) return batch.sourcePlan ?? null;
      return null;
    };

    for (const evidence of parsed.sourceEvidence) {
      const key = `${norm(evidence.topicTitle)}|${evidence.requirementId}`;
      if (seenEvidence.has(key)) {
        sourceIssues.push({
          ...(evidence.sourceId && { sourceId: evidence.sourceId }),
          topicTitle: evidence.topicTitle,
          requirementId: evidence.requirementId,
          reason: 'duplicate',
          blocking: true,
          message: 'Only one source may satisfy a requirement.',
        });
        continue;
      }
      seenEvidence.add(key);
      const plan = planFor(evidence.topicTitle);
      const requirement =
        plan?.policy === 'required'
          ? plan.requirements.find((item) => item.id === evidence.requirementId)
          : undefined;
      if (!requirement) {
        sourceIssues.push({
          topicTitle: evidence.topicTitle,
          requirementId: evidence.requirementId,
          reason: 'unknown-requirement',
          blocking: true,
          message: 'The source requirement does not exist.',
        });
        continue;
      }
      const source = evidence.sourceId
        ? requirement.options.find((option) => option.id === evidence.sourceId)
        : undefined;
      if (evidence.sourceId && !source) {
        sourceIssues.push({
          topicTitle: evidence.topicTitle,
          requirementId: evidence.requirementId,
          sourceId: evidence.sourceId,
          reason: 'unknown-source',
          blocking: true,
          message: 'The curated source does not exist.',
        });
        continue;
      }
      if (source && isSourceExpired(source, now) && evidence.verifiedLiveAt == null) {
        sourceIssues.push({
          topicTitle: evidence.topicTitle,
          requirementId: evidence.requirementId,
          sourceId: evidence.sourceId,
          reason: 'verification-required',
          blocking: true,
          message: 'This curated source requires live verification.',
        });
        continue;
      }
      const resolved = resolveExisting(evidence.topicTitle);
      sourceEvidence.push({
        ...evidence,
        resolvedTopicId: resolved.id,
        substituted: evidence.sourceId == null,
      });
      accepted.add(key);
    }

    for (const activation of activations) {
      if (sessionExport.approach === 'guided') continue;
      const plan = planFor(activation.topicTitle);
      if (!plan) {
        const blocking = activation.currentStatus == null || activation.currentStatus === 'planned';
        sourceIssues.push({
          topicTitle: activation.topicTitle,
          reason: 'missing-plan',
          blocking,
          message: blocking
            ? 'LEGACY FIRST EXPOSURE BLOCKED — no source plan is stored for this topic.'
            : 'LEGACY COMPATIBILITY MODE — no source plan is stored for this previously studied topic.',
        });
        continue;
      }
      const status = activation.currentStatus ?? 'planned';
      for (const requirement of applicableRequirements(
        plan,
        status as 'planned' | 'active' | 'mastered' | 'archived',
      )) {
        const recorded = priorSourceEvidence.some(
          (evidence) =>
            evidence.topicId === activation.resolvedTopicId &&
            evidence.requirementId === requirement.id &&
            canReuseSourceEvidence(plan, status as Topic['status'], evidence, now),
        );
        if (!recorded && !accepted.has(`${norm(activation.topicTitle)}|${requirement.id}`)) {
          sourceIssues.push({
            topicTitle: activation.topicTitle,
            requirementId: requirement.id,
            reason: 'missing-evidence',
            blocking: true,
            message: 'Required source evidence is missing.',
          });
        }
      }
    }

    const alreadyImported = sessionExport.importedAt != null;
    return {
      sessionExportId: sessionExport.id,
      alreadyImported,
      reviews,
      newTopics,
      newPrompts,
      noteSummaries,
      applicationEvents,
      activations,
      sourceEvidence,
      sourceIssues,
      nextSession: parsed.nextSession,
      unresolved,
      applicable:
        unresolved.length === 0 &&
        !sourceIssues.some((issue) => issue.blocking) &&
        !alreadyImported,
    };
  }
}
