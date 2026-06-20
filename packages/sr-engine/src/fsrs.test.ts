import { describe, expect, it } from 'vitest';
import { applyGrade, INITIAL_CARD_STATE, previewIntervals } from './index';

const NOW = new Date('2026-07-02T10:00:00Z');

describe('applyGrade', () => {
  it('first good review leaves new state, sets stability/difficulty and a future due', () => {
    const s = applyGrade(INITIAL_CARD_STATE, 'good', NOW);
    expect(s.reps).toBe(1);
    expect(s.lapses).toBe(0);
    expect(s.stability).toBeGreaterThan(0);
    expect(s.difficulty).toBeGreaterThan(0);
    expect(s.lastReviewedAt).toEqual(NOW);
    expect(s.nextReviewAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(s.state).not.toBe('new');
  });

  it('again on a mature card increments lapses, moves to relearning, shrinks stability', () => {
    let s = applyGrade(INITIAL_CARD_STATE, 'good', NOW);
    s = applyGrade(s, 'good', new Date(NOW.getTime() + 3 * 86_400_000));
    s = applyGrade(s, 'good', new Date(NOW.getTime() + 13 * 86_400_000));
    const before = s.stability!;
    const lapsed = applyGrade(s, 'again', new Date(NOW.getTime() + 40 * 86_400_000));
    expect(lapsed.lapses).toBe(s.lapses + 1);
    expect(lapsed.state).toBe('relearning');
    expect(lapsed.stability!).toBeLessThan(before);
  });

  it('easy schedules further out than hard on the same state', () => {
    const base = applyGrade(INITIAL_CARD_STATE, 'good', NOW);
    const later = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(applyGrade(base, 'easy', later).nextReviewAt!.getTime()).toBeGreaterThan(
      applyGrade(base, 'hard', later).nextReviewAt!.getTime(),
    );
  });
});

describe('previewIntervals', () => {
  it('returns monotone non-negative day counts for all four grades', () => {
    const p = previewIntervals(INITIAL_CARD_STATE, NOW);
    expect(p.again).toBeGreaterThanOrEqual(0);
    expect(p.again).toBeLessThanOrEqual(p.hard);
    expect(p.hard).toBeLessThanOrEqual(p.good);
    expect(p.good).toBeLessThanOrEqual(p.easy);
  });
});
