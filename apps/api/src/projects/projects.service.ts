import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';
import {
  validateProjectCheckpoint,
  type ProductCurriculum,
  type ProjectCheckpointInput,
  type ProjectProgress,
} from '@terrain/types';
import { PrismaService } from '../prisma/prisma.service';
import { CONTENT_DIR } from '../courses/content-dir';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string): Promise<ProjectProgress[]> {
    const rows = await this.prisma.projectProgress.findMany({
      where: { userId },
      include: {
        checkpoints: {
          distinct: ['milestoneKey'],
          orderBy: { revision: 'desc' },
        },
      },
    });
    return rows.map((row) => ({
      projectId: row.projectKey,
      revision: row.revision,
      repositoryUrl: row.repositoryUrl,
      checkpoints: row.checkpoints.map((checkpoint) => ({
        ...(checkpoint.snapshot as unknown as ProjectCheckpointInput),
        createdAt: checkpoint.createdAt.toISOString(),
      })),
    }));
  }

  async save(userId: string, input: unknown) {
    const catalog = JSON.parse(
      await readFile(join(CONTENT_DIR, 'projects/web3-products.json'), 'utf8'),
    ) as ProductCurriculum;
    let value: ProjectCheckpointInput;
    try {
      value = validateProjectCheckpoint(input, catalog);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid checkpoint');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serializes saves for this learner/project, including the first save.
        // Other projects and learners remain independent.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project:${userId}:${value.projectId}`}, 0))`;
        const previous = await tx.projectCheckpoint.findFirst({
          where: { id: value.id, projectProgress: { userId, projectKey: value.projectId } },
        });
        if (previous) {
          if (!isDeepStrictEqual(previous.snapshot, value)) {
            throw new ConflictException(
              'This checkpoint was already saved with different content. Start a new checkpoint.',
            );
          }
          return { alreadySaved: true };
        }
        const progress = await tx.projectProgress.upsert({
          where: { userId_projectKey: { userId, projectKey: value.projectId } },
          create: { userId, projectKey: value.projectId },
          update: {},
        });
        const advanced = await tx.projectProgress.updateMany({
          where: { id: progress.id, userId, revision: value.expectedRevision },
          data: { revision: { increment: 1 }, repositoryUrl: value.repositoryUrl },
        });
        if (!advanced.count) {
          throw new ConflictException(
            'Newer project work is already saved. Keep your draft, reload progress, and merge it before saving.',
          );
        }
        await tx.projectCheckpoint.create({
          data: {
            id: value.id,
            projectProgressId: progress.id,
            milestoneKey: value.milestoneId,
            revision: value.expectedRevision + 1,
            snapshot: value,
          },
        });
        return { alreadySaved: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'Checkpoint identity is already in use. Start a new checkpoint.',
        );
      }
      throw error;
    }
  }
}
