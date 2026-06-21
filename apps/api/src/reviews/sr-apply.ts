import { applyGrade, type CardSrState, type Grade } from '@terrain/sr-engine';
import type { Prisma, ReviewMode } from '@prisma/client';

/** A DB row's FSRS fields — same shape as sr-engine's CardSrState. */
export type CardSrStateRow = CardSrState;

/** The FSRS fields written back onto a Prompt row after a review. */
export type PromptSrData = CardSrState;

export interface CardReviewInput {
  userId: string;
  topicId: string;
  prompt: { id: string } & CardSrStateRow;
  grade: Grade;
  mode: ReviewMode;
  durationMin?: number;
  note?: string;
  now: Date;
}

const DAY = 86_400_000;
const daysBetween = (a: Date | null, b: Date | null) =>
  a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY)) : 0;

export function buildCardReviewWrites(input: CardReviewInput): {
  promptUpdate: { where: { id: string }; data: PromptSrData };
  reviewCreate: Prisma.ReviewUncheckedCreateInput;
} {
  const before: CardSrState = {
    stability: input.prompt.stability,
    difficulty: input.prompt.difficulty,
    reps: input.prompt.reps,
    lapses: input.prompt.lapses,
    state: input.prompt.state,
    lastReviewedAt: input.prompt.lastReviewedAt,
    nextReviewAt: input.prompt.nextReviewAt,
  };
  const after = applyGrade(before, input.grade, input.now);

  return {
    promptUpdate: {
      where: { id: input.prompt.id },
      data: {
        stability: after.stability,
        difficulty: after.difficulty,
        reps: after.reps,
        lapses: after.lapses,
        state: after.state,
        lastReviewedAt: after.lastReviewedAt,
        nextReviewAt: after.nextReviewAt,
      },
    },
    reviewCreate: {
      userId: input.userId,
      topicId: input.topicId,
      promptId: input.prompt.id,
      grade: input.grade,
      mode: input.mode,
      durationMin: input.durationMin ?? null,
      note: input.note ?? null,
      intervalBefore: daysBetween(before.lastReviewedAt, before.nextReviewAt),
      intervalAfter: daysBetween(input.now, after.nextReviewAt),
      reviewedAt: input.now,
    },
  };
}

export function buildEvidenceReviewWrite(
  input: Omit<CardReviewInput, 'prompt'>,
): Prisma.ReviewUncheckedCreateInput {
  return {
    userId: input.userId,
    topicId: input.topicId,
    promptId: null,
    grade: input.grade,
    mode: input.mode,
    durationMin: input.durationMin ?? null,
    note: input.note ?? null,
    intervalBefore: null,
    intervalAfter: null,
    reviewedAt: input.now,
  };
}

/**
 * Materializes Topic.nextReviewAt as the min nextReviewAt over its
 * non-suspended cards (null if none remain due).
 */
export async function recomputeTopicDue(
  tx: Prisma.TransactionClient,
  topicId: string,
): Promise<void> {
  const min = await tx.prompt.aggregate({
    where: { topicId, suspended: false, nextReviewAt: { not: null } },
    _min: { nextReviewAt: true },
  });
  await tx.topic.update({
    where: { id: topicId },
    data: { nextReviewAt: min._min.nextReviewAt ?? null },
  });
}
