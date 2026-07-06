import { describe, expect, it } from 'vitest';
import type { PendingSession } from '../../api/types';
import { initialStep } from './initialStep';

const pending = (mode: 'repeat' | 'learn'): PendingSession => ({
  id: `se-${mode}`,
  mode,
  generatedAt: '2026-07-03T09:00:00Z',
});

describe('initialStep', () => {
  it('resumes to paste when a pending session for this mode exists', () => {
    expect(initialStep([pending('repeat')], 'repeat')).toBe('paste');
  });

  it('starts at copy when there is no pending session', () => {
    expect(initialStep([], 'repeat')).toBe('copy');
  });

  it('ignores a pending session for the other mode', () => {
    expect(initialStep([pending('learn')], 'repeat')).toBe('copy');
  });
});
