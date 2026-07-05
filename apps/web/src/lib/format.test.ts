import { afterEach, describe, expect, it, vi } from 'vitest';
import { timeAgo } from './format';

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('formats minutes, hours, and days since the timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00Z'));
    expect(timeAgo('2026-07-03T11:59:40Z')).toBe('just now');
    expect(timeAgo('2026-07-03T11:15:00Z')).toBe('45m ago');
    expect(timeAgo('2026-07-03T09:00:00Z')).toBe('3h ago');
    expect(timeAgo('2026-07-01T09:00:00Z')).toBe('2d ago');
  });

  it('is defensive about garbage and future timestamps', () => {
    expect(timeAgo('not-a-date')).toBe('just now');
    expect(timeAgo(new Date(Date.now() + 60_000).toISOString())).toBe('just now');
  });
});
