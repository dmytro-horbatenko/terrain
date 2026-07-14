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
  disabled: boolean;
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

  private async disabledDomains(userId: string): Promise<Set<string>> {
    const settings = await this.prisma.settings.findUnique({
      where: { userId },
      select: { disabledDomains: true },
    });
    return new Set(settings?.disabledDomains ?? []);
  }

  /** `imported` is derived from actual Topic rows for the course's domain, not
   *  the CourseImport tracking table — topics seeded outside the Courses UI
   *  import flow (e.g. via a script) would otherwise show as not-imported. */
  private async toSummary(
    userId: string,
    entry: CourseManifestEntry,
    disabledDomains: Set<string>,
  ): Promise<CourseSummary> {
    const [topicCount, importedCount] = await Promise.all([
      this.topicCount(entry),
      this.prisma.topic.count({ where: { userId, domain: entry.domain } }),
    ]);
    return {
      id: entry.id,
      domain: entry.domain,
      title: entry.title,
      description: entry.description,
      topicCount,
      imported: importedCount > 0,
      disabled: disabledDomains.has(entry.domain),
    };
  }

  async list(userId: string): Promise<CourseSummary[]> {
    const disabledDomains = await this.disabledDomains(userId);
    return Promise.all(
      COURSE_MANIFEST.map((entry) => this.toSummary(userId, entry, disabledDomains)),
    );
  }

  async setDisabled(userId: string, courseId: string, disabled: boolean): Promise<CourseSummary> {
    const entry = this.findEntry(courseId);
    const domains = await this.disabledDomains(userId);
    if (disabled) domains.add(entry.domain);
    else domains.delete(entry.domain);
    const disabledDomains = [...domains];
    await this.prisma.settings.upsert({
      where: { userId },
      create: { userId, disabledDomains },
      update: { disabledDomains },
    });
    return this.toSummary(userId, entry, domains);
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
