import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourseUpdatesService } from './course-updates.service';
import { CoursesService } from './courses.service';

function build(prismaOver: any = {}, importOver: any = {}) {
  const prisma: any = {
    courseImport: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    topic: {
      count: jest.fn().mockResolvedValue(0),
    },
    settings: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    sessionExport: {
      create: jest.fn().mockResolvedValue({ id: 'exp-1' }),
    },
    ...prismaOver,
  };
  const importService: any = {
    preview: jest.fn().mockResolvedValue({ fingerprint: 'preview-fingerprint' }),
    apply: jest.fn().mockResolvedValue({ topicsCreated: 1, promptsCreated: 2, topicsActivated: 0 }),
    ...importOver,
  };
  return { prisma, importService };
}

async function svc(prisma: any, importService: any): Promise<CoursesService> {
  const mod = await Test.createTestingModule({
    providers: [
      CoursesService,
      { provide: PrismaService, useValue: prisma },
      { provide: CourseUpdatesService, useValue: importService },
    ],
  }).compile();
  return mod.get(CoursesService);
}

describe('CoursesService.list', () => {
  it('computes imported from actual Topic rows per domain, not the CourseImport table', async () => {
    const { prisma, importService } = build({
      topic: {
        count: jest
          .fn()
          .mockImplementation(({ where }: any) => Promise.resolve(where.domain === 'DSA' ? 18 : 0)),
      },
    });
    const service = await svc(prisma, importService);
    const courses = await service.list('u1');

    expect(courses).toHaveLength(2);
    const dsa = courses.find((c) => c.id === 'dsa')!;
    const web3 = courses.find((c) => c.id === 'web3')!;
    expect(dsa.domain).toBe('DSA');
    expect(dsa.imported).toBe(true); // topics exist even though no CourseImport row was ever written
    expect(dsa.topicCount).toBeGreaterThan(0);
    expect(web3.domain).toBe('Web3');
    expect(web3.imported).toBe(false);
    expect(web3.topicCount).toBeGreaterThan(0);
  });

  it('flags a course as disabled when its domain is in Settings.disabledDomains', async () => {
    const { prisma, importService } = build({
      settings: {
        findUnique: jest.fn().mockResolvedValue({ disabledDomains: ['DSA'] }),
        upsert: jest.fn(),
      },
    });
    const service = await svc(prisma, importService);
    const courses = await service.list('u1');

    expect(courses.find((c) => c.id === 'dsa')!.disabled).toBe(true);
    expect(courses.find((c) => c.id === 'web3')!.disabled).toBe(false);
  });
});

describe('CoursesService.setDisabled', () => {
  it('adds the course domain to Settings.disabledDomains when disabling', async () => {
    const { prisma, importService } = build({
      settings: {
        findUnique: jest.fn().mockResolvedValue({ disabledDomains: [] }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    const service = await svc(prisma, importService);

    const result = await service.setDisabled('u1', 'dsa', true);

    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', disabledDomains: ['DSA'] },
      update: { disabledDomains: ['DSA'] },
    });
    expect(result.disabled).toBe(true);
    expect(result.id).toBe('dsa');
  });

  it('removes the course domain from Settings.disabledDomains when enabling, preserving other disabled domains', async () => {
    const { prisma, importService } = build({
      settings: {
        findUnique: jest.fn().mockResolvedValue({ disabledDomains: ['DSA', 'Other'] }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });
    const service = await svc(prisma, importService);

    const result = await service.setDisabled('u1', 'dsa', false);

    expect(prisma.settings.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      create: { userId: 'u1', disabledDomains: ['Other'] },
      update: { disabledDomains: ['Other'] },
    });
    expect(result.disabled).toBe(false);
  });

  it('throws NotFoundException for an unknown course id', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);
    await expect(service.setDisabled('u1', 'nope', true)).rejects.toThrow(NotFoundException);
    expect(prisma.settings.upsert).not.toHaveBeenCalled();
  });
});

describe('CoursesService.importCourse', () => {
  it('imports the entire prepared course through a checked atomic update', async () => {
    const { prisma, importService } = build();
    const service = await svc(prisma, importService);

    const summary = await service.importCourse('u1', 'dsa');

    expect(importService.apply).toHaveBeenCalledWith('u1', 'dsa', 'preview-fingerprint');
    expect(importService.apply).toHaveBeenCalledTimes(1);
    expect(summary.topicsCreated).toBe(1);
    expect(summary.promptsCreated).toBe(2);
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
