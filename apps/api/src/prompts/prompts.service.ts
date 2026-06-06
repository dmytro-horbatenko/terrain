import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prompt } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PromptsService {
  constructor(private prisma: PrismaService) {}

  async next(userId: string, topicId: string): Promise<Prompt | null> {
    const topic = await this.prisma.topic.findFirst({ where: { id: topicId, userId } });
    if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);

    const prompts = await this.prisma.prompt.findMany({ where: { topicId, graduated: false } });
    if (prompts.length === 0) return null;

    const dueTime = (p: Prompt) => (p.nextReviewAt ? p.nextReviewAt.getTime() : -Infinity);
    return prompts.reduce((most, p) => (dueTime(p) < dueTime(most) ? p : most));
  }

  async setGraduated(userId: string, id: string, graduated: boolean): Promise<Prompt> {
    const prompt = await this.prisma.prompt.findFirst({ where: { id, topic: { userId } } });
    if (!prompt) throw new NotFoundException(`Prompt ${id} not found`);
    return this.prisma.prompt.update({ where: { id }, data: { graduated, consecutiveGood: 0 } });
  }
}
