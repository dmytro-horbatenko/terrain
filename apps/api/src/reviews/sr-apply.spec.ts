import { INITIAL_CARD_STATE, type CardSrState } from '@terrain/sr-engine';
import {
  buildCardReviewWrites,
  buildEvidenceReviewWrite,
  recomputeTopicDue,
  type CardReviewInput,
} from './sr-apply';

const now = new Date('2026-07-02T00:00:00Z');

function reviewedPrompt(overrides: Partial<CardSrState> = {}): { id: string } & CardSrState {
  const lastReviewedAt = new Date('2026-06-25T00:00:00Z');
  const nextReviewAt = new Date('2026-07-02T00:00:00Z');
  return {
    id: 'p1',
    stability: 3.2,
    difficulty: 5.1,
    reps: 2,
    lapses: 0,
    state: 'review',
    lastReviewedAt,
    nextReviewAt,
    ...overrides,
  };
}

function baseInput(overrides: Partial<CardReviewInput> = {}): CardReviewInput {
  return {
    userId: 'u1',
    topicId: 't1',
    prompt: reviewedPrompt(),
    grade: 'good',
    mode: 'app_log',
    now,
    ...overrides,
  };
}

describe('buildCardReviewWrites', () => {
  it('promptUpdate carries applyGrade output mapped to DB fields', () => {
    const input = baseInput();
    const { promptUpdate } = buildCardReviewWrites(input);

    expect(promptUpdate.where).toEqual({ id: 'p1' });
    // applyGrade on a 'good' grade must move the card out of 'new' with
    // real stability/difficulty numbers and a future due date — a
    // non-tautological check that real FSRS math ran, not an echo.
    expect(promptUpdate.data.reps).toBe(3);
    expect(promptUpdate.data.state).not.toBe('new');
    expect(typeof promptUpdate.data.stability).toBe('number');
    expect(typeof promptUpdate.data.difficulty).toBe('number');
    expect(promptUpdate.data.lastReviewedAt).toEqual(now);
    expect(promptUpdate.data.nextReviewAt).toBeInstanceOf(Date);
    expect(promptUpdate.data.nextReviewAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it('reviewCreate has grade, promptId, userId, topicId, intervalBefore/After in days', () => {
    const input = baseInput({ grade: 'easy', durationMin: 4, note: 'n' });
    const { reviewCreate } = buildCardReviewWrites(input);

    expect(reviewCreate.userId).toBe('u1');
    expect(reviewCreate.topicId).toBe('t1');
    expect(reviewCreate.promptId).toBe('p1');
    expect(reviewCreate.grade).toBe('easy');
    expect(reviewCreate.mode).toBe('app_log');
    expect(reviewCreate.durationMin).toBe(4);
    expect(reviewCreate.note).toBe('n');
    // lastReviewedAt 2026-06-25 -> nextReviewAt 2026-07-02 == 7 days
    expect(reviewCreate.intervalBefore).toBe(7);
    expect(typeof reviewCreate.intervalAfter).toBe('number');
    expect(reviewCreate.intervalAfter as number).toBeGreaterThan(0);
    expect(reviewCreate.reviewedAt).toEqual(now);
  });

  it('on a new card, intervalBefore is 0', () => {
    const input = baseInput({
      prompt: { id: 'p2', ...INITIAL_CARD_STATE },
    });
    const { reviewCreate } = buildCardReviewWrites(input);
    expect(reviewCreate.intervalBefore).toBe(0);
  });

  it('never writes graduation-related fields', () => {
    const { promptUpdate } = buildCardReviewWrites(baseInput());
    expect(promptUpdate.data).not.toHaveProperty('graduated');
    expect(promptUpdate.data).not.toHaveProperty('consecutiveGood');
  });
});

describe('buildEvidenceReviewWrite', () => {
  it('creates a review with promptId null and null intervalBefore/After', () => {
    const write = buildEvidenceReviewWrite({
      userId: 'u1',
      topicId: 't1',
      grade: 'good',
      mode: 'claude_session',
      now,
    });
    expect(write.userId).toBe('u1');
    expect(write.topicId).toBe('t1');
    expect(write.promptId).toBeNull();
    expect(write.grade).toBe('good');
    expect(write.mode).toBe('claude_session');
    expect(write.intervalBefore).toBeNull();
    expect(write.intervalAfter).toBeNull();
    expect(write.reviewedAt).toEqual(now);
  });
});

describe('recomputeTopicDue', () => {
  it('sets topic.nextReviewAt to the min nextReviewAt over non-suspended cards', async () => {
    const min = new Date('2026-07-10T00:00:00Z');
    const aggregate = jest.fn().mockResolvedValue({ _min: { nextReviewAt: min } });
    const update = jest.fn().mockResolvedValue({});
    const tx: any = { prompt: { aggregate }, topic: { update } };

    await recomputeTopicDue(tx, 't1');

    expect(aggregate).toHaveBeenCalledWith({
      where: { topicId: 't1', suspended: false, nextReviewAt: { not: null } },
      _min: { nextReviewAt: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { nextReviewAt: min },
    });
  });

  it('sets null when no non-suspended reviewed cards remain', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _min: { nextReviewAt: null } });
    const update = jest.fn().mockResolvedValue({});
    const tx: any = { prompt: { aggregate }, topic: { update } };

    await recomputeTopicDue(tx, 't1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { nextReviewAt: null },
    });
  });
});
