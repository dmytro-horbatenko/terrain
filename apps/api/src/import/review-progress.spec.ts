import { ConflictException } from '@nestjs/common';
import { ImportService } from './import.service';
import { completedReview } from '../metrics/review-queue';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
function fixture(status = 'active') {
  const topic: any = {
    id: 'topic',
    userId: 'user',
    title: 'RLP',
    topicType: 'concept',
    domain: 'Web3',
    status,
    parentId: null,
    learnedAt: null,
    sourcePlan: null,
  };
  const cards = ids.map((id) => ({
    id,
    topicId: topic.id,
    promptText: 'Explain the prefix',
    promptKind: 'concept',
    suspended: false,
    state: 'review',
    stability: 3.2,
    difficulty: 5.1,
    reps: 2,
    lapses: 0,
    lastReviewedAt: new Date('2026-08-25T00:00:00Z'),
    nextReviewAt: new Date('2026-09-01T00:00:00Z'),
  }));
  const session: any = {
    id: 'session',
    userId: 'user',
    mode: 'learn',
    approach: 'guided',
    importedAt: null,
    exportMd: `<!-- terrain-review: ${JSON.stringify({ promptIds: ids, estimatedMinutes: 4, budgetMinutes: 15, reviewMinutes: 15 })} -->\n`,
  };
  const reviews: any[] = [];
  const tx: any = {
    sessionExport: {
      updateMany: async ({ data }: any) => {
        if (session.importedAt) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => Object.assign(session, data),
    },
    topic: {
      findMany: async () => [{ ...topic, prompts: cards, _count: { appEvents: 0 } }],
      updateMany: async ({ data }: any) => {
        Object.assign(topic, data);
        return { count: 1 };
      },
      update: async ({ data }: any) => Object.assign(topic, data),
    },
    prompt: {
      findFirst: async ({ where }: any) => cards.find((c) => c.id === where.id),
      update: async ({ where, data }: any) =>
        Object.assign(cards.find((c) => c.id === where.id)!, data),
      aggregate: async () => ({
        _min: { nextReviewAt: new Date(Math.min(...cards.map((c) => c.nextReviewAt.getTime()))) },
      }),
    },
    review: {
      create: async ({ data }: any) => {
        reviews.push(data);
        return data;
      },
    },
  };
  const prisma: any = {
    sessionExport: { findFirst: async () => session },
    topic: { findMany: async () => [topic] },
    prompt: { findMany: async ({ where }: any) => cards.filter((c) => where.id.in.includes(c.id)) },
    $transaction: async (fn: any) => fn(tx),
  };
  return { service: new ImportService(prisma), topic, cards, session, reviews };
}

it('partial import changes only the attempted card and cannot be applied twice', async () => {
  const { service, cards, reviews, session } = fixture();
  session.mode = 'repeat';
  const untouched = structuredClone(cards[1]);
  const raw = JSON.stringify({
    version: 2,
    sessionId: 'session',
    reviews: [{ promptId: ids[0], grade: 'again' }],
  });
  const result = await service.apply('user', raw);
  expect(result.reviewsApplied).toBe(1);
  expect(cards[0].reps).toBe(3);
  expect(cards[1]).toEqual(untouched);
  expect(reviews).toHaveLength(1);
  expect(completedReview(session.exportMd, session.importedOutputRaw, session.id)).toBe(false);
  await expect(service.apply('user', raw)).rejects.toBeInstanceOf(ConflictException);
  expect(reviews).toHaveLength(1);
});

it('records a new activation date without inventing a date for existing active topics', async () => {
  const planned = fixture('planned');
  await planned.service.apply(
    'user',
    JSON.stringify({ version: 2, sessionId: 'session', studiedTopics: ['RLP'] }),
  );
  expect(planned.topic.status).toBe('active');
  expect(planned.topic.learnedAt).toBeInstanceOf(Date);
  const active = fixture();
  await active.service.apply(
    'user',
    JSON.stringify({ version: 2, sessionId: 'session', studiedTopics: ['RLP'] }),
  );
  expect(active.topic.learnedAt).toBeNull();
});
