import { ImportService } from './import.service';

const sourcePlan = {
  policy: 'required',
  requirements: [
    {
      id: 'mechanism',
      purpose: 'Explain the encoding',
      requiredWhen: 'always',
      options: [
        {
          id: 'spec',
          title: 'RLP specification',
          url: 'https://example.com/rlp',
          format: 'article',
          scope: 'Encoding',
          estimatedMinutes: 20,
          why: 'Canonical mechanism',
        },
      ],
    },
  ],
};
const reconstruction = {
  topicTitle: 'RLP',
  requirementId: 'mechanism',
  sourceId: 'spec',
  sourceTitle: 'RLP specification',
  sourceUrl: 'https://example.com/rlp',
  mainClaim: 'Prefixes distinguish strings and lists.',
  supportingMechanism: 'Length prefixes delimit payloads.',
  openQuestion: null,
  substitutionReason: null,
  verifiedLiveAt: null,
  verificationNote: null,
};
const raw = (sessionId: string, fields = {}) =>
  JSON.stringify({ version: 2, sessionId, ...fields });

function fixture() {
  const topic: any = {
    id: 't1',
    userId: 'user',
    title: 'RLP',
    topicType: 'concept',
    status: 'planned',
    sourcePlan: structuredClone(sourcePlan),
  };
  const sessions: any[] = ['reading', 'lab', 'again'].map((id) => ({
    id,
    userId: 'user',
    approach: 'source_first',
    importedAt: null,
  }));
  const evidence: any[] = [];
  const applications: any[] = [];
  const tx: any = {
    topic: {
      findMany: async () => [topic],
      update: async ({ data }: any) => Object.assign(topic, data),
      updateMany: async ({ where, data }: any) => {
        if (topic.status !== where.status) return { count: 0 };
        Object.assign(topic, data);
        return { count: 1 };
      },
    },
    sessionExport: {
      updateMany: async ({ where, data }: any) => {
        const session = sessions.find(
          (s) => s.id === where.id && s.userId === where.userId && !s.importedAt,
        );
        if (!session) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      },
      update: async ({ where, data }: any) =>
        Object.assign(
          sessions.find((s) => s.id === where.id),
          data,
        ),
    },
    sourceEvidence: {
      create: async ({ data }: any) => evidence.push({ ...data, createdAt: new Date() }),
    },
    applicationEvent: { create: async ({ data }: any) => applications.push(data) },
  };
  const prisma: any = {
    topic: { findMany: async () => [topic] },
    sessionExport: {
      findFirst: async ({ where }: any) =>
        sessions.find((s) => s.id === where.id && s.userId === where.userId),
    },
    sourceEvidence: {
      findMany: jest.fn(async ({ where }: any) =>
        evidence.filter((e) => e.userId === where.userId && where.topicId.in.includes(e.topicId)),
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  return { service: new ImportService(prisma), prisma, topic, sessions, evidence, applications };
}

it('saves a partial reconstruction then completes a later standalone lab without duplicating evidence or inventing reviews', async () => {
  const { service, topic, sessions, evidence, applications } = fixture();
  const reading = await service.apply(
    'user',
    raw('reading', {
      sourceEvidence: [reconstruction],
      noteSummaries: [
        {
          topicTitle: 'RLP',
          keyInsight:
            'Objective: explain and implement prefixes. Explained the mechanism unaided; lab remains.',
        },
      ],
      nextSession: {
        focusTitle: 'RLP',
        coldChallenge: 'Finish the encoder. Cold check: encode a nested list.',
      },
    }),
  );
  expect(reading).toMatchObject({
    topicsActivated: 0,
    reviewsApplied: 0,
    promptsCreated: 0,
    sourceEvidenceApplied: 1,
  });
  expect(topic.status).toBe('planned');
  expect(sessions[0].nextColdChallenge).toContain('Finish the encoder');

  const lab = raw('lab', {
    studiedTopics: ['RLP'],
    applicationEvents: [
      {
        topicTitle: 'RLP',
        kind: 'problem_solved',
        description: 'Implemented and tested the agreed encoder unaided.',
        url: 'https://example.com/lab',
      },
    ],
  });
  expect((await service.preview('user', lab)).sourceIssues).toEqual([]);
  expect(await service.apply('user', lab)).toMatchObject({
    topicsActivated: 1,
    reviewsApplied: 0,
    sourceEvidenceApplied: 0,
    appEventsApplied: 1,
  });
  expect(topic.status).toBe('active');
  expect(evidence).toHaveLength(1);
  expect(applications).toHaveLength(1);
  await expect(service.apply('user', lab)).rejects.toThrow('already imported');
  expect(
    (await service.preview('user', raw('again', { studiedTopics: ['RLP'] }))).sourceIssues,
  ).toContainEqual(expect.objectContaining({ reason: 'missing-evidence' }));
});

it.each([
  'foreign-user',
  'other-topic',
  'changed-source',
  'changed-requirement',
  'expired',
  'expired-verification',
  'future-verification',
])('does not reuse %s evidence', async (scenario) => {
  const { service, topic, evidence, prisma } = fixture();
  evidence.push({ ...reconstruction, userId: 'user', topicId: 't1', createdAt: new Date() });
  if (scenario === 'foreign-user') evidence[0].userId = 'another';
  if (scenario === 'other-topic') evidence[0].topicId = 't2';
  if (scenario === 'changed-source') topic.sourcePlan.requirements[0].options[0].url += '/new';
  if (scenario === 'changed-requirement') topic.sourcePlan.requirements[0].id += '-new';
  if (scenario.includes('expired') || scenario === 'future-verification') {
    Object.assign(topic.sourcePlan.requirements[0].options[0], {
      verifiedAt: '2020-01-01',
      recheckAfterDays: 30,
    });
    if (scenario !== 'expired')
      Object.assign(evidence[0], {
        verifiedLiveAt: new Date(scenario === 'future-verification' ? '2099-01-01' : '2020-02-01'),
        verificationNote: 'Checked',
      });
  }
  const plan = await service.preview('user', raw('lab', { studiedTopics: ['RLP'] }));
  expect(plan.applicable).toBe(false);
  expect(plan.sourceIssues).toContainEqual(expect.objectContaining({ reason: 'missing-evidence' }));
  expect(prisma.sourceEvidence.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: 'user', topicId: { in: ['t1'] } } }),
  );
});

it.each(['live-verified', 'substitute'])('reuses a valid %s reconstruction', async (kind) => {
  const { service, topic, evidence } = fixture();
  const row: any = { ...reconstruction, userId: 'user', topicId: 't1', createdAt: new Date() };
  if (kind === 'live-verified') {
    Object.assign(topic.sourcePlan.requirements[0].options[0], {
      verifiedAt: '2020-01-01',
      recheckAfterDays: 30,
    });
    Object.assign(row, { verifiedLiveAt: new Date(), verificationNote: 'Checked current version' });
  } else {
    Object.assign(row, {
      sourceId: null,
      sourceUrl: 'https://example.com/replacement',
      substitutionReason: 'Original inaccessible; same scope',
    });
  }
  evidence.push(row);
  const result = await service.preview('user', raw('lab', { studiedTopics: ['RLP'] }));
  expect(result.applicable).toBe(true);
  expect(result.sourceEvidence).toEqual([]);
});
