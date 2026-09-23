import { completedReview, parseReviewOptions, readReviewSnapshot } from './review-queue';

const p1 = '11111111-1111-4111-8111-111111111111';
const p2 = '22222222-2222-4222-8222-222222222222';
const plan = { promptIds: [p1, p2], estimatedMinutes: 18, budgetMinutes: 20, reviewMinutes: 20 };
const snapshot = `<!-- terrain-review: ${JSON.stringify(plan)} -->\n# Session`;
const output = (reviews: unknown[], sessionId = 'session') =>
  JSON.stringify({ version: 2, sessionId, reviews });

it('counts every attempted selected card regardless of grade, but not a partial or different session', () => {
  const reviews = [
    { promptId: p1, grade: 'again' },
    { promptId: p2, grade: 'hard' },
  ];
  expect(completedReview(snapshot, output(reviews), 'session')).toBe(true);
  expect(completedReview(snapshot, output(reviews.slice(0, 1)), 'session')).toBe(false);
  expect(completedReview(snapshot, output(reviews, 'another'), 'session')).toBe(false);
  expect(
    completedReview(
      snapshot,
      output([
        { promptId: p1, grade: 'again' },
        { promptId: p1, grade: 'again' },
      ]),
      'session',
    ),
  ).toBe(false);
});

it('does not infer completion from legacy, empty, or malformed snapshots/output', () => {
  const reviewed = output([
    { promptId: p1, grade: 'good' },
    { promptId: p2, grade: 'good' },
  ]);
  expect(completedReview('# Legacy', reviewed, 'session')).toBe(false);
  expect(
    completedReview(
      `<!-- terrain-review: ${JSON.stringify({ ...plan, promptIds: [] })} -->\n`,
      reviewed,
      'session',
    ),
  ).toBe(false);
  expect(completedReview('<!-- terrain-review: broken -->\n', reviewed, 'session')).toBe(false);
  expect(completedReview(snapshot, 'not an import', 'session')).toBe(false);
  expect(completedReview(`# Learner text\n${snapshot}`, reviewed, 'session')).toBe(false);
});

it('accepts supported review choices and rejects malformed values at the boundary', () => {
  expect(parseReviewOptions('20', p1)).toEqual({ reviewMinutes: 20, reviewPromptId: p1 });
  expect(parseReviewOptions()).toEqual({});
  for (const bad of ['15garbage', '0', '600', ['15', '20']])
    expect(() => parseReviewOptions(bad)).toThrow();
  expect(() => parseReviewOptions('15', 'not-a-uuid')).toThrow();
});

it('recovers the saved selection and estimate, rejecting missing or malformed metadata', () => {
  expect(readReviewSnapshot(snapshot)).toEqual(plan);
  expect(readReviewSnapshot('# Legacy export')).toBeNull();
  expect(readReviewSnapshot(`<!-- terrain-review: {"promptIds":["bad"]} -->\n`)).toBeNull();
  expect(readReviewSnapshot(`# Learner text\n${snapshot}`)).toBeNull();
});
