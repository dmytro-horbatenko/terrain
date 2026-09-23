import {
  sourcePlanSchema,
  type SourceOption,
  type SourcePlan,
  type SourceRequirement,
  type TopicStatus,
} from '@terrain/types';
import type { SourceEvidence } from '@prisma/client';

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

export function canReuseSourceEvidence(
  plan: SourcePlan | null,
  status: TopicStatus,
  evidence: SourceEvidence,
  now: Date,
): boolean {
  if (status !== 'planned' || plan?.policy !== 'required') return false;
  const requirement = plan.requirements.find((item) => item.id === evidence.requirementId);
  if (!requirement || !evidence.mainClaim.trim() || !evidence.supportingMechanism.trim())
    return false;
  if (evidence.createdAt > now) return false;
  if (!evidence.sourceId) return !!evidence.substitutionReason?.trim();
  // ponytail: identity-based reuse; materially changed scope needs new IDs until
  // source plans carry historical revisions.
  const option = requirement.options.find((item) => item.id === evidence.sourceId);
  if (!option || option.url !== evidence.sourceUrl || evidence.substitutionReason != null)
    return false;
  if (!isSourceExpired(option, now)) return true;
  if (!evidence.verifiedLiveAt || !evidence.verificationNote?.trim()) return false;
  const expires = new Date(evidence.verifiedLiveAt);
  expires.setUTCDate(expires.getUTCDate() + option.recheckAfterDays!);
  return evidence.verifiedLiveAt <= now && expires >= now;
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
