import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { ImportService } from '../import/import.service';
import { COURSE_MANIFEST, type CourseManifestEntry } from './course-manifest';
import { CONTENT_DIR } from './content-dir';

export interface CourseSummary {
  id: string;
  domain: string;
  title: string;
  description: string;
  topicCount: number;
  imported: boolean;
}

export interface CourseImportSummary {
  topicsCreated: number;
  promptsCreated: number;
  topicsActivated: number;
}

@Injectable()
export class CoursesService {
  constructor(
    private prisma: PrismaService,
    private importService: ImportService,
  ) {}

  private findEntry(courseId: string): CourseManifestEntry {
    const entry = COURSE_MANIFEST.find((c) => c.id === courseId);
    if (!entry) throw new NotFoundException(`Unknown course: ${courseId}`);
    return entry;
  }

  private async readDoc(file: string): Promise<Record<string, unknown>> {
    const text = await readFile(join(CONTENT_DIR, file), 'utf-8');
    return JSON.parse(text);
  }

  private async topicCount(entry: CourseManifestEntry): Promise<number> {
    let total = 0;
    for (const file of entry.files) {
      const doc = await this.readDoc(file);
      const topics = doc.proposedTopics;
      total += Array.isArray(topics) ? topics.length : 0;
    }
    return total;
  }

  async list(userId: string): Promise<CourseSummary[]> {
    const imports = await this.prisma.courseImport.findMany({ where: { userId } });
    const importedIds = new Set(imports.map((i) => i.courseId));
    return Promise.all(
      COURSE_MANIFEST.map(async (entry) => ({
        id: entry.id,
        domain: entry.domain,
        title: entry.title,
        description: entry.description,
        topicCount: await this.topicCount(entry),
        imported: importedIds.has(entry.id),
      })),
    );
  }

  async importCourse(userId: string, courseId: string): Promise<CourseImportSummary> {
    const entry = this.findEntry(courseId);
    const summary: CourseImportSummary = {
      topicsCreated: 0,
      promptsCreated: 0,
      topicsActivated: 0,
    };

    const existing = await this.prisma.courseImport.findFirst({
      where: { userId, courseId },
    });
    if (existing) {
      return summary;
    }

    for (const file of entry.files) {
      const doc = await this.readDoc(file);
      const exp = await this.prisma.sessionExport.create({
        data: { mode: 'full', exportMd: `Prepared course import: ${entry.id}/${file}`, userId },
      });
      const raw = '```learning-os\n' + JSON.stringify({ ...doc, sessionId: exp.id }) + '\n```';
      const result = await this.importService.apply(userId, raw);
      summary.topicsCreated += result.topicsCreated.length;
      summary.promptsCreated += result.promptsCreated;
      summary.topicsActivated += result.topicsActivated;
    }

    await this.prisma.courseImport.upsert({
      where: { userId_courseId: { userId, courseId } },
      update: { importedAt: new Date() },
      create: { userId, courseId },
    });

    return summary;
  }
}
