import { describe, expect, it } from 'vitest';
import { dueLabel, formatDate, formatDateTime } from './format';

describe('learner calendar labels', () => {
  it('uses the saved timezone on opposite sides of midnight', () => {
    const now = new Date('2026-09-25T22:00:00Z');
    const due = '2026-09-25T21:30:00Z';
    expect(dueLabel(due, 'Europe/Sofia', now).text).toBe('due today');
    expect(dueLabel('2026-09-25T20:30:00Z', 'Europe/Sofia', now).text).toBe('overdue 1d');
    expect(dueLabel(due, 'America/Los_Angeles', now).text).toBe('due today');
    expect(dueLabel('2026-09-26T07:00:00Z', 'America/Los_Angeles', now).text).toBe('due tomorrow');
  });

  it('counts calendar dates across a short DST day', () => {
    expect(
      dueLabel('2026-03-29T21:00:00Z', 'Europe/Sofia', new Date('2026-03-28T22:00:00Z')).days,
    ).toBe(1);
  });

  it('formats instants in the saved timezone and preserves date-only labels', () => {
    expect(formatDate('2026-09-25T22:00:00Z', { day: 'numeric' }, 'Europe/Sofia')).toBe('26');
    expect(formatDate('2026-09-25T22:00:00Z', { day: 'numeric' }, 'America/Los_Angeles')).toBe(
      '25',
    );
    expect(formatDate('2026-09-25', { day: 'numeric' }, 'America/Los_Angeles')).toBe('25');
    expect(formatDateTime('2026-09-25T22:00:00Z', 'Europe/Sofia')).toContain('26');
  });

  it('handles absent or invalid dates without exposing NaN to the learner', () => {
    expect(dueLabel('not a date').text).toBe('not scheduled');
    expect(formatDate(null)).toBe('—');
  });
});
