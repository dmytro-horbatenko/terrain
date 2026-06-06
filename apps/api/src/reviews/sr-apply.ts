import { sm2, type SRState } from '@terrain/sr-engine';
import type { Prisma, Prompt, ReviewMode, Topic } from '@prisma/client';

const GOOD_QUALITY = 4;
const GRADUATION_STREAK = 3;

export function buildReviewWrites(
  topic: Topic,
  quality: number,
  mode: ReviewMode,
  note: string | undefined,
  now: Date,
  durationMin?: number,
  prompt?: Prompt | null,
): {
  review: Prisma.ReviewUncheckedCreateInput;
  topic: Prisma.TopicUpdateInput;
  prompt?: Prisma.PromptUpdateInput;
} {
  const before: SRState = {
    easeFactor: topic.easeFactor,
    interval: topic.interval,
    repetitions: topic.repetitions,
    nextReviewAt: topic.nextReviewAt,
  };
  const after = sm2(quality, before, now);

  let promptWrite: Prisma.PromptUpdateInput | undefined;
  if (prompt) {
    const promptBefore: SRState = {
      easeFactor: prompt.easeFactor,
      interval: prompt.interval,
      repetitions: prompt.repetitions,
      nextReviewAt: prompt.nextReviewAt,
    };
    const promptAfter = sm2(quality, promptBefore, now);
    const consecutiveGood = quality >= GOOD_QUALITY ? prompt.consecutiveGood + 1 : 0;
    const graduated = prompt.graduated || consecutiveGood >= GRADUATION_STREAK;
    promptWrite = {
      easeFactor: promptAfter.easeFactor,
      interval: promptAfter.interval,
      repetitions: promptAfter.repetitions,
      nextReviewAt: promptAfter.nextReviewAt,
      consecutiveGood,
      graduated,
    };
  }

  return {
    review: {
      topicId: topic.id,
      userId: topic.userId,
      promptId: prompt?.id,
      quality,
      mode,
      durationMin,
      note,
      intervalBefore: before.interval,
      intervalAfter: after.interval,
      reviewedAt: now,
    },
    topic: {
      easeFactor: after.easeFactor,
      interval: after.interval,
      repetitions: after.repetitions,
      nextReviewAt: after.nextReviewAt,
      learnedAt: topic.learnedAt ?? now,
      status: topic.status === 'planned' ? 'active' : topic.status,
    },
    prompt: promptWrite,
  };
}
