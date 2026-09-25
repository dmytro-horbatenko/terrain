import { TopicsService } from './topics.service';

describe('topic note discovery', () => {
  const updatedAt = new Date('2026-09-25T10:00:00Z');
  let prisma: any;
  let service: TopicsService;

  beforeEach(() => {
    prisma = { topic: { findMany: jest.fn() }, $queryRaw: jest.fn() };
    service = new TopicsService(prisma, {} as any);
  });

  it('finds a late note match, prefers it to title matches, and only returns bounded metadata', async () => {
    const body = `${'before '.repeat(300)}A MERKLE proof\nexplained ${'after '.repeat(300)}`;
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'a',
        title: 'Merkle tree',
        summary: null,
        description: null,
        notes: { body, updatedAt },
      },
    ]);
    const [match] = await service.search('owner', '  Merkle  ');
    expect(match).toEqual({
      id: 'a',
      matchedField: 'notes',
      excerpt: expect.stringContaining('MERKLE proof explained'),
      notesUpdatedAt: updatedAt,
    });
    expect(match.excerpt.length).toBeLessThanOrEqual(240);
    expect(match.excerpt.startsWith('…')).toBe(true);
    expect(JSON.stringify(match)).not.toContain(body);
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner',
          OR: [
            { title: { contains: 'Merkle', mode: 'insensitive' } },
            { description: { contains: 'Merkle', mode: 'insensitive' } },
            { summary: { contains: 'Merkle', mode: 'insensitive' } },
            { notes: { is: { body: { contains: 'Merkle', mode: 'insensitive' } } } },
          ],
        }),
        take: 100,
        orderBy: [{ title: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it.each(['title', 'summary', 'description'] as const)(
    'selects the matching %s without leaking unrelated notes',
    async (field) => {
      prisma.topic.findMany.mockResolvedValue([
        {
          id: 'a',
          title: 'Other',
          summary: null,
          description: null,
          [field]: 'Contains Needle here',
          notes: { body: 'Unrelated private writing', updatedAt },
        },
      ]);
      expect(await service.search('owner', 'needle')).toEqual([
        {
          id: 'a',
          matchedField: field,
          excerpt: 'Contains Needle here',
          notesUpdatedAt: updatedAt,
        },
      ]);
    },
  );

  it('applies ownership and requested filters before the result limit and treats SQL wildcards literally', async () => {
    prisma.topic.findMany.mockResolvedValue([]);
    await service.search('other-owner', '50%_value', { domain: 'DSA', status: 'active' });
    expect(prisma.topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'other-owner',
          domain: 'DSA',
          status: 'active',
          OR: expect.arrayContaining([
            { title: { contains: '50\\%\\_value', mode: 'insensitive' } },
          ]),
        }),
        take: 100,
      }),
    );
  });

  it('does not search all content for an empty query', async () => {
    expect(await service.search('owner', '  ')).toEqual([]);
    expect(prisma.topic.findMany).not.toHaveBeenCalled();
  });

  it('keeps the complete maximum-length query inside a bounded excerpt', async () => {
    const term = 'n'.repeat(200);
    prisma.topic.findMany.mockResolvedValue([
      {
        id: 'a',
        title: 'Other',
        summary: null,
        description: null,
        notes: { body: `${'before '.repeat(100)}${term}${' after'.repeat(100)}`, updatedAt },
      },
    ]);
    const [match] = await service.search('owner', term);
    expect(match.excerpt).toContain(term);
    expect(match.excerpt.length).toBeLessThanOrEqual(240);
  });

  it('gets five recent nonempty notes by note date, with ownership parameterized and body excluded from responses', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { id: 'b', title: 'B', updatedAt, body: 'Newer note' },
      { id: 'a', title: 'A', updatedAt: new Date('2026-09-24'), body: 'x'.repeat(600) },
    ]);
    const notes = await service.recentNotes('owner');
    expect(notes.map((note) => note.id)).toEqual(['b', 'a']);
    expect(notes[0]).toEqual({ id: 'b', title: 'B', updatedAt, excerpt: 'Newer note' });
    expect(notes[1].excerpt.length).toBeLessThanOrEqual(240);
    expect(notes.every((note) => !('body' in note))).toBe(true);
    const [sql, userId] = prisma.$queryRaw.mock.calls[0];
    const query = sql.join('?');
    expect(userId).toBe('owner');
    expect(query).toContain('t."userId" = ?');
    expect(query).toContain(`n.body ~ '[^[:space:]]'`);
    expect(query).toContain('ORDER BY n."updatedAt" DESC, n."topicId" ASC');
    expect(query).toContain('LIMIT 5');
  });
});
