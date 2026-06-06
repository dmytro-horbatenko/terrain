import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { CreateAppEventDto, CreateTopicDto, UpdateTopicDto } from './dto';

@Injectable()
export class TopicsService {
  constructor(
    private prisma: PrismaService,
    private metrics: MetricsService,
  ) {}

  private async registerType(userId: string, topicType: string) {
    const label = topicType.trim();
    const key = label.toLowerCase();
    await this.prisma.topicType.upsert({
      where: { userId_key: { userId, key } },
      update: {},
      create: { userId, key, label },
    });
  }

  async create(userId: string, dto: CreateTopicDto) {
    if (dto.parentId) await this.findOne(userId, dto.parentId); // 404 if missing or not owned
    await this.registerType(userId, dto.topicType);
    return this.prisma.topic.create({ data: { ...dto, userId } });
  }

  async findAll(userId: string) {
    const topics = await this.prisma.topic.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { prerequisites: { select: { prerequisiteId: true } } },
    });
    const statusById = new Map(topics.map((t) => [t.id, t.status]));
    return topics.map(({ prerequisites, ...topic }) => {
      const prerequisiteIds = prerequisites.map((p) => p.prerequisiteId);
      const prerequisiteStatuses = prerequisiteIds
        .map((pid) => statusById.get(pid))
        .filter((s): s is NonNullable<typeof s> => s != null);
      return {
        ...topic,
        prerequisiteIds,
        labels: this.metrics.topicLabels({
          status: topic.status,
          repetitions: topic.repetitions,
          prerequisiteStatuses,
        }),
      };
    });
  }

  async getDetail(userId: string, id: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id, userId },
      include: {
        parent: { select: { id: true, title: true, status: true } },
        children: { select: { id: true, title: true, status: true } },
        prerequisites: {
          include: { prerequisite: { select: { id: true, title: true, status: true } } },
        },
        dependents: { include: { topic: { select: { id: true, title: true, status: true } } } },
        reviews: { orderBy: { reviewedAt: 'desc' } },
        appEvents: { orderBy: { appliedAt: 'desc' } },
        prompts: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!topic) throw new NotFoundException(`Topic ${id} not found`);
    const { parent, children, prerequisites, dependents, reviews, appEvents, prompts, ...scalars } =
      topic;
    const prerequisiteTopics = prerequisites.map((p) => p.prerequisite);
    return {
      ...scalars,
      prerequisiteIds: prerequisiteTopics.map((p) => p.id),
      prerequisites: prerequisiteTopics,
      dependents: dependents.map((d) => d.topic),
      parent: parent ?? null,
      children,
      reviews,
      appEvents,
      appEventCount: appEvents.length,
      prompts,
      labels: this.metrics.topicLabels({
        status: scalars.status,
        repetitions: scalars.repetitions,
        prerequisiteStatuses: prerequisiteTopics.map((p) => p.status),
      }),
      mastery: this.metrics.masteryStatus({
        interval: scalars.interval,
        appEventCount: appEvents.length,
        noteRef: scalars.noteRef,
        summary: scalars.summary,
      }),
    };
  }

  async addAppEvent(userId: string, topicId: string, dto: CreateAppEventDto) {
    await this.findOne(userId, topicId); // 404 if the topic is missing
    return this.prisma.applicationEvent.create({
      data: {
        userId,
        topicId,
        kind: dto.kind,
        description: dto.description,
        url: dto.url ?? null,
      },
    });
  }

  async findOne(userId: string, id: string) {
    const topic = await this.prisma.topic.findFirst({ where: { id, userId } });
    if (!topic) throw new NotFoundException(`Topic ${id} not found`);
    return topic;
  }

  private async assertNoParentCycle(userId: string, id: string, parentId: string): Promise<void> {
    if (parentId === id) {
      throw new UnprocessableEntityException('A topic cannot be its own parent.');
    }
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id) {
        throw new UnprocessableEntityException('Reparenting would create a cycle.');
      }
      if (visited.has(cursor)) break; // pre-existing bad-data cycle upstream — stop
      visited.add(cursor);
      const node: { parentId: string | null } | null = await this.prisma.topic.findFirst({
        where: { id: cursor, userId },
        select: { parentId: true },
      });
      if (!node) {
        if (cursor === parentId) {
          throw new NotFoundException(`Topic ${parentId} not found`);
        }
        break; // broken ancestor chain — nothing more to walk
      }
      cursor = node.parentId;
    }
  }

  async update(userId: string, id: string, dto: UpdateTopicDto) {
    const existing = await this.findOne(userId, id);
    if (
      typeof dto.parentId === 'string' &&
      dto.parentId.length > 0 &&
      dto.parentId !== existing.parentId
    ) {
      await this.assertNoParentCycle(userId, id, dto.parentId);
    }
    if (dto.topicType) await this.registerType(userId, dto.topicType);
    const { nextReviewAt, ...rest } = dto;
    return this.prisma.topic.update({
      where: { id },
      data: { ...rest, ...(nextReviewAt ? { nextReviewAt: new Date(nextReviewAt) } : {}) },
    });
  }

  async addPrerequisite(userId: string, topicId: string, prerequisiteId: string) {
    await this.findOne(userId, topicId); // 404 if the dependent is missing or not owned
    await this.findOne(userId, prerequisiteId); // 404 if the prerequisite is missing or not owned
    if (prerequisiteId === topicId) {
      throw new UnprocessableEntityException('A topic cannot be its own prerequisite.');
    }
    await this.assertNoPrereqCycle(userId, topicId, prerequisiteId);
    return this.prisma.prerequisite.upsert({
      where: { topicId_prerequisiteId: { topicId, prerequisiteId } },
      create: { topicId, prerequisiteId },
      update: {},
    });
  }

  private async assertNoPrereqCycle(
    userId: string,
    topicId: string,
    prerequisiteId: string,
  ): Promise<void> {
    // A cycle forms iff prerequisiteId already (transitively) requires topicId.
    // Walk the requires-closure outward from prerequisiteId.
    const visited = new Set<string>();
    const stack = [prerequisiteId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === topicId) {
        throw new UnprocessableEntityException('Adding this prerequisite would create a cycle.');
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const edges = await this.prisma.prerequisite.findMany({
        where: { topicId: current, topic: { userId } },
        select: { prerequisiteId: true },
      });
      for (const e of edges) stack.push(e.prerequisiteId);
    }
  }

  async removePrerequisite(userId: string, topicId: string, prerequisiteId: string) {
    await this.findOne(userId, topicId); // ownership check
    await this.prisma.prerequisite.deleteMany({ where: { topicId, prerequisiteId } });
  }

  async remove(userId: string, id: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id, userId },
      include: { _count: { select: { reviews: true, appEvents: true } } },
    });
    if (!topic) throw new NotFoundException(`Topic ${id} not found`);
    if (topic._count.reviews > 0 || topic._count.appEvents > 0) {
      throw new ConflictException(
        `Topic ${id} has review or application history — archive it instead of deleting.`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.prerequisite.deleteMany({
        where: { OR: [{ topicId: id }, { prerequisiteId: id }] },
      }),
      this.prisma.topic.updateMany({ where: { parentId: id, userId }, data: { parentId: null } }),
      this.prisma.prompt.deleteMany({ where: { topicId: id } }),
      this.prisma.topic.delete({ where: { id } }),
    ]);
  }
}
