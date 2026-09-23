import type { Grade, LearningApproach, SourcePlan, TopicStatus } from '@terrain/types';

import {
  applicableRequirements,
  isSourceExpired,
  parseStoredSourcePlan,
} from '../sources/source-plan';

type PromptKind = 'concept' | 'code' | 'problem';

export type ApproachRecommendationInput = {
  plan: SourcePlan | null;
  status: TopicStatus;
  now: Date;
  recentGrades: readonly Grade[];
  promptKinds: readonly PromptKind[];
  creditedRequirementIds?: readonly string[];
};

export type ApproachRecommendation = {
  recommended: LearningApproach;
  reasons: string[];
};

export function recommendApproach(input: ApproachRecommendationInput): ApproachRecommendation {
  const requirements = applicableRequirements(
    parseStoredSourcePlan(input.plan),
    input.status,
  ).filter(
    (requirement) =>
      input.status !== 'planned' || !input.creditedRequirementIds?.includes(requirement.id),
  );
  const needsCurrentSource = requirements.some(
    (requirement) =>
      requirement.requiredWhen === 'always' ||
      requirement.options.every((option) => isSourceExpired(option, input.now)),
  );

  if (needsCurrentSource) {
    return {
      recommended: 'source-first',
      reasons: ['A required current source must be reconstructed before this session.'],
    };
  }
  if (input.status === 'active' || input.status === 'mastered') {
    return {
      recommended: 'guided',
      reasons: ['This topic is already in progress, so guided practice is the better default.'],
    };
  }
  if (input.recentGrades.some((grade) => grade === 'again' || grade === 'hard')) {
    return {
      recommended: 'guided',
      reasons: ['A recent again or hard grade calls for guided support.'],
    };
  }
  if (input.promptKinds.some((kind) => kind === 'code' || kind === 'problem')) {
    return {
      recommended: 'guided',
      reasons: ['An active code or problem prompt benefits from guided practice.'],
    };
  }
  if (requirements.length >= 2) {
    return {
      recommended: 'guided',
      reasons: ['Multiple required sources need a guided sequence.'],
    };
  }
  if (requirements.length === 1) {
    return {
      recommended: 'source-first',
      reasons: ['One required source is the best first step.'],
    };
  }
  return {
    recommended: 'guided',
    reasons: ['No source requirement calls for a source-first session.'],
  };
}
