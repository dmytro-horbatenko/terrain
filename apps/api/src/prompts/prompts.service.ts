import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prompt } from '@prisma/client';
import { previewIntervals, type CardSrState, type Grade } from '@terrain/sr-engine';
import { PrismaService } from '../prisma/prisma.service';
import { recomputeTopicDue } from '../reviews/sr-apply';

export interface NextPrompt {
  prompt: Prompt;
  previewIntervals: Record<Grade, number>;
}

@Injectable()
export class PromptsService {
  constructor(private prisma: PrismaService) {}

  async next(userId: string, topicId: string): Promise<NextPrompt | null> {
    const topic = await this.prisma.topic.findFirst({ where: { id: topicId, userId } });
    if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

    const now = new Date();
    const due = await this.prisma.prompt.findFirst({
      where: { topicId, suspended: false, nextReviewAt: { lte: now } },
      orderBy: { nextReviewAt: 'asc' },
    });
    const candidate =
      due ??
      (await this.prisma.prompt.findFirst({
        where: { topicId, suspended: false, state: 'new' },
        orderBy: { createdAt: 'asc' },
      }));
    if (!candidate) return null;

    const state: CardSrState = {
      stability: candidate.stability,
      difficulty: candidate.difficulty,
      reps: candidate.reps,
      lapses: candidate.lapses,
      state: candidate.state,
      lastReviewedAt: candidate.lastReviewedAt,
      nextReviewAt: candidate.nextReviewAt,
    };

    return { prompt: candidate, previewIntervals: previewIntervals(state, now) };
  }

  /** One specific card with fresh grade-preview intervals — same payload shape
   *  as `next`, used by the review session which addresses cards by id. */
  async getOne(userId: string, id: string): Promise<NextPrompt> {
    const prompt = await this.prisma.prompt.findFirst({
      where: { id, topic: { userId } },
    });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);

    const state: CardSrState = {
      stability: prompt.stability,
      difficulty: prompt.difficulty,
      reps: prompt.reps,
      lapses: prompt.lapses,
      state: prompt.state,
      lastReviewedAt: prompt.lastReviewedAt,
      nextReviewAt: prompt.nextReviewAt,
    };
    return { prompt, previewIntervals: previewIntervals(state, new Date()) };
  }

  async setSuspended(userId: string, id: string, suspended: boolean): Promise<Prompt> {
    const prompt = await this.prisma.prompt.findFirst({ where: { id, topic: { userId } } });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.prompt.update({
        where: { id },
        data: { suspended, suspendedAt: suspended ? new Date() : null },
      });
      await recomputeTopicDue(tx, prompt.topicId);
      return updated;
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const prompt = await this.prisma.prompt.findFirst({
      where: { id, topic: { userId } },
      include: { _count: { select: { reviews: true } } },
    });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);
    if (prompt._count.reviews > 0) {
      throw new ConflictException(
        `Prompt ${id} has review history — suspend it instead of deleting.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.prompt.delete({ where: { id } });
      await recomputeTopicDue(tx, prompt.topicId);
    });
  }
}
