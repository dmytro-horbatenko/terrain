import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { parseLearningOs } from '@terrain/types';
import { z } from 'zod';
import { interleaveQueue, type SessionQueueItem } from './interleave';

export type ReviewOptions = { reviewMinutes?: 15 | 20; reviewPromptId?: string };
export type ReviewCard = SessionQueueItem & { promptText: string; estimatedMinutes: number };
export type ReviewQueue = {
  items: ReviewCard[];
  estimatedMinutes: number;
  budgetMinutes: number;
  backlogCount: number;
  backlogMinutes: number;
  deferredExercises: {
    promptId: string;
    topicTitle: string;
    promptText: string;
    estimatedMinutes: number;
  }[];
};

export function parseReviewOptions(
  reviewMinutes?: unknown,
  reviewPromptId?: unknown,
): ReviewOptions {
  const options: ReviewOptions = {};
  if (reviewMinutes !== undefined) {
    if (reviewMinutes === 15 || reviewMinutes === '15') options.reviewMinutes = 15;
    else if (reviewMinutes === 20 || reviewMinutes === '20') options.reviewMinutes = 20;
    else throw new BadRequestException('reviewMinutes must be 15 or 20');
  }
  if (reviewPromptId !== undefined) {
    const parsed = z.string().uuid().safeParse(reviewPromptId);
    if (!parsed.success) throw new BadRequestException('reviewPromptId must be a UUID');
    options.reviewPromptId = parsed.data;
  }
  return options;
}

const reviewSnapshotSchema = z
  .object({
    promptIds: z.array(z.string().uuid()),
    estimatedMinutes: z.number().int().nonnegative(),
    budgetMinutes: z.number().int().positive(),
    reviewMinutes: z.union([z.literal(15), z.literal(20)]),
    reviewPromptId: z.string().uuid().optional(),
  })
  .strict();
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;

/** Only the server-generated first line is metadata; learner text cannot replace it. */
export function readReviewSnapshot(exportMd: string): ReviewSnapshot | null {
  const marker = /^<!-- terrain-review: (.+) -->\r?\n/.exec(exportMd);
  if (!marker) return null;
  try {
    return reviewSnapshotSchema.parse(JSON.parse(marker[1]));
  } catch {
    return null;
  }
}

export function completedReview(exportMd: string, raw: string | null, sessionId: string): boolean {
  const snapshot = readReviewSnapshot(exportMd);
  if (!snapshot?.promptIds.length || !raw) return false;
  try {
    const result = parseLearningOs(raw);
    const attempted = new Set(result.reviews.map((r) => r.promptId));
    return result.sessionId === sessionId && snapshot.promptIds.every((id) => attempted.has(id));
  } catch {
    return false;
  }
}

/** Input is in due-date / fresh-topic priority order; interleave only after selection. */
export function selectReviewQueue(cards: ReviewCard[], options: ReviewOptions = {}): ReviewQueue {
  const unique = [...new Map(cards.map((card) => [card.promptId, card])).values()];
  let budgetMinutes: number = options.reviewMinutes ?? 15;
  const selected = new Set<ReviewCard>();
  let spent = 0;
  let newCount = 0;
  const take = (candidates: ReviewCard[], limit: number) => {
    for (const card of candidates) {
      if (
        selected.has(card) ||
        (card.isNew && newCount === 2) ||
        spent + card.estimatedMinutes > limit
      )
        continue;
      selected.add(card);
      spent += card.estimatedMinutes;
      if (card.isNew) newCount++;
    }
  };
  if (options.reviewPromptId) {
    const card = unique.find((c) => c.promptId === options.reviewPromptId);
    if (!card) throw new UnprocessableEntityException('This card is not available for review.');
    budgetMinutes = card.estimatedMinutes;
    take([card], budgetMinutes);
  } else {
    const fresh = unique.filter((c) => c.isNew);
    take(fresh, 5);
    take(
      unique.filter((c) => !c.isNew),
      budgetMinutes,
    );
    take(fresh, budgetMinutes);
  }
  return {
    items: interleaveQueue([...selected]),
    estimatedMinutes: spent,
    budgetMinutes,
    backlogCount: unique.length,
    backlogMinutes: unique.reduce((sum, c) => sum + c.estimatedMinutes, 0),
    deferredExercises: unique
      .filter(
        (c) =>
          !selected.has(c) &&
          (c.kind === 'code' || c.kind === 'problem' || c.estimatedMinutes > budgetMinutes),
      )
      .map(({ promptId, topicTitle, promptText, estimatedMinutes }) => ({
        promptId,
        topicTitle,
        promptText,
        estimatedMinutes,
      })),
  };
}
