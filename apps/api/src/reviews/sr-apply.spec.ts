import { buildReviewWrites } from './sr-apply';

const baseTopic: any = {
  id: 't1',
  title: 'T',
  domain: 'DSA',
  topicType: 'pattern',
  status: 'planned',
  description: null,
  summary: null,
  noteRef: null,
  parentId: null,
  easeFactor: 2.5,
  interval: 0,
  repetitions: 0,
  nextReviewAt: null,
  learnedAt: null,
  aiProposed: false,
  aiContext: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('buildReviewWrites', () => {
  it('computes the SM-2 transition, flips planned -> active, sets learnedAt', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const { review, topic } = buildReviewWrites(baseTopic, 5, 'claude_session', 'n', now);
    expect(review.topicId).toBe('t1');
    expect(review.mode).toBe('claude_session');
    expect(review.intervalBefore).toBe(0);
    expect(review.intervalAfter).toBeGreaterThan(0);
    expect(review.reviewedAt).toEqual(now);
    expect(topic.status).toBe('active');
    expect(topic.learnedAt).toEqual(now);
  });

  it('preserves status and learnedAt when the topic is not planned', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const learned = new Date('2025-12-01T00:00:00Z');
    const t = { ...baseTopic, status: 'active', learnedAt: learned };
    const { topic } = buildReviewWrites(t, 4, 'app_log', undefined, now);
    expect(topic.status).toBe('active');
    expect(topic.learnedAt).toEqual(learned);
  });

  it("stamps the review with the topic owner's userId", () => {
    const topic: any = {
      id: 't1',
      userId: 'userA',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
    };
    const { review } = buildReviewWrites(
      topic,
      5,
      'app_log',
      undefined,
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(review.userId).toBe('userA');
  });

  it('also computes an independent SM-2 transition for the prompt when one is passed, and stamps review.promptId', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
    };
    const { review, prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      5,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(review.promptId).toBe('p1');
    expect(promptWrite).toBeDefined();
    expect(promptWrite!.repetitions).toBe(1);
    expect(promptWrite!.interval).toBe(1);
  });

  it('omits prompt write and review.promptId when no prompt is passed', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const { review, prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      5,
      'app_log',
      undefined,
      now,
    );
    expect(review.promptId).toBeUndefined();
    expect(promptWrite).toBeUndefined();
  });

  it('increments consecutiveGood on a quality >= 4 prompt review', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: false,
      consecutiveGood: 1,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      4,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(2);
    expect(promptWrite!.graduated).toBe(false);
  });

  it('resets consecutiveGood to 0 on a quality < 4 prompt review', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: false,
      consecutiveGood: 2,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      3,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(0);
    expect(promptWrite!.graduated).toBe(false);
  });

  it('graduates a prompt once consecutiveGood reaches 3', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: false,
      consecutiveGood: 2,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      5,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(3);
    expect(promptWrite!.graduated).toBe(true);
  });

  it('keeps an already-graduated prompt graduated even after a later low-quality review', () => {
    const now = new Date('2026-01-08T00:00:00Z');
    const prompt: any = {
      id: 'p1',
      topicId: 't1',
      easeFactor: 2.5,
      interval: 0,
      repetitions: 0,
      nextReviewAt: null,
      graduated: true,
      consecutiveGood: 3,
    };
    const { prompt: promptWrite } = buildReviewWrites(
      baseTopic,
      1,
      'app_log',
      undefined,
      now,
      undefined,
      prompt,
    );
    expect(promptWrite!.consecutiveGood).toBe(0);
    expect(promptWrite!.graduated).toBe(true);
  });
});
