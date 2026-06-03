import { describe, it, expect } from 'vitest';
import { sm2, shouldEscalate, INITIAL_SR_STATE } from './index';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

describe('sm2', () => {
  it('resets to interval 1 / repetitions 0 when quality < 3', () => {
    const state = { easeFactor: 2.6, interval: 30, repetitions: 5, nextReviewAt: null };
    const next = sm2(2, state, NOW);
    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(1);
    expect(daysBetween(NOW, next.nextReviewAt!)).toBe(1);
    expect(next.easeFactor).toBe(2.6); // EF unchanged on lapse
  });

  it('gives interval 1 on first successful review', () => {
    const next = sm2(4, INITIAL_SR_STATE, NOW);
    expect(next.interval).toBe(1);
    expect(next.repetitions).toBe(1);
  });

  it('gives interval 6 on second successful review', () => {
    const after1 = sm2(4, INITIAL_SR_STATE, NOW);
    const next = sm2(4, after1, NOW);
    expect(next.interval).toBe(6);
    expect(next.repetitions).toBe(2);
  });

  it('multiplies interval by EF from the third review on', () => {
    let s = sm2(5, INITIAL_SR_STATE, NOW); // rep1, interval1
    s = sm2(5, s, NOW); // rep2, interval6
    const next = sm2(5, s, NOW); // rep3
    expect(next.interval).toBe(Math.round(6 * next.easeFactor));
  });

  it('never drops EF below 1.3', () => {
    let s = { easeFactor: 1.3, interval: 6, repetitions: 2, nextReviewAt: null };
    s = sm2(3, s, NOW); // quality 3 pushes EF down
    expect(s.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});

describe('shouldEscalate', () => {
  it('is true with >=3 reviews of quality <=2 in the last 7 days', () => {
    const reviews = [
      { quality: 1, reviewedAt: new Date('2025-12-28T00:00:00Z') },
      { quality: 2, reviewedAt: new Date('2025-12-29T00:00:00Z') },
      { quality: 0, reviewedAt: new Date('2025-12-30T00:00:00Z') },
    ];
    expect(shouldEscalate(reviews, NOW)).toBe(true);
  });

  it('ignores reviews older than 7 days and quality > 2', () => {
    const reviews = [
      { quality: 1, reviewedAt: new Date('2025-12-01T00:00:00Z') }, // too old
      { quality: 4, reviewedAt: new Date('2025-12-30T00:00:00Z') }, // too good
      { quality: 2, reviewedAt: new Date('2025-12-31T00:00:00Z') },
    ];
    expect(shouldEscalate(reviews, NOW)).toBe(false);
  });
});
