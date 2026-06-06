import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LogReviewDto } from './dto';
import { buildReviewWrites } from './sr-apply';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async logReview(userId: string, dto: LogReviewDto) {
    const topic = await this.prisma.topic.findFirst({ where: { id: dto.topicId, userId } });
    if (!topic) throw new NotFoundException(`Topic ${dto.topicId} not found`);

    const prompt = dto.promptId
      ? await this.prisma.prompt.findFirst({
          where: { id: dto.promptId, topicId: dto.topicId, topic: { userId } },
        })
      : null;
    if (dto.promptId && !prompt) throw new NotFoundException(`Prompt ${dto.promptId} not found`);

    const now = new Date();
    const writes = buildReviewWrites(
      topic,
      dto.quality,
      dto.mode,
      dto.note,
      now,
      dto.durationMin,
      prompt,
    );

    const ops: any[] = [
      this.prisma.review.create({ data: writes.review }),
      this.prisma.topic.update({ where: { id: dto.topicId }, data: writes.topic }),
    ];
    if (prompt && writes.prompt) {
      ops.push(this.prisma.prompt.update({ where: { id: prompt.id }, data: writes.prompt }));
    }
    const [review] = await this.prisma.$transaction(ops);
    return review;
  }

  findByTopic(userId: string, topicId: string) {
    return this.prisma.review.findMany({
      where: { topicId, userId },
      orderBy: { reviewedAt: 'asc' },
    });
  }
}
