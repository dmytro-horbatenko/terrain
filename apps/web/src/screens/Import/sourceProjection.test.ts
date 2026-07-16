import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceIssue } from '../../api/types';
import { isSourceOptionExpired, safeHttpUrl, sourceIssueSummary } from './sourceProjection';

describe('source projection', () => {
  afterEach(() => vi.useRealTimers());

  it('separates blocking issues from warnings', () => {
    const issues: SourceIssue[] = [
      {
        topicTitle: 'Queues',
        requirementId: 'proof',
        reason: 'missing-evidence',
        blocking: true,
        message: 'Evidence is required.',
      },
      {
        topicTitle: 'Queues',
        reason: 'missing-plan',
        blocking: false,
        message: 'No source plan is available.',
      },
    ];

    expect(sourceIssueSummary(issues)).toEqual({
      blocking: [issues[0]],
      warnings: [issues[1]],
    });
  });

  it('marks a verified source expired only after its recheck window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'));

    expect(isSourceOptionExpired({ verifiedAt: '2026-07-01', recheckAfterDays: 9 })).toBe(true);
    expect(isSourceOptionExpired({ verifiedAt: '2026-07-01', recheckAfterDays: 10 })).toBe(false);
    expect(isSourceOptionExpired({ verifiedAt: '2026-07-01' })).toBe(false);
  });

  it('accepts only HTTP source links', () => {
    expect(safeHttpUrl('https://example.com/source')).toBe(true);
    expect(safeHttpUrl('http://example.com/source')).toBe(true);
    expect(safeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(safeHttpUrl('not a url')).toBe(false);
  });
});
