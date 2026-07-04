import { describe, expect, it } from 'vitest';
import { initialProgress, sessionReducer } from './session';

describe('sessionReducer', () => {
  it('starts at the first card with zero counters', () => {
    expect(initialProgress).toEqual({ cursor: 0, reviewed: 0, newStarted: 0 });
  });

  it('graded advances the cursor and counts the review', () => {
    const s = sessionReducer(initialProgress, { type: 'graded', isNew: false });
    expect(s).toEqual({ cursor: 1, reviewed: 1, newStarted: 0 });
  });

  it('grading a new card also counts newStarted', () => {
    const s = sessionReducer(initialProgress, { type: 'graded', isNew: true });
    expect(s).toEqual({ cursor: 1, reviewed: 1, newStarted: 1 });
  });

  it('skip advances without counting', () => {
    const s = sessionReducer(initialProgress, { type: 'skip' });
    expect(s).toEqual({ cursor: 1, reviewed: 0, newStarted: 0 });
  });

  it('accumulates across a mixed session', () => {
    let s = initialProgress;
    s = sessionReducer(s, { type: 'graded', isNew: false });
    s = sessionReducer(s, { type: 'skip' });
    s = sessionReducer(s, { type: 'graded', isNew: true });
    expect(s).toEqual({ cursor: 3, reviewed: 2, newStarted: 1 });
  });
});
