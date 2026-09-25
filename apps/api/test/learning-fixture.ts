import type { SessionExport, Topic, User } from '@prisma/client';

export const LEARNER_ID = '10000000-0000-4000-8000-000000000001';
export const OTHER_ID = '10000000-0000-4000-8000-000000000002';
export const TOPIC_ID = '20000000-0000-4000-8000-000000000001';
const CREATED = new Date('2026-09-01T12:00:00Z');

/** Only the persisted operations used by the learning round trip; no service mocks. */
export function learningFixture(passwordHash: string) {
  const users: User[] = [LEARNER_ID, OTHER_ID].map((id, index) => ({
    id,
    email: `learner${index}@example.test`,
    passwordHash,
    name: `Learner ${index}`,
    headline: 'Engineer',
    learningStyle: 'Practice',
    codeStyle: 'Small examples',
    noteSystem: 'Obsidian',
    createdAt: CREATED,
    updatedAt: CREATED,
  }));
  let state = {
    topics: [
      {
        id: TOPIC_ID,
        userId: LEARNER_ID,
        title: 'RLP encoding',
        domain: 'Web3',
        topicType: 'concept',
        status: 'active',
        description: 'Encode nested lists.',
        summary: null,
        noteRef: null,
        parentId: null,
        nextReviewAt: null,
        learnedAt: CREATED,
        aiProposed: false,
        aiContext: 'Trace inner and outer length prefixes.',
        curriculumOrder: null,
        sourcePlan: null,
        createdAt: CREATED,
        updatedAt: CREATED,
        prerequisites: [],
        prompts: [],
      } satisfies Topic & { prerequisites: never[]; prompts: never[] },
    ] as (Topic & { prerequisites: never[]; prompts: never[] })[],
    sessions: [] as SessionExport[],
    reviews: [] as any[],
    applications: [] as any[],
  };
  const sessions = (where: any) =>
    state.sessions
      .filter(
        (row) =>
          (!where.id || row.id === where.id) &&
          row.userId === where.userId &&
          (!where.mode || row.mode === where.mode) &&
          (where.importedAt === undefined ||
            (where.importedAt === null ? row.importedAt === null : row.importedAt !== null)) &&
          (!where.OR ||
            where.OR.some((condition: any) =>
              condition.focusTopicId
                ? row.focusTopicId === condition.focusTopicId
                : row.nextFocusTitle
                    ?.toLowerCase()
                    .includes(condition.nextFocusTitle.contains.toLowerCase()),
            )),
      )
      .sort((a, b) => (b.importedAt?.getTime() ?? 0) - (a.importedAt?.getTime() ?? 0));
  const prisma = {
    user: {
      findUnique: async ({ where }: any) =>
        users.find((user) => (where.id ? user.id === where.id : user.email === where.email)) ??
        null,
    },
    settings: { findUnique: async () => ({ disabledDomains: [], timezone: 'Europe/Sofia' }) },
    topic: {
      findMany: async ({ where }: any) =>
        state.topics.filter((topic) => topic.userId === where.userId),
      update: async ({ where, data }: any) =>
        Object.assign(state.topics.find((topic) => topic.id === where.id)!, data),
    },
    sessionExport: {
      create: async ({ data }: any) => {
        const row = {
          id: `30000000-0000-4000-8000-${String(state.sessions.length + 1).padStart(12, '0')}`,
          generatedAt: CREATED,
          importedAt: null,
          importedOutputRaw: null,
          newTopicsCreated: [],
          nextFocusTitle: null,
          nextColdChallenge: null,
          ...data,
        } as SessionExport;
        state.sessions.push(row);
        return row;
      },
      findFirst: async ({ where, select }: any) => {
        const row = sessions(where)[0];
        if (!row) return null;
        return select?.exportMd ? { id: row.id, exportMd: row.exportMd } : row;
      },
      findMany: async ({ where }: any) => sessions(where),
      update: async ({ where, data }: any) =>
        Object.assign(state.sessions.find((row) => row.id === where.id)!, data),
      updateMany: async ({ where, data }: any) => {
        const rows = sessions(where);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    review: {
      create: async ({ data }: any) => {
        state.reviews.push(data);
        return data;
      },
      findMany: async ({ where }: any) =>
        state.reviews.filter((row) => row.userId === where.userId && row.topicId === where.topicId),
    },
    applicationEvent: {
      create: async ({ data }: any) => {
        const row = { ...data, appliedAt: CREATED };
        state.applications.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.applications.filter(
          (row) => row.userId === where.userId && where.topicId.in.includes(row.topicId),
        ),
    },
    sourceEvidence: { findMany: async () => [] },
    skillCheck: { findMany: async () => [] },
    $transaction: async <T>(run: (tx: any) => Promise<T>): Promise<T> => {
      const before = structuredClone(state);
      try {
        return await run(prisma);
      } catch (error) {
        state = before;
        throw error;
      }
    },
  };
  return prisma;
}
