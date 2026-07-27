import { describe, expect, it } from 'vitest';
import {
  chooseInitialApproach,
  matchingPendingSession,
  needsLocalWizardReset,
  sessionIdentity,
  sessionQueriesReady,
} from './sessionChoice';

describe('chooseInitialApproach', () => {
  it('uses a valid override before the recommendation', () => {
    expect(chooseInitialApproach('source-first', 'guided')).toBe('source-first');
  });

  it('falls back to the recommendation', () => {
    expect(chooseInitialApproach(undefined, 'guided')).toBe('guided');
  });
});

describe('matchingPendingSession', () => {
  it('resumes only the same mode and focus', () => {
    const pending = [
      {
        id: 's1',
        mode: 'learn',
        focusTopicId: 't1',
        topicTitle: 'A',
        approach: 'guided',
        generatedAt: 'x',
      },
    ] as const;

    expect(matchingPendingSession(pending, 'learn', 't1')?.id).toBe('s1');
    expect(matchingPendingSession(pending, 'learn', 't2')).toBeUndefined();
  });
});

describe('sessionIdentity', () => {
  it('changes when only the topic or approach search changes', () => {
    const current = sessionIdentity('learn', 't1', 'guided');

    expect(sessionIdentity('learn', 't2', 'guided')).not.toEqual(current);
    expect(sessionIdentity('learn', 't1', 'source-first')).not.toEqual(current);
  });
});

describe('sessionQueriesReady', () => {
  it('waits for a cached dashboard refetch to settle', () => {
    expect(
      sessionQueriesReady(
        'repeat',
        { hasData: true, isFetching: true },
        { hasData: false, isFetching: false },
      ),
    ).toBe(false);
  });

  it('waits for cached learning context only in learn mode', () => {
    const dashboard = { hasData: true, isFetching: false };
    const refetchingContext = { hasData: true, isFetching: true };

    expect(sessionQueriesReady('learn', dashboard, refetchingContext)).toBe(false);
    expect(sessionQueriesReady('repeat', dashboard, refetchingContext)).toBe(true);
  });
});

describe('needsLocalWizardReset', () => {
  it('uses a local reset only when navigation would keep the same identity', () => {
    expect(needsLocalWizardReset('t1', undefined, 't1')).toBe(true);
    expect(needsLocalWizardReset('t1', 'guided', 't1')).toBe(false);
    expect(needsLocalWizardReset('t1', undefined, 't2')).toBe(false);
  });
});
