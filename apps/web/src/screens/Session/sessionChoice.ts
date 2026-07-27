import type { LearningApproach } from '@terrain/types';
import type { PendingSession } from '../../api/types';

export const chooseInitialApproach = (
  override: LearningApproach | undefined,
  recommended: LearningApproach,
) => override ?? recommended;

export const sessionIdentity = (
  mode: string,
  topic: string | undefined,
  approach: LearningApproach | undefined,
) => [mode, topic ?? null, approach ?? null] as const;

type QueryReadiness = { hasData: boolean; isFetching: boolean };

export const sessionQueriesReady = (
  mode: 'repeat' | 'learn',
  dashboard: QueryReadiness,
  learningContext: QueryReadiness,
) =>
  dashboard.hasData &&
  !dashboard.isFetching &&
  (mode === 'repeat' || (learningContext.hasData && !learningContext.isFetching));

export const needsLocalWizardReset = (
  currentTopic: string | undefined,
  currentApproach: LearningApproach | undefined,
  nextTopic: string,
) => currentTopic === nextTopic && currentApproach === undefined;

export const matchingPendingSession = (
  sessions: readonly PendingSession[],
  mode: 'repeat' | 'learn',
  focusTopicId: string | null,
) =>
  sessions.find(
    (session) =>
      session.mode === mode && (mode === 'repeat' || session.focusTopicId === focusTopicId),
  );
