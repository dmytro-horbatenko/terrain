import { ImportService } from './import.service';

function fixture() {
  const topics = [
    { id: 't1', userId: 'user', title: 'RLP', topicType: 'concept', status: 'active' },
    { id: 't2', userId: 'user', title: 'ABI', topicType: 'concept', status: 'active' },
    { id: 'foreign', userId: 'another', title: 'RLP', topicType: 'concept', status: 'active' },
  ];
  const cards: any[] = [
    {
      id: 'old',
      topicId: 't1',
      promptText: 'Explain the prefix.\nGive an example.',
      promptKind: 'concept',
      url: null,
      suspended: true,
      reps: 9,
      stability: 42,
      lastReviewedAt: new Date('2026-08-01'),
    },
  ];
  const session: any = { id: 'session', importedAt: null };
  let locked = false;
  let onLock = () => {};
  const readCards = ({ where }: any) =>
    cards.filter(
      (c) =>
        where.topicId.in.includes(c.topicId) &&
        topics.some((t) => t.id === c.topicId && t.userId === where.topic.userId),
    );
  const tx: any = {
    $executeRaw: async () => {
      locked = true;
      onLock();
      return 1;
    },
    sessionExport: {
      updateMany: async ({ data }: any) => {
        if (session.importedAt) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => Object.assign(session, data),
    },
    prompt: {
      findMany: async (args: any) => {
        if (!locked) throw new Error('Read identities after acquiring the import lock');
        return readCards(args);
      },
      create: async ({ data }: any) => {
        const row = { id: `new-${cards.length}`, ...data };
        cards.push(row);
        return row;
      },
    },
  };
  const prisma: any = {
    topic: { findMany: async ({ where }: any) => topics.filter((t) => t.userId === where.userId) },
    prompt: { findMany: async (args: any) => readCards(args) },
    sessionExport: { findFirst: async () => session },
    $transaction: async (fn: any) => fn(tx),
  };
  return {
    service: new ImportService(prisma),
    cards,
    onLock: (fn: () => void) => {
      onLock = fn;
    },
  };
}

const proposal = (over: Record<string, unknown> = {}) => ({
  topicTitle: 'RLP',
  promptText: 'Explain the prefix.\nGive an example.',
  promptKind: 'concept',
  ...over,
});
const raw = (proposedPrompts: unknown[], extras = {}) =>
  JSON.stringify({ version: 2, sessionId: 'session', proposedPrompts, ...extras });

it('previews existing and in-batch duplicates while preserving distinct exercises', async () => {
  const { service } = fixture();
  const plan = await service.preview(
    'user',
    raw([
      proposal({ promptText: '  Explain the prefix.\r\nGive an example.\n' }),
      proposal({ promptText: 'Encode 127.' }),
      proposal({ topicTitle: 'RLP [concept]', promptText: 'Encode 127.' }),
      proposal({ topicTitle: 'ABI' }),
      proposal({ promptKind: 'code' }),
      proposal({ url: 'https://example.com/exercise' }),
    ]),
  );
  expect(plan.applicable).toBe(true);
  expect(plan.newPrompts).toMatchObject(
    [true, false, true, false, false, false].map((duplicate) => ({ duplicate })),
  );
});

it('resolves qualified names for duplicate prompts on a topic proposed in the same batch', async () => {
  const { service } = fixture();
  const plan = await service.preview(
    'user',
    raw(
      [
        proposal({ topicTitle: 'New topic', promptText: 'Explain it.' }),
        proposal({ topicTitle: 'New topic [concept]', promptText: 'Explain it.' }),
      ],
      {
        proposedTopics: [
          { title: 'New topic', type: 'concept', domain: 'Web3', prerequisiteTitles: [] },
        ],
      },
    ),
  );
  expect(plan.newPrompts).toMatchObject([false, true].map((duplicate) => ({ duplicate })));
});

it('skips duplicates during apply without changing existing scheduling or suspension', async () => {
  const { service, cards } = fixture();
  const saved = structuredClone(cards[0]);
  const result = await service.apply(
    'user',
    raw([
      proposal(),
      proposal({ promptText: 'Encode 127.' }),
      proposal({
        topicTitle: 'RLP [concept]',
        promptText: 'Encode 127.',
        answerHint: 'Different hint',
      }),
    ]),
  );
  expect(result).toMatchObject({ promptsCreated: 1, duplicatePromptsSkipped: 2 });
  expect(cards).toHaveLength(2);
  expect(cards[0]).toEqual(saved);
});

it('rechecks identities after locking when another import added a card after preview', async () => {
  const { service, cards, onLock } = fixture();
  const input = raw([proposal({ promptText: 'Encode 127.' })]);
  expect((await service.preview('user', input)).newPrompts[0]).toMatchObject({ duplicate: false });
  onLock(() =>
    cards.push({
      id: 'concurrent',
      topicId: 't1',
      promptText: 'Encode 127.',
      promptKind: 'concept',
      url: null,
    }),
  );
  expect(await service.apply('user', input)).toMatchObject({
    promptsCreated: 0,
    duplicatePromptsSkipped: 1,
  });
  expect(cards.map((c) => c.id)).toEqual(['old', 'concurrent']);
});

it('preserves meaningful code case and internal whitespace, and isolates other users', async () => {
  const { service, cards } = fixture();
  cards.push({
    id: 'foreign-card',
    topicId: 'foreign',
    promptText: 'Foreign-only question',
    promptKind: 'concept',
    url: null,
  });
  const plan = await service.preview(
    'user',
    raw([
      proposal({ promptKind: 'code', promptText: 'return "A";' }),
      proposal({ promptKind: 'code', promptText: 'return "a";' }),
      proposal({ promptKind: 'code', promptText: 'return "a  b";' }),
      proposal({ promptKind: 'code', promptText: 'return "a b";' }),
      proposal({ promptKind: 'code', promptText: 'Hash "é" as UTF-8.' }),
      proposal({ promptKind: 'code', promptText: 'Hash "e\u0301" as UTF-8.' }),
      proposal({ promptText: 'Foreign-only question' }),
    ]),
  );
  expect(plan.newPrompts).toMatchObject(
    [false, false, false, false, false, false, false].map((duplicate) => ({ duplicate })),
  );
});
