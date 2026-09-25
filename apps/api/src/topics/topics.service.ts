import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type TopicStatus } from '@prisma/client';
import { sourcePlanSchema } from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { buildRoadmapPolicy, type RoadmapEligibility } from '../learning/roadmap-policy';
import { STARTER_CARD_DATA } from '../prompts/starter-card';
import { CreateAppEventDto, CreateTopicDto, UpdateTopicDto } from './dto';

@Injectable()
export class TopicsService {
  constructor(
    private prisma: PrismaService,
    private metrics: MetricsService,
  ) {}

  private parseSourcePlan(
    value: unknown,
  ): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.DbNull;
    const parsed = sourcePlanSchema.safeParse(value);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return parsed.data as Prisma.InputJsonValue;
  }

  private async registerType(userId: string, topicType: string) {
    const label = topicType.trim();
    const key = label.toLowerCase();
    await this.prisma.topicType.upsert({
      where: { userId_key: { userId, key } },
      update: {},
      create: { userId, key, label },
    });
  }

  private blockers(
    targetId: string,
    eligibility: RoadmapEligibility | undefined,
    policy: Map<string, RoadmapEligibility>,
    topicById: Map<string, { id: string; title: string; status: TopicStatus }>,
  ) {
    if (!eligibility) return [];
    const blockers = eligibility.blockerIds.map((blockerId) => {
      const blocker = topicById.get(blockerId)!;
      const blockerPolicy = policy.get(blockerId)!;
      return {
        id: blocker.id,
        title: blocker.title,
        learnedLeaves: blockerPolicy.learnedLeaves,
        totalLeaves: blockerPolicy.totalLeaves,
        unfinishedLeaves: blockerPolicy.unfinishedLeafIds.map((id) => {
          const leaf = topicById.get(id)!;
          return { id: leaf.id, title: leaf.title, status: leaf.status };
        }),
      };
    });
    if (eligibility.unavailablePrerequisite) {
      blockers.push({
        id: targetId,
        title: 'Unavailable prerequisite',
        learnedLeaves: 0,
        totalLeaves: 0,
        unfinishedLeaves: [],
      });
    }
    if (eligibility.malformedParent) {
      blockers.push({
        id: targetId,
        title: 'Unavailable parent',
        learnedLeaves: 0,
        totalLeaves: 0,
        unfinishedLeaves: [],
      });
    }
    return blockers;
  }

  async create(userId: string, dto: CreateTopicDto) {
    if (dto.status === 'mastered') {
      throw new UnprocessableEntityException(
        'Create the topic as planned or active; mastery requires recorded retention, application, and teaching evidence.',
      );
    }
    const sourcePlan = this.parseSourcePlan(dto.sourcePlan);
    if (dto.parentId) await this.findOne(userId, dto.parentId); // 404 if missing or not owned
    await this.registerType(userId, dto.topicType);
    const title = dto.title.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const topic = await tx.topic.create({
          data: {
            title,
            domain: dto.domain,
            topicType: dto.topicType,
            status: dto.status,
            ...(dto.status === 'active' ? { learnedAt: new Date() } : {}),
            description: dto.description,
            noteRef: dto.noteRef,
            parentId: dto.parentId,
            sourcePlan,
            userId,
          },
        });
        await tx.prompt.create({
          data: { topicId: topic.id, ...STARTER_CARD_DATA(title) },
        });
        return topic;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('a topic with this title already exists');
      }
      throw error;
    }
  }

  async findAll(userId: string) {
    const topics = await this.prisma.topic.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        prerequisites: { select: { prerequisiteId: true } },
        prompts: { select: { reps: true } },
      },
    });
    const policy = buildRoadmapPolicy(
      topics.map((topic) => ({
        id: topic.id,
        parentId: topic.parentId,
        status: topic.status,
        prerequisiteIds: topic.prerequisites.map((edge) => edge.prerequisiteId),
      })),
    );
    const topicById = new Map(topics.map((topic) => [topic.id, topic]));
    return topics.map(({ prerequisites, prompts, ...topic }) => {
      const prerequisiteIds = prerequisites
        .map((p) => p.prerequisiteId)
        .filter((prerequisiteId) => topicById.has(prerequisiteId));
      const eligibility = policy.get(topic.id)!;
      return {
        ...topic,
        parentId: topic.parentId && topicById.has(topic.parentId) ? topic.parentId : null,
        prerequisiteIds,
        labels: this.metrics.topicLabels({
          status: topic.status,
          cards: prompts.map((p) => ({ reps: p.reps })),
          blocked: topic.status === 'planned' && eligibility.learnable === false,
        }),
        blockers: this.blockers(topic.id, eligibility, policy, topicById),
      };
    });
  }

  async search(userId: string, query: string) {
    const contains = { contains: query.trim(), mode: 'insensitive' as const };
    const topics = await this.prisma.topic.findMany({
      where: {
        userId,
        OR: [
          { title: contains },
          { description: contains },
          { summary: contains },
          { notes: { is: { body: contains } } },
        ],
      },
      select: { id: true },
    });
    return topics.map((topic) => topic.id);
  }

  async getNotes(userId: string, topicId: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id: topicId, userId },
      select: { notes: { select: { body: true, revision: true, updatedAt: true } } },
    });
    if (!topic) throw new NotFoundException(`Topic ${topicId} not found`);
    return topic.notes ?? { body: '', revision: 0, updatedAt: null };
  }

  async saveNotes(userId: string, topicId: string, input: { body: string; revision: number }) {
    await this.findOne(userId, topicId);
    const conflict = () =>
      new ConflictException(
        'These notes changed on another device. Your draft has not been saved. Compare it with the latest saved notes before saving again.',
      );
    const select = { body: true, revision: true, updatedAt: true } as const;
    try {
      if (input.revision === 0) {
        return await this.prisma.topicNotes.create({
          data: { topicId, body: input.body, revision: 1 },
          select,
        });
      }
      const [saved] = await this.prisma.topicNotes.updateManyAndReturn({
        where: { topicId, revision: input.revision, topic: { userId } },
        data: { body: input.body, revision: { increment: 1 } },
        select,
      });
      if (!saved) throw conflict();
      return saved;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw conflict();
      throw error;
    }
  }

  async getDetail(userId: string, id: string) {
    const topic = await this.prisma.topic.findFirst({
      where: { id, userId },
      include: {
        children: { select: { id: true } },
        prerequisites: { select: { prerequisiteId: true } },
        dependents: { select: { topicId: true } },
        reviews: { orderBy: { reviewedAt: 'desc' } },
        appEvents: { orderBy: { appliedAt: 'desc' } },
        prompts: { orderBy: { createdAt: 'asc' } },
        sourceEvidence: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!topic) throw new NotFoundException(`Topic ${id} not found`);
    const topology = await this.prisma.topic.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        parentId: true,
        status: true,
        prerequisites: { select: { prerequisiteId: true } },
      },
    });
    const policy = buildRoadmapPolicy(
      topology.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        status: node.status,
        prerequisiteIds: node.prerequisites.map((edge) => edge.prerequisiteId),
      })),
    );
    const eligibility = policy.get(id);
    const topicById = new Map(topology.map((node) => [node.id, node]));
    const { children, prerequisites, dependents, reviews, appEvents, prompts, ...scalars } = topic;
    const reference = (topicId: string) => {
      const owned = topicById.get(topicId);
      return owned ? { id: owned.id, title: owned.title, status: owned.status } : null;
    };
    const prerequisiteIds = prerequisites
      .map((p) => p.prerequisiteId)
      .filter((prerequisiteId) => topicById.has(prerequisiteId));
    const prerequisiteTopics = prerequisiteIds.flatMap((prerequisiteId) => {
      const prerequisite = reference(prerequisiteId);
      return prerequisite ? [prerequisite] : [];
    });
    const cards = prompts.map((p) => ({
      stability: p.stability,
      suspended: p.suspended,
      reps: p.reps,
    }));
    return {
      ...scalars,
      parentId: scalars.parentId && topicById.has(scalars.parentId) ? scalars.parentId : null,
      prerequisiteIds,
      prerequisites: prerequisiteTopics,
      dependents: dependents.flatMap((d) => {
        const dependent = reference(d.topicId);
        return dependent ? [dependent] : [];
      }),
      parent: scalars.parentId ? reference(scalars.parentId) : null,
      children: children.flatMap((child) => {
        const owned = reference(child.id);
        return owned ? [owned] : [];
      }),
      reviews,
      appEvents,
      appEventCount: appEvents.length,
      prompts,
      labels: this.metrics.topicLabels({
        status: scalars.status,
        cards,
        blocked: scalars.status === 'planned' && eligibility?.learnable === false,
      }),
      blockers: this.blockers(id, eligibility, policy, topicById),
      mastery: this.metrics.masteryStatus({
        cards,
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

  private async assertRoadmapChange(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    change: { parentId?: string | null; prerequisiteId?: string },
  ): Promise<void> {
    const topics = await tx.topic.findMany({
      where: { userId },
      select: {
        id: true,
        parentId: true,
        status: true,
        prerequisites: { select: { prerequisiteId: true } },
      },
    });
    const nodes = topics.map((topic) => ({
      id: topic.id,
      parentId: topic.parentId,
      status: topic.status,
      prerequisiteIds: topic.prerequisites.map((edge) => edge.prerequisiteId),
    }));
    const node = nodes.find((topic) => topic.id === id);
    if (!node) throw new NotFoundException(`Topic ${id} not found`);
    if (change.parentId !== undefined) node.parentId = change.parentId;
    if (change.prerequisiteId) node.prerequisiteIds.push(change.prerequisiteId);
    const policy = buildRoadmapPolicy(nodes).get(id)!;
    if (policy.cycle || policy.malformedParent || policy.unavailablePrerequisite) {
      throw new UnprocessableEntityException(
        'This change would create a circular or unavailable roadmap dependency.',
      );
    }
  }

  async update(userId: string, id: string, dto: UpdateTopicDto) {
    const existing = await this.findOne(userId, id);
    const sourcePlan = this.parseSourcePlan(dto.sourcePlan);
    const changingParent = dto.parentId !== undefined && dto.parentId !== existing.parentId;
    if (changingParent && dto.parentId) await this.findOne(userId, dto.parentId);
    if (dto.topicType) await this.registerType(userId, dto.topicType);
    const data: Prisma.TopicUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.domain !== undefined ? { domain: dto.domain } : {}),
      ...(dto.topicType !== undefined ? { topicType: dto.topicType } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...((dto.status === 'active' || dto.status === 'mastered') &&
      existing.status !== 'active' &&
      existing.status !== 'mastered'
        ? { learnedAt: new Date() }
        : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.noteRef !== undefined ? { noteRef: dto.noteRef } : {}),
      ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
      ...(dto.nextReviewAt ? { nextReviewAt: new Date(dto.nextReviewAt) } : {}),
      ...(dto.aiProposed !== undefined ? { aiProposed: dto.aiProposed } : {}),
      ...(sourcePlan !== undefined ? { sourcePlan } : {}),
    };
    try {
      if (dto.status === 'mastered') {
        return await this.prisma.$transaction(
          async (tx) => {
            if (changingParent)
              await this.assertRoadmapChange(tx, userId, id, { parentId: dto.parentId });
            const evidence = await tx.topic.findFirst({
              where: { id, userId },
              select: {
                status: true,
                noteRef: true,
                summary: true,
                prompts: { select: { stability: true, suspended: true } },
                _count: { select: { appEvents: { where: { userId } } } },
              },
            });
            if (!evidence) throw new NotFoundException(`Topic ${id} not found`);
            if (evidence.status !== 'mastered') {
              const mastery = this.metrics.masteryStatus({
                cards: evidence.prompts,
                appEventCount: evidence._count.appEvents,
                noteRef: dto.noteRef !== undefined ? dto.noteRef : evidence.noteRef,
                summary: dto.summary !== undefined ? dto.summary : evidence.summary,
              });
              if (!mastery.eligible) {
                throw new UnprocessableEntityException({
                  message:
                    'Mastery requires retention, an application event, and a written summary or note.',
                  mastery,
                });
              }
            }
            return tx.topic.update({ where: { id, userId }, data });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      }
      if (changingParent) {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.assertRoadmapChange(tx, userId, id, { parentId: dto.parentId });
            return tx.topic.update({ where: { id }, data });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      }
      return await this.prisma.topic.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException(
          'Topic evidence changed during this update. Refresh and try again.',
        );
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('a topic with this title already exists');
      }
      throw error;
    }
  }

  async addPrerequisite(userId: string, topicId: string, prerequisiteId: string) {
    await this.findOne(userId, topicId);
    await this.findOne(userId, prerequisiteId);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await this.assertRoadmapChange(tx, userId, topicId, { prerequisiteId });
          return tx.prerequisite.upsert({
            where: { topicId_prerequisiteId: { topicId, prerequisiteId } },
            create: { topicId, prerequisiteId },
            update: {},
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException(
          'The roadmap changed during this update. Refresh and try again.',
        );
      }
      throw error;
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
      this.prisma.topic.updateMany({ where: { parentId: id, userId }, data: { parentId: null } }),
      this.prisma.topic.delete({ where: { id } }),
    ]);
  }
}
