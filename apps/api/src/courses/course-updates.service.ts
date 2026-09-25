import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseLearningOs } from '@terrain/types';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { COURSE_MANIFEST } from './course-manifest';
import { CONTENT_DIR } from './content-dir';
import {
  catalogueDigest,
  planCourseUpdate,
  type CourseCatalogue,
  type PromptChange,
  type StoredCourseTopic,
} from './course-update';

export const COURSE_REVISION = '2026-09-25';
type UpdatePlan = ReturnType<typeof planCourseUpdate>;

function preview(plan: UpdatePlan, catalogue: CourseCatalogue) {
  return {
    revision: COURSE_REVISION,
    catalogueDigest: catalogueDigest(catalogue),
    fingerprint: plan.fingerprint,
    topicsCreated: plan.newTopics.length,
    topicsUpdated: plan.topicUpdates.length,
    promptsCreated: plan.newPrompts.length,
    promptsUpdated: plan.promptUpdates.length,
    preservedChanges: plan.preservedChanges,
    issues: plan.issues,
    changes: [
      ...plan.newTopics.map(({ title }) => ({ title, fields: ['new topic'] })),
      ...plan.topicUpdates.map((change) => ({
        title: change.title,
        fields: [
          ...Object.keys(change.data),
          ...(change.parentTitle !== undefined ? ['parent'] : []),
          ...(change.prerequisiteTitles !== undefined ? ['prerequisites'] : []),
        ],
        ...(change.prerequisiteTitles !== undefined
          ? { prerequisites: change.prerequisiteTitles }
          : {}),
      })),
      ...plan.promptUpdates.map((change) => ({
        title: change.topicTitle,
        fields: Object.keys(change.data).map((key) => `card ${key}`),
      })),
    ],
  };
}

@Injectable()
export class CourseUpdatesService {
  constructor(private readonly prisma: PrismaService) {}

  private async catalogue(courseId: string) {
    const entry = COURSE_MANIFEST.find(({ id }) => id === courseId);
    if (!entry) throw new NotFoundException(`Unknown course: ${courseId}`);
    const documents = await Promise.all(
      entry.files.map(async (file) => {
        const raw = await readFile(join(CONTENT_DIR, file), 'utf8');
        return parseLearningOs(`\`\`\`learning-os\n${raw}\n\`\`\``);
      }),
    );
    const desired: CourseCatalogue = {
      topics: documents.flatMap((doc) => doc.proposedTopics),
      prompts: documents.flatMap((doc) => doc.proposedPrompts),
    };
    const baselineFile = JSON.parse(
      await readFile(join(CONTENT_DIR, 'course-revisions/2026-09-03.json'), 'utf8'),
    ) as { courses: Record<string, CourseCatalogue> };
    const promptChanges = JSON.parse(
      await readFile(join(CONTENT_DIR, 'course-revisions/2026-09-25-prompt-changes.json'), 'utf8'),
    ) as PromptChange[];
    return { desired, baseline: baselineFile.courses[courseId], promptChanges };
  }

  private async current(db: Prisma.TransactionClient, userId: string) {
    return db.topic.findMany({
      where: { userId },
      include: { prerequisites: { select: { prerequisiteId: true } }, prompts: true },
    });
  }

  async preview(userId: string, courseId: string) {
    const { desired, baseline, promptChanges } = await this.catalogue(courseId);
    const current = await this.current(this.prisma, userId);
    return preview(
      planCourseUpdate(desired, baseline, current as StoredCourseTopic[], promptChanges),
      desired,
    );
  }

  async apply(userId: string, courseId: string, expectedFingerprint: string) {
    const { desired, baseline, promptChanges } = await this.catalogue(courseId);
    return this.prisma
      .$transaction(
        async (tx) => {
          const current = await this.current(tx, userId);
          const plan = planCourseUpdate(
            desired,
            baseline,
            current as StoredCourseTopic[],
            promptChanges,
          );
          if (expectedFingerprint !== plan.fingerprint)
            throw new ConflictException(
              'The roadmap or prepared course changed. Preview the update again; nothing was changed.',
            );
          if (plan.issues.length)
            throw new UnprocessableEntityException({
              message: 'Resolve these roadmap issues before updating.',
              issues: plan.issues,
            });
          const byTitle = new Map(current.map(({ id, title }) => [title.trim().toLowerCase(), id]));
          const resolveId = (title: string) => byTitle.get(title.trim().toLowerCase())!;
          for (const type of new Set(plan.newTopics.map((topic) => topic.type))) {
            const key = type.trim().toLowerCase();
            await tx.topicType.upsert({
              where: { userId_key: { userId, key } },
              update: {},
              create: { userId, key, label: type },
            });
          }
          if (plan.newTopics.length) {
            const created = await tx.topic.createManyAndReturn({
              data: plan.newTopics.map((topic) => ({
                userId,
                title: topic.title,
                domain: topic.domain,
                topicType: topic.type,
                description: topic.description,
                aiContext: topic.aiContext,
                curriculumOrder: topic.curriculumOrder,
                sourcePlan:
                  topic.sourcePlan == null
                    ? Prisma.DbNull
                    : (topic.sourcePlan as Prisma.InputJsonValue),
                status: 'planned',
                aiProposed: false,
              })),
              select: { id: true, title: true },
            });
            for (const row of created) byTitle.set(row.title.trim().toLowerCase(), row.id);
          }
          for (const topic of plan.newTopics) {
            if (topic.parentTitle)
              await tx.topic.update({
                where: { id: resolveId(topic.title), userId },
                data: { parentId: resolveId(topic.parentTitle) },
              });
          }
          for (const change of plan.topicUpdates) {
            const data = { ...change.data } as Prisma.TopicUpdateManyMutationInput;
            if ('sourcePlan' in data && data.sourcePlan == null) data.sourcePlan = Prisma.DbNull;
            await tx.topic.update({
              where: { id: change.id, userId },
              data: {
                ...data,
                ...(change.parentTitle !== undefined
                  ? { parentId: change.parentTitle ? resolveId(change.parentTitle) : null }
                  : {}),
              },
            });
            if (change.prerequisiteTitles !== undefined)
              await tx.prerequisite.deleteMany({ where: { topicId: change.id } });
          }
          const links = [
            ...plan.newTopics.map((topic) => ({
              topicId: resolveId(topic.title),
              titles: topic.prerequisiteTitles,
            })),
            ...plan.topicUpdates
              .filter((change) => change.prerequisiteTitles !== undefined)
              .map((change) => ({ topicId: change.id, titles: change.prerequisiteTitles! })),
          ].flatMap(({ topicId, titles }) =>
            [...new Set(titles.map(resolveId))].map((prerequisiteId) => ({
              topicId,
              prerequisiteId,
            })),
          );
          if (links.length) await tx.prerequisite.createMany({ data: links, skipDuplicates: true });
          if (plan.newPrompts.length)
            await tx.prompt.createMany({
              data: plan.newPrompts.map(({ topicTitle, ...prompt }) => ({
                ...prompt,
                topicId: resolveId(topicTitle),
              })),
            });
          for (const change of plan.promptUpdates)
            await tx.prompt.update({
              where: { id: change.id, topic: { userId } },
              data: change.data as Prisma.PromptUpdateInput,
            });
          await tx.courseImport.upsert({
            where: { userId_courseId: { userId, courseId } },
            create: { userId, courseId },
            update: { importedAt: new Date() },
          });
          return { ...preview(plan, desired), topicsActivated: 0 };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2034', 'P2002'].includes(error.code)
        ) {
          throw new ConflictException(
            'The roadmap changed during the update. Preview it again; nothing was changed.',
          );
        }
        throw error;
      });
  }
}
