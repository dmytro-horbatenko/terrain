import type { SourcePlan } from '@terrain/types';

import { recommendApproach } from './approach';

const NOW = new Date('2026-07-24T00:00:00Z');

const source = (id: string) => ({
  id,
  title: `Source ${id}`,
  url: `https://example.com/${id}`,
  format: 'article' as const,
  scope: 'The relevant section',
  estimatedMinutes: 10,
  why: 'It explains the topic.',
});

const requirement = (id: string, requiredWhen: 'first_exposure' | 'always' = 'first_exposure') => ({
  id,
  purpose: `Learn ${id}`,
  requiredWhen,
  options: [source(id)],
});

const oneSourcePlan: SourcePlan = {
  policy: 'required',
  requirements: [requirement('intro')],
};
const twoSourcePlan: SourcePlan = {
  policy: 'required',
  requirements: [requirement('intro'), requirement('practice')],
};
const alwaysPlan: SourcePlan = {
  policy: 'required',
  requirements: [requirement('current', 'always')],
};

describe('recommendApproach', () => {
  it.each([
    [{ status: 'active', recentGrades: [], promptKinds: [], plan: null }, 'guided'],
    [{ status: 'planned', recentGrades: ['hard'], promptKinds: [], plan: null }, 'guided'],
    [{ status: 'planned', recentGrades: [], promptKinds: ['code'], plan: null }, 'guided'],
    [{ status: 'planned', recentGrades: [], promptKinds: [], plan: oneSourcePlan }, 'source-first'],
    [{ status: 'planned', recentGrades: [], promptKinds: [], plan: twoSourcePlan }, 'guided'],
    [
      { status: 'planned', recentGrades: ['hard'], promptKinds: ['code'], plan: alwaysPlan },
      'source-first',
    ],
  ] as const)('recommends from explainable signals', (input, expected) => {
    const result = recommendApproach({ ...input, now: NOW });

    expect(result.recommended).toBe(expected);
    expect(result.reasons.some((reason: string) => reason.trim().length > 0)).toBe(true);
  });
});
