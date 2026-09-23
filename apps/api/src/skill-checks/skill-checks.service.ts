import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  independentSkillAttempt,
  skillCheckAttemptSchema,
  skillCheckPlanSchema,
  skillCheckResultSchema,
  type ProductCurriculum,
  type SkillCheck,
  type SkillCheckAttempt,
  type SkillCheckList,
  type SkillCheckPlan,
  type SkillCheckResult,
} from '@terrain/types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';
import { z } from 'zod';
import { CONTENT_DIR } from '../courses/content-dir';
import { PrismaService } from '../prisma/prisma.service';

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}

@Injectable()
export class SkillChecksService {
  constructor(private prisma: PrismaService) {}

  private async calendar(userId: string) {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    const timezone = settings?.timezone ?? 'UTC';
    return {
      timezone,
      today: new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()),
    };
  }

  async list(userId: string): Promise<SkillCheckList> {
    const calendar = await this.calendar(userId);
    const rows = await this.prisma.skillCheck.findMany({
      where: { userId },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      ...calendar,
      checks: rows.map(
        (row): SkillCheck => ({
          plan: row.plan as unknown as SkillCheckPlan,
          targetTitle: row.targetTitle,
          createdAt: row.createdAt.toISOString(),
          attempt: row.attempt as SkillCheckAttempt | null,
          attemptedAt: row.attemptedAt?.toISOString() ?? null,
          result: row.result as SkillCheckResult | null,
          assessedAt: row.assessedAt?.toISOString() ?? null,
          cancelledAt: row.cancelledAt?.toISOString() ?? null,
        }),
      ),
    };
  }

  private async owned(userId: string, id: string) {
    const row = await this.prisma.skillCheck.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Skill check not found');
    return row;
  }

  async create(userId: string, input: unknown) {
    const plan = parse(skillCheckPlanSchema, input);
    const previous = await this.prisma.skillCheck.findFirst({ where: { id: plan.id, userId } });
    if (previous) {
      if (isDeepStrictEqual(previous.plan, plan)) return { alreadySaved: true };
      throw new ConflictException(
        'This plan is already saved. Schedule a new check for a changed task.',
      );
    }
    const { today } = await this.calendar(userId);
    if (plan.learnedOn > today || plan.dueOn < today)
      throw new BadRequestException(
        'Original practice must be today or earlier; schedule the check for today or later.',
      );
    let targetTitle: string;
    if (plan.target.kind === 'topic') {
      const topic = await this.prisma.topic.findFirst({
        where: { id: plan.target.topicId, userId },
        select: { title: true },
      });
      if (!topic) throw new NotFoundException('Topic not found');
      targetTitle = topic.title;
    } else {
      const catalog = JSON.parse(
        await readFile(join(CONTENT_DIR, 'projects/web3-products.json'), 'utf8'),
      ) as ProductCurriculum;
      const target = plan.target;
      const project = catalog.projects.find((p) => p.id === target.projectId);
      const milestone = project?.milestones.find((m) => m.id === target.milestoneId);
      if (!project || !milestone) throw new BadRequestException('Unknown project or milestone');
      targetTitle = `${project.title} · ${milestone.title}`;
    }
    try {
      await this.prisma.skillCheck.create({
        data: {
          id: plan.id,
          userId,
          targetTitle,
          plan,
          dueOn: new Date(`${plan.dueOn}T00:00:00Z`),
          ...(plan.target.kind === 'topic'
            ? { topicId: plan.target.topicId }
            : { projectKey: plan.target.projectId, milestoneKey: plan.target.milestoneId }),
        },
      });
      return { alreadySaved: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const retry = await this.prisma.skillCheck.findFirst({ where: { id: plan.id, userId } });
        if (retry && isDeepStrictEqual(retry.plan, plan)) return { alreadySaved: true };
        throw new ConflictException('Check identity is already in use. Start a new check.');
      }
      throw error;
    }
  }

  async attempt(userId: string, id: string, input: unknown) {
    const value = parse(skillCheckAttemptSchema, input);
    const row = await this.owned(userId, id);
    if (row.attemptedAt) {
      if (isDeepStrictEqual(row.attempt, value)) return { alreadySaved: true };
      throw new ConflictException(
        'The first attempt is preserved. Record corrections in feedback or a new check.',
      );
    }
    const { today } = await this.calendar(userId);
    if (today < row.dueOn.toISOString().slice(0, 10))
      throw new BadRequestException(
        'This check is scheduled for a later day. Continue ordinary practice in the meantime.',
      );
    const saved = await this.prisma.skillCheck.updateMany({
      where: { id, userId, attemptedAt: null, cancelledAt: null },
      data: { attempt: value, attemptedAt: new Date() },
    });
    if (!saved.count) {
      const current = await this.owned(userId, id);
      if (current.attemptedAt && isDeepStrictEqual(current.attempt, value))
        return { alreadySaved: true };
      throw new ConflictException(
        'This check changed or was cancelled. Your draft has not replaced it.',
      );
    }
    return { alreadySaved: false };
  }

  async assess(userId: string, id: string, input: unknown) {
    const value = parse(skillCheckResultSchema, input);
    const row = await this.owned(userId, id);
    if (!row.attemptedAt)
      throw new BadRequestException('Save a first attempt before recording feedback.');
    if (row.assessedAt) {
      if (isDeepStrictEqual(row.result, value)) return { alreadySaved: true };
      throw new ConflictException(
        'This result is preserved. Schedule a new variant to demonstrate progress.',
      );
    }
    if (
      value.outcome === 'passed' &&
      !independentSkillAttempt(
        row.plan as unknown as SkillCheckPlan,
        row.attempt as SkillCheckAttempt,
      )
    )
      throw new BadRequestException(
        'Help exceeded the agreed tools. Record needs practice and try a fresh independent variant later.',
      );
    const saved = await this.prisma.skillCheck.updateMany({
      where: { id, userId, attemptedAt: { not: null }, assessedAt: null, cancelledAt: null },
      data: { result: value, assessedAt: new Date() },
    });
    if (!saved.count) {
      const current = await this.owned(userId, id);
      if (current.assessedAt && isDeepStrictEqual(current.result, value))
        return { alreadySaved: true };
      throw new ConflictException('Feedback was already saved. Your draft has not replaced it.');
    }
    return { alreadySaved: false };
  }

  async cancel(userId: string, id: string) {
    const row = await this.owned(userId, id);
    if (row.cancelledAt) return { alreadySaved: true };
    const saved = await this.prisma.skillCheck.updateMany({
      where: { id, userId, attemptedAt: null, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    if (!saved.count)
      throw new ConflictException(
        'A saved attempt cannot be cancelled. Record its result instead.',
      );
    return { alreadySaved: false };
  }
}
