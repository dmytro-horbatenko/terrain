import { describe, expect, it } from 'vitest';
import { learningContextSchema } from './index';

const minimal = {
  schemaVersion: 1,
  generatedAt: '2026-07-24T12:00:00.000Z',
  learner: { role: null, learningStyle: null, codeStyle: null, noteSystem: null },
  target: null,
  selection: { source: 'none', importedFocus: null, learnableAlternatives: [] },
  prerequisites: [],
  mayRelyOn: [],
  doNotAssume: [],
  blockers: [],
};

describe('learning context', () => {
  it('parses the minimal no-target context', () => {
    expect(learningContextSchema.parse(minimal)).toEqual(minimal);
  });

  it('rejects unknown fields so transport payloads cannot drift', () => {
    expect(learningContextSchema.safeParse({ ...minimal, token: 'secret' }).success).toBe(false);
  });

  it('accepts a guided target with source plan and prompt evidence', () => {
    expect(
      learningContextSchema.safeParse({
        ...minimal,
        target: {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Hashing',
          domain: 'Web3',
          topicType: 'pattern',
          kind: 'leaf',
          sessionEligible: true,
          status: 'planned',
          description: null,
          sourcePlan: { policy: 'none', rationale: 'Guided implementation' },
          chapter: {
            id: '22222222-2222-4222-8222-222222222222',
            title: 'Basics',
            learnedLeaves: 5,
            totalLeaves: 13,
          },
          approach: { recommended: 'guided', reasons: ['contains a code prompt'] },
          prompts: [
            {
              id: '33333333-3333-4333-8333-333333333333',
              kind: 'code',
              text: 'Implement hashing',
              state: 'new',
              difficulty: null,
              stability: null,
              lastGrade: null,
            },
          ],
        },
      }).success,
    ).toBe(true);
  });
});
