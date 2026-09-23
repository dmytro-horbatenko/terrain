import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { LearningApproach } from '@terrain/types';
import { LearningContextService } from '../learning/learning-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExportGeneratorService } from './export-generator.service';
import { readReviewSnapshot, type ReviewOptions } from '../metrics/review-queue';

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private generator: ExportGeneratorService,
    private learning: LearningContextService,
  ) {}

  async getExport(userId: string, id: string) {
    const saved = await this.prisma.sessionExport.findFirst({
      where: { id, userId },
      select: { id: true, exportMd: true },
    });
    if (!saved) throw new NotFoundException('Session not found');
    return saved;
  }

  async createExport(
    userId: string,
    opts: ReviewOptions & { mode?: string; focusTopicId?: string; approach?: LearningApproach },
  ) {
    const mode = opts.mode ?? 'full';
    const now = new Date();
    let focusTopicId = opts.focusTopicId;
    let approach: LearningApproach | undefined;
    let draft: string;
    if (mode === 'learn') {
      const context = await this.learning.context(userId, { topic: focusTopicId, now });
      if (!context.target?.sessionEligible) {
        throw new UnprocessableEntityException('No startable topic.');
      }
      focusTopicId = context.target.id;
      approach = opts.approach ?? context.target.approach.recommended;
      draft = await this.generator.generateLearnContext(context, approach, now);
    } else {
      draft = await this.generator.generate({ ...opts, now, userId });
    }
    const exportMode =
      mode === 'repeat' || mode === 'learn' ? mode : mode.startsWith('domain:') ? 'domain' : 'full';
    const domain = mode.startsWith('domain:') ? mode.slice('domain:'.length) : null;
    const row = await this.prisma.sessionExport.create({
      data: {
        mode: exportMode,
        domain,
        focusTopicId,
        approach: approach === 'source-first' ? 'source_first' : (approach ?? null),
        exportMd: draft,
        userId,
      },
    });
    const exportMd = draft.replace('Session: <set-on-persist>', `Session: ${row.id}`);
    await this.prisma.sessionExport.update({ where: { id: row.id }, data: { exportMd } });
    return { id: row.id, exportMd, reviewPlan: readReviewSnapshot(exportMd) };
  }
}
