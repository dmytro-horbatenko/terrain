import 'dotenv/config';
import { PrismaClient, type TopicStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const TYPES = [
  'pattern',
  'concept',
  'problem',
  'vulnerability',
  'tradeoff',
  'technique',
  'protocol',
  'theorem',
];

type Seed = { title: string; status: TopicStatus; interval: number };

const DSA: Seed[] = [
  { title: 'Arrays & hash maps', status: 'mastered', interval: 60 },
  { title: 'Two pointers & sliding window', status: 'active', interval: 38 },
  { title: 'Linked lists', status: 'mastered', interval: 60 },
  { title: 'Graphs DFS/BFS', status: 'active', interval: 14 },
  { title: 'Backtracking', status: 'active', interval: 14 },
  { title: '1D dynamic programming', status: 'mastered', interval: 60 },
  { title: 'Stacks & queues', status: 'active', interval: 1 },
  { title: 'Heaps & priority queues', status: 'planned', interval: 0 },
  { title: 'Binary search', status: 'planned', interval: 0 },
  { title: 'Trees DFS/BFS', status: 'planned', interval: 0 },
  { title: 'Tries', status: 'planned', interval: 0 },
  { title: '2D DP', status: 'planned', interval: 0 },
  { title: 'Intervals', status: 'planned', interval: 0 },
  { title: 'Greedy', status: 'planned', interval: 0 },
  { title: 'Advanced graphs', status: 'planned', interval: 0 },
  { title: 'Bit manipulation', status: 'planned', interval: 0 },
];

const DEMO_EMAIL = 'demo@terrain.local';

async function main() {
  const passwordHash = await argon2.hash('demo-password');
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Dima',
      role: 'Mid-senior full-stack dev, TypeScript + Solidity + DeFi',
      learningStyle: 'Socratic, depth-first, tabulation over memoization',
      codeStyle: 'readable > optimized, TypeScript',
      noteSystem: 'OneNote (iPad drawings) + Obsidian (markdown)',
    },
  });

  for (const key of TYPES) {
    await prisma.topicType.upsert({
      where: { userId_key: { userId: user.id, key } },
      update: {},
      create: { userId: user.id, key, label: key[0].toUpperCase() + key.slice(1) },
    });
  }

  const now = new Date();
  for (const m of DSA) {
    const existing = await prisma.topic.findFirst({
      where: { userId: user.id, title: m.title, domain: 'DSA' },
    });
    if (existing) continue;
    const reviewing = m.status !== 'planned';
    await prisma.topic.create({
      data: {
        userId: user.id,
        title: m.title,
        domain: 'DSA',
        topicType: 'concept',
        status: m.status,
        interval: m.interval,
        repetitions: reviewing ? 2 : 0,
        easeFactor: 2.5,
        learnedAt: reviewing ? now : null,
        nextReviewAt: reviewing ? new Date(now.getTime() + m.interval * 86_400_000) : null,
      },
    });
  }

  await prisma.streakState.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });
  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
