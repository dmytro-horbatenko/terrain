import { ConflictException } from '@nestjs/common';
import { CourseUpdatesService } from './course-updates.service';
import { PrismaService } from '../prisma/prisma.service';

function build(rows: any[] = []) {
  let nextId = 0;
  const store: any = {
    topic: {
      findMany: jest.fn(async ({ where }: any) =>
        rows.filter((row) => row.userId === where.userId),
      ),
      createManyAndReturn: jest.fn(async ({ data }: any) => {
        const added = data.map((row: any) => ({
          ...row,
          id: `created-${++nextId}`,
          parentId: null,
          prerequisites: [],
          prompts: [],
        }));
        rows.push(...added);
        return added;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.find((row) => row.id === where.id && row.userId === where.userId);
        if (!row) throw new Error('Owned topic missing');
        Object.assign(row, data);
        return row;
      }),
    },
    topicType: { upsert: jest.fn(async () => ({})) },
    prerequisite: {
      deleteMany: jest.fn(async ({ where }: any) => {
        rows.find((row) => row.id === where.topicId).prerequisites = [];
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const edge of data)
          rows
            .find((row) => row.id === edge.topicId)
            .prerequisites.push({ prerequisiteId: edge.prerequisiteId });
      }),
    },
    prompt: {
      createMany: jest.fn(async ({ data }: any) => {
        for (const prompt of data)
          rows
            .find((row) => row.id === prompt.topicId)
            .prompts.push({ id: `card-${++nextId}`, ...prompt });
      }),
      update: jest.fn(),
    },
    courseImport: { upsert: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (fn: any) => fn(store)),
  };
  return { service: new CourseUpdatesService(store as PrismaService), store, rows };
}

describe('CourseUpdatesService', () => {
  it('previews the real whole Web3 curriculum including forward references without changing data', async () => {
    const { service, store } = build();
    const result = await service.preview('user-a', 'web3');
    expect(result.topicsCreated).toBeGreaterThan(200);
    expect(result.promptsCreated).toBeGreaterThan(500);
    expect(result.issues).toEqual([]);
    expect(store.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale fingerprint before any writes', async () => {
    const { service, store } = build();
    await expect(service.apply('user-a', 'web3', 'stale')).rejects.toThrow(ConflictException);
    expect(store.topic.createManyAndReturn).not.toHaveBeenCalled();
    expect(store.courseImport.upsert).not.toHaveBeenCalled();
  });

  it('creates the complete authored graph atomically and reapplying preserves learned history', async () => {
    const { service, store, rows } = build();
    const first = await service.preview('user-a', 'dsa');
    const result = await service.apply('user-a', 'dsa', first.fingerprint);
    expect(result.issues).toEqual([]);
    expect(rows).toHaveLength(first.topicsCreated);
    expect(rows.reduce((sum, row) => sum + row.prompts.length, 0)).toBe(first.promptsCreated);
    const ids = new Set(rows.map(({ id }) => id));
    expect(
      rows.every(
        (row) =>
          (!row.parentId || ids.has(row.parentId)) &&
          row.prerequisites.every((edge: any) => ids.has(edge.prerequisiteId)),
      ),
    ).toBe(true);
    rows[1].status = 'active';
    rows[1].summary = 'My independent reasoning';
    const again = await service.preview('user-a', 'dsa');
    expect(
      again.topicsCreated + again.topicsUpdated + again.promptsCreated + again.promptsUpdated,
    ).toBe(0);
    await service.apply('user-a', 'dsa', again.fingerprint);
    expect(rows[1]).toMatchObject({ status: 'active', summary: 'My independent reasoning' });
    expect(store.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      timeout: 60000,
    });
  });
});
