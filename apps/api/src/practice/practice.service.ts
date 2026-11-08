import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'util';
import {
  practiceCheckpointSchema,
  type PracticeOverview,
  type SavedPractice,
} from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { buildRoadmapPolicy } from '../learning/roadmap-policy';

const saved = (row: { snapshot: unknown; revision: number; createdAt: Date }): SavedPractice => ({
  checkpoint: practiceCheckpointSchema.parse(row.snapshot),
  revision: row.revision,
  savedAt: row.createdAt.toISOString(),
});

@Injectable()
export class PracticeService {
  constructor(private readonly prisma: PrismaService) {}

  private async graph(userId: string) {
    const topics = await this.prisma.topic.findMany({
      where: { userId },
      orderBy: [
        { curriculumOrder: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        title: true,
        domain: true,
        parentId: true,
        status: true,
        description: true,
        aiContext: true,
        prerequisites: { select: { prerequisiteId: true } },
      },
    });
    const policy = buildRoadmapPolicy(
      topics.map((t) => ({ ...t, prerequisiteIds: t.prerequisites.map((p) => p.prerequisiteId) })),
    );
    return { topics, policy };
  }

  async overview(userId: string): Promise<PracticeOverview> {
    const [{ topics, policy }, progress, references, settings] = await Promise.all([
      this.graph(userId),
      this.prisma.practiceProgress.findMany({
        where: { userId },
        include: { checkpoints: { orderBy: { revision: 'desc' }, take: 1 } },
      }),
      this.prisma.practiceCheckpoint.findMany({
        where: { progress: { userId }, status: 'reference' },
        distinct: ['progressId'],
        orderBy: { revision: 'desc' },
      }),
      this.prisma.settings.findUnique({ where: { userId }, select: { disabledDomains: true } }),
    ]);
    const byId = new Map(topics.map((t) => [t.id, t]));
    const byTopic = new Map(progress.map((p) => [p.topicId, p]));
    const byProgress = new Map(references.map((r) => [r.progressId, r]));
    return {
      lessons: topics.flatMap((topic) => {
        const rule = policy.get(topic.id)!;
        if (
          rule.kind !== 'leaf' ||
          topic.status === 'archived' ||
          settings?.disabledDomains.includes(topic.domain)
        )
          return [];
        const row = byTopic.get(topic.id);
        const reference = row && byProgress.get(row.id);
        return [
          {
            id: topic.id,
            title: topic.title,
            domain: topic.domain,
            chapterTitle: byId.get(topic.parentId ?? '')?.title ?? null,
            status: topic.status,
            eligible: rule.learned || rule.learnable,
            scope: topic.aiContext ?? topic.description ?? '',
            revision: row?.revision ?? 0,
            latest: row?.checkpoints[0] ? saved(row.checkpoints[0]) : null,
            reference: reference ? saved(reference) : null,
          },
        ];
      }),
    };
  }

  async history(userId: string, topicId: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, userId },
      select: { id: true },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    return (
      await this.prisma.practiceCheckpoint.findMany({
        where: { progress: { userId, topicId } },
        orderBy: { revision: 'desc' },
      })
    ).map(saved);
  }

  async save(userId: string, input: unknown) {
    const parsed = practiceCheckpointSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues.map((i) => i.message).join('; '));
    const value = parsed.data;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`practice:${userId}:${value.topicId}`}, 0))`;
        const topic = await tx.topic.findFirst({
          where: { id: value.topicId, userId },
          select: { id: true, status: true, children: { select: { id: true }, take: 1 } },
        });
        if (!topic) throw new NotFoundException('Topic not found');
        const previous = await tx.practiceCheckpoint.findFirst({
          where: { id: value.id, progress: { userId, topicId: value.topicId } },
        });
        if (previous) {
          if (!isDeepStrictEqual(previous.snapshot, value))
            throw new ConflictException(
              'This checkpoint identity was already saved with different content. Reload the saved record before making a new checkpoint.',
            );
          return { alreadySaved: true };
        }
        if (topic.children.length || topic.status === 'archived')
          throw new BadRequestException('Practice belongs to an available lesson, not a chapter.');
        // Drafts can capture partial work before study completion. Topic status and all learning evidence stay untouched.
        const progress = await tx.practiceProgress.upsert({
          where: { userId_topicId: { userId, topicId: value.topicId } },
          create: { userId, topicId: value.topicId },
          update: {},
        });
        const advanced = await tx.practiceProgress.updateMany({
          where: { id: progress.id, userId, revision: value.expectedRevision },
          data: { revision: { increment: 1 } },
        });
        if (!advanced.count)
          throw new ConflictException(
            'Newer practice is saved. Your draft is still here. Download it, reload the saved version, and merge your work.',
          );
        await tx.practiceCheckpoint.create({
          data: {
            id: value.id,
            progressId: progress.id,
            revision: value.expectedRevision + 1,
            status: value.status,
            snapshot: value,
          },
        });
        return { alreadySaved: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException(
          'Checkpoint identity is already in use. Reload the saved version before continuing.',
        );
      throw error;
    }
  }
}
