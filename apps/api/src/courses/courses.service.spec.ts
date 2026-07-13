import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImportService } from '../import/import.service';
import { CoursesService } from './courses.service';

function build(prismaOver: any = {}, importOver: any = {}) {
  const prisma: any = {
    courseImport: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sessionExport: {
      create: jest.fn().mockResolvedValue({ id: 'exp-1' }),
    },
    ...prismaOver,
  };
  const importService: any = {
    apply: jest
      .fn()
      .mockResolvedValue({ topicsCreated: ['t1'], promptsCreated: 2, topicsActivated: 0 }),
    ...importOver,
  };
  return { prisma, importService };
}

async function svc(prisma: any, importService: any): Promise<CoursesService> {
  const mod = await Test.createTestingModule({
    providers: [
      CoursesService,
      { provide: PrismaService, useValue: prisma },
      { provide: ImportService, useValue: importService },
    ],
  }).compile();
  return mod.get(CoursesService);
}

describe('CoursesService.list', () => {
  it('returns both manifest courses with topicCount and imported flags', async () => {
    const { prisma, importService } = build({
      courseImport: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', courseId: 'dsa' }]),
        upsert: jest.fn(),
      },
    });
    const service = await svc(prisma, importService);
    const courses = await service.list('u1');

    expect(courses).toHaveLength(2);
    const dsa = courses.find((c) => c.id === 'dsa')!;
    const web3 = courses.find((c) => c.id === 'web3')!;
    expect(dsa.domain).toBe('DSA');
    expect(dsa.imported).toBe(true);
    expect(dsa.topicCount).toBeGreaterThan(0);
    expect(web3.domain).toBe('Web3');
    expect(web3.imported).toBe(false);
    expect(web3.topicCount).toBeGreaterThan(0);
  });
});

describe('CoursesService.importCourse', () => {
  it('calls ImportService.apply once per file, sums the totals, and upserts CourseImport', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);

    const summary = await service.importCourse('u1', 'dsa');

    expect(importService.apply).toHaveBeenCalledTimes(18); // content/dsa has 18 files
    expect(prisma.sessionExport.create).toHaveBeenCalledTimes(18);
    expect(summary.topicsCreated).toBe(18); // 1 topic per apply() call in this mock
    expect(summary.promptsCreated).toBe(36); // 2 per apply() call
    expect(prisma.courseImport.upsert).toHaveBeenCalledWith({
      where: { userId_courseId: { userId: 'u1', courseId: 'dsa' } },
      update: expect.objectContaining({ importedAt: expect.any(Date) }),
      create: { userId: 'u1', courseId: 'dsa' },
    });
  });

  it('throws NotFoundException for an unknown course id', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);
    await expect(service.importCourse('u1', 'nope')).rejects.toThrow(NotFoundException);
    expect(importService.apply).not.toHaveBeenCalled();
  });

  it('short-circuits to a zero summary when a CourseImport row already exists for this user+course', async () => {
    const { prisma, importService } = build({
      courseImport: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ userId: 'u1', courseId: 'dsa' }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    const service = await svc(prisma, importService);

    const summary = await service.importCourse('u1', 'dsa');

    expect(summary).toEqual({ topicsCreated: 0, promptsCreated: 0, topicsActivated: 0 });
    expect(prisma.courseImport.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', courseId: 'dsa' },
    });
    expect(importService.apply).not.toHaveBeenCalled();
    expect(prisma.sessionExport.create).not.toHaveBeenCalled();
    expect(prisma.courseImport.upsert).not.toHaveBeenCalled();
  });
});
