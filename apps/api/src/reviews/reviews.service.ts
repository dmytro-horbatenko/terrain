import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogReviewDto } from './dto';
import { buildCardReviewWrites, buildEvidenceReviewWrite, recomputeTopicDue } from './sr-apply';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async logReview(userId: string, dto: LogReviewDto) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const topic = await tx.topic.findFirst({ where: { id: dto.topicId, userId } });
      if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);

      if (!dto.promptId) {
        const review = await tx.review.create({
          data: buildEvidenceReviewWrite({
            userId,
            topicId: dto.topicId,
            grade: dto.grade,
            mode: dto.mode,
            durationMin: dto.durationMin,
            note: dto.note,
            now,
          }),
        });
        return { review, previewNextReviewAt: null };
      }

      const prompt = await tx.prompt.findFirst({
        where: { id: dto.promptId, topicId: dto.topicId, topic: { userId } },
      });
      if (!prompt) throw new NotFoundException(`Prompt ${dto.promptId} not found`);

      const { promptUpdate, reviewCreate } = buildCardReviewWrites({
        userId,
        topicId: dto.topicId,
        prompt,
        grade: dto.grade,
        mode: dto.mode,
        durationMin: dto.durationMin,
        note: dto.note,
        now,
      });

      await tx.prompt.update(promptUpdate);
      const review = await tx.review.create({ data: reviewCreate });
      await recomputeTopicDue(tx, dto.topicId);

      return { review, previewNextReviewAt: promptUpdate.data.nextReviewAt };
    });
  }

  findByTopic(userId: string, topicId: string) {
    return this.prisma.review.findMany({
      where: { topicId, userId },
      orderBy: { reviewedAt: 'asc' },
    });
  }
}
