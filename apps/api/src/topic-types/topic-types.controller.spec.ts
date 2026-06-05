import { TopicTypesController } from './topic-types.controller';

describe('TopicTypesController', () => {
  it("lists only the caller's topic types", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const ctrl = new TopicTypesController({ topicType: { findMany } } as any);

    await ctrl.findAll('userA');

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'userA' },
      orderBy: { label: 'asc' },
    });
  });

  it('scopes the query to whichever user is calling', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const ctrl = new TopicTypesController({ topicType: { findMany } } as any);

    await ctrl.findAll('userB');

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'userB' },
      orderBy: { label: 'asc' },
    });
    expect(findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'userA' } }),
    );
  });
});
