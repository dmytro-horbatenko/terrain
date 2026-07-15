import {
  applicableRequirements,
  isSourceExpired,
  parseStoredSourcePlan,
  sourcePlanStats,
} from './source-plan';

const plan = {
  policy: 'required' as const,
  requirements: [
    {
      id: 'intro',
      purpose: 'Learn',
      requiredWhen: 'first_exposure' as const,
      options: [
        {
          id: 'a',
          title: 'A',
          url: 'https://example.com/a',
          format: 'article' as const,
          scope: 'Entire article',
          estimatedMinutes: 10,
          why: 'Clear',
        },
      ],
    },
    {
      id: 'current',
      purpose: 'Verify',
      requiredWhen: 'always' as const,
      options: [
        {
          id: 'b',
          title: 'B',
          url: 'https://example.com/b',
          format: 'documentation' as const,
          scope: 'API section',
          estimatedMinutes: 5,
          why: 'Current',
          verifiedAt: '2026-01-01',
          recheckAfterDays: 30,
        },
      ],
    },
  ],
};

it('selects first-exposure plus always requirements only for planned topics', () => {
  expect(applicableRequirements(plan, 'planned').map((requirement) => requirement.id)).toEqual([
    'intro',
    'current',
  ]);
  expect(applicableRequirements(plan, 'active').map((requirement) => requirement.id)).toEqual([
    'current',
  ]);
});

it('computes expiry and minimum required time', () => {
  const now = new Date('2026-07-10T00:00:00Z');
  expect(isSourceExpired(plan.requirements[1].options[0], now)).toBe(true);
  expect(sourcePlanStats(plan, 'planned', now)).toEqual({
    requiredCount: 2,
    estimatedMinutes: 15,
    hasExpired: true,
  });
});

it('returns null for legacy storage and rejects malformed JSON', () => {
  expect(parseStoredSourcePlan(null)).toBeNull();
  expect(() => parseStoredSourcePlan({ policy: 'required', requirements: [] })).toThrow();
});
