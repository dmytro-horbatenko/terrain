import {
  sourcePlanSchema,
  type SourceOption,
  type SourcePlan,
  type SourceRequirement,
  type TopicStatus,
} from '@terrain/types';

export function parseStoredSourcePlan(value: unknown): SourcePlan | null {
  return value == null ? null : sourcePlanSchema.parse(value);
}

export function applicableRequirements(
  plan: SourcePlan | null,
  status: TopicStatus,
): SourceRequirement[] {
  if (!plan || plan.policy === 'none') return [];
  return plan.requirements.filter(
    (requirement) => requirement.requiredWhen === 'always' || status === 'planned',
  );
}

export function isSourceExpired(option: SourceOption, now: Date): boolean {
  if (!option.verifiedAt || !option.recheckAfterDays) return false;
  const expiry = new Date(`${option.verifiedAt}T00:00:00Z`);
  expiry.setUTCDate(expiry.getUTCDate() + option.recheckAfterDays);
  return expiry < now;
}

export function sourcePlanStats(
  plan: SourcePlan | null,
  status: TopicStatus,
  now: Date,
): { requiredCount: number; estimatedMinutes: number; hasExpired: boolean } {
  const requirements = applicableRequirements(plan, status);
  return {
    requiredCount: requirements.length,
    estimatedMinutes: requirements.reduce(
      (total, requirement) =>
        total + Math.min(...requirement.options.map((option) => option.estimatedMinutes)),
      0,
    ),
    hasExpired: requirements.some((requirement) =>
      requirement.options.some((option) => isSourceExpired(option, now)),
    ),
  };
}
