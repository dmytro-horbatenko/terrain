import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportGeneratorService } from './export-generator.service';

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private generator: ExportGeneratorService,
  ) {}

  async createExport(userId: string, opts: { mode?: string; focusTopicId?: string }) {
    const mode = opts.mode ?? 'full';
    const draft = await this.generator.generate({ ...opts, now: new Date(), userId });
    const exportMode =
      mode === 'repeat' || mode === 'learn' ? mode : mode.startsWith('domain:') ? 'domain' : 'full';
    const domain = mode.startsWith('domain:') ? mode.slice('domain:'.length) : null;
    const row = await this.prisma.sessionExport.create({
      data: {
        mode: exportMode,
        domain,
        focusTopicId: opts.focusTopicId,
        exportMd: draft,
        userId,
      },
    });
    const exportMd = draft.replace('Session: <set-on-persist>', `Session: ${row.id}`);
    await this.prisma.sessionExport.update({ where: { id: row.id }, data: { exportMd } });
    return { id: row.id, exportMd };
  }
}
